import os
import json
import logging
from typing import List, Optional, Dict
import asyncpg
from fastapi import FastAPI, Query, HTTPException, Depends, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi_limiter import FastAPILimiter
from fastapi_limiter.depends import RateLimiter
from pydantic import BaseModel
import openai
from rapidfuzz import fuzz, process
import numpy as np
import redis.asyncio as redis
import uvicorn
from functools import lru_cache
from decimal import Decimal
from nlu_slots import parse_rus_specs
# Импорт парсера параметров (вставьте код из nlu_slots.py здесь или импортируйте как модуль)
# Для простоты вставлю inline
import re

NUM = r"(?P<val>\d+(?:[.,]\d+)?)"
SP = r"(?:\s| |,|;|и)+"

UNIT_MAP = {
    "мм": 1, "миллиметр":1, "миллиметра":1, "миллиметров":1,
    "cm": 10, "см":10, "сантиметр":10, "сантиметра":10, "сантиметров":10,
    "м": 1000, "метр":1000, "метра":1000, "метров":1000,
}

QTY_WORDS = r"(?:шт|штук|штуки|лист(?:а|ов)?|позици(?:я|и|й))"

def _to_mm(val: str, unit: Optional[str]) -> Optional[float]:
    if not val: return None
    v = float(val.replace(",", "."))
    if not unit: return v  # если единицы не сказаны, трактуем как мм
    unit = unit.lower()
    mult = 1
    for k, m in UNIT_MAP.items():
        if unit.startswith(k):
            mult = m
            break
    return v * mult

def parse_rus_specs(text: str) -> Dict[str, Optional[float]]:
    """
    Извлекает: thickness_mm, width_mm, length_mm, quantity
    Примеры: "Толщина 0.5 мм, ширина 1 м, длина 2 м, количество 5 штук"
             "0,45мм на 1,2м × 2м 10 шт"
    """
    t = text.lower()

    slots = {"thickness_mm": None, "width_mm": None, "length_mm": None, "quantity": None}

    # Явные ключевые слова
    for name, key in [("толщина", "thickness_mm"), ("ширина", "width_mm"), ("длина", "length_mm")]:
        m = re.search(rf"{name}\s*{NUM}\s*(?P<u>[a-zа-я]+)?", t)
        if m:
            slots[key] = _to_mm(m.group("val"), m.group("u"))

    # Формы "1 м на 2 м" / "1x2 м" (ширина × длина)
    if slots["width_mm"] is None or slots["length_mm"] is None:
        m = re.search(
            rf"{NUM}\s*(?P<u1>[a-zа-я]+)?\s*(?:x|×|х|на|-)\s*{NUM}\s*(?P<u2>[a-zа-я]+)?",
            t
        )
        if m:
            w = _to_mm(m.group("val"), m.group("u1"))
            l = _to_mm(m.group(2), m.group("u2"))
            # если одна единица указана, применим её к обеим
            if m.group("u1") and not m.group("u2"): l = _to_mm(m.group(2), m.group("u1"))
            if m.group("u2") and not m.group("u1"): w = _to_mm(m.group("val"), m.group("u2"))
            slots["width_mm"]  = slots["width_mm"]  or w
            slots["length_mm"] = slots["length_mm"] or l

    # Количество
    m = re.search(rf"(?P<q>\d+)\s*{QTY_WORDS}", t)
    if not m:
        # голое число в связке типа "10 штук" уже покрыто; попробуем "количество 5"
        m = re.search(rf"(?:кол-во|количество)\s*(?P<q>\d+)", t)
    if m:
        slots["quantity"] = int(m.group("q"))

    return slots

# Конфигурация
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("Set DATABASE_URL")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("Set OPENAI_API_KEY for embeddings")

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
RATE_LIMIT = 100  # Запросов в минуту на IP

client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)

app = FastAPI(title="Product Search API", version="1.0.0")

# Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Логирование
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Redis для кэша (эмбеддингов и результатов)
async def get_redis():
    return await redis.from_url(REDIS_URL)

# Rate limiting
@app.on_event("startup")
async def startup():
    redis_conn = await get_redis()
    await FastAPILimiter.init(redis_conn)

async def get_pool():
    if not hasattr(app.state, "pool"):
        app.state.pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=10)
    return app.state.pool

class Product(BaseModel):
    id: int
    sku: Optional[str]
    name: str
    category: Optional[str]
    thickness_mm: Optional[float]
    width_mm: Optional[float]
    length_mm: Optional[float]
    unit: Optional[str]
    price_rub_per_m2: Optional[float]
    price_rub_per_sheet: Optional[float]
    score: Optional[float]

class SearchResult(BaseModel):
    products: List[Product]
    total_price: Optional[float]  # Итого за quantity (если указано)

@app.get("/health")
async def health():
    try:
        pool = await get_pool()
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
        return {"status": "ok"}
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(503, "Service unavailable")

@app.get("/v1/products", response_model=List[Product], dependencies=[Depends(RateLimiter(times=RATE_LIMIT, seconds=60))])
async def list_products(limit: int = 10):
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                   price_rub_per_m2, price_rub_per_sheet, 1.0 AS score
            FROM products
            ORDER BY id DESC
            LIMIT $1
        """, limit)
    return [dict(r) for r in rows]

@app.get("/v1/products/categories", dependencies=[Depends(RateLimiter(times=RATE_LIMIT, seconds=60))])
async def list_categories():
    pool = await get_pool()
    async with pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT category, COUNT(*) AS cnt
            FROM products
            WHERE category IS NOT NULL AND category <> ''
            GROUP BY category
            ORDER BY cnt DESC, category ASC
        """)
    return [{"category": r["category"], "count": r["cnt"]} for r in rows]

@lru_cache(maxsize=1000)
async def get_embedding(text: str) -> List[float]:
    """Кэшируем эмбеддинги (in-memory + Redis для долгосрочного)"""
    redis_conn = await get_redis()
    cache_key = f"emb:{text}"
    cached = await redis_conn.get(cache_key)
    if cached:
        return json.loads(cached)
    
    try:
        response = await client.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        emb = response.data[0].embedding
        await redis_conn.set(cache_key, json.dumps(emb), ex=3600)  # 1 час TTL
        return emb
    except Exception as e:
        logger.error(f"Embedding error: {e}")
        raise HTTPException(status_code=500, detail=f"Embedding error: {str(e)}")

def decimal_encoder(o):
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f'Object of type {o.__class__.__name__} is not JSON serializable')
    
    
@app.post("/v1/products/search_by_specs", response_model=SearchResult, dependencies=[Depends(RateLimiter(times=RATE_LIMIT, seconds=60))])
async def search_by_specs(transcript: str = Body(...)):
    params = parse_rus_specs(transcript)
    logger.info(f"Parsed params: {params}")
    
    if not any(params.values()):
        raise HTTPException(400, "No parameters extracted from text")
    
    pool = await get_pool()
    async with pool.acquire() as conn:
        sql = """
            SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                   price_rub_per_m2, price_rub_per_sheet, 1.0 AS score
            FROM products
            WHERE 1=1
        """
        sql_params = []
        
        # Увеличенные допуски
        tol_thickness = 0.1  # ±0.1 мм
        tol_size = 200  # ±200 мм
        if params["thickness_mm"] is not None:
            sql += " AND thickness_mm BETWEEN $%d - %f AND $%d + %f" % (len(sql_params)+1, tol_thickness, len(sql_params)+1, tol_thickness)
            sql_params.append(params["thickness_mm"])
        
        if params["width_mm"] is not None:
            sql += " AND (width_mm IS NULL OR width_mm BETWEEN $%d - %d AND $%d + %d)" % (len(sql_params)+1, tol_size, len(sql_params)+1, tol_size)
            sql_params.append(params["width_mm"])
        
        if params["length_mm"] is not None:
            sql += " AND (length_mm IS NULL OR length_mm BETWEEN $%d - %d AND $%d + %d)" % (len(sql_params)+1, tol_size, len(sql_params)+1, tol_size)
            sql_params.append(params["length_mm"])
        
        sql += " ORDER BY id DESC LIMIT 10"
        
        rows = await conn.fetch(sql, *sql_params)
        products = [dict(r) for r in rows]
        
        total_price = None
        qty = params["quantity"]
        if qty and products:
            first = products[0]
            area = (first.get("width_mm", 1000) / 1000) * (first.get("length_mm", 2000) / 1000)  # m² fallback
            price_per_item = first.get("price_rub_per_sheet") or (first.get("price_rub_per_m2") * area)
            total_price = float(price_per_item * qty) if price_per_item else None
        
        return {"products": products, "total_price": total_price}
        
        
@app.get("/v1/products/search", response_model=List[Product], dependencies=[Depends(RateLimiter(times=RATE_LIMIT, seconds=60))])
async def search_products(
    q: str = Query(""),
    fuzzy: bool = Query(True),
    semantic: bool = Query(True),
    fts: bool = Query(True),
    limit: int = Query(10)
):
    q = (q or "").strip().lower()
    if not q:
        return await list_products(limit=limit)
    
    # Кэш результатов поиска (Redis)
    redis_conn = await get_redis()
    cache_key = f"search:{q}:{fuzzy}:{semantic}:{fts}:{limit}"
    cached = await redis_conn.get(cache_key)
    if cached:
        return json.loads(cached)
    
    pool = await get_pool()
    async with pool.acquire() as conn:
        candidates = []
        
        if fuzzy:
            all_rows = await conn.fetch("""
                SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                       price_rub_per_m2, price_rub_per_sheet
                FROM products
            """)
            all_products = [dict(r) for r in all_rows]
            names = [f"{p['name']} {p.get('category', '')}".lower() for p in all_products]
            
            matches = process.extract(q, names, scorer=fuzz.WRatio, limit=limit * 2)
            for match in matches:
                idx = match[2]
                score = match[1] / 100.0
                if score > 0.7:
                    prod = all_products[idx]
                    prod['score'] = score
                    candidates.append(prod)
            
            trigram_rows = await conn.fetch("""
                SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                       price_rub_per_m2, price_rub_per_sheet,
                       GREATEST(similarity(name, $1), similarity(coalesce(category,''), $1)) AS score
                FROM products
                WHERE name % $1 OR category % $1
                ORDER BY score DESC
                LIMIT $2
            """, q, limit)
            for r in trigram_rows:
                prod = dict(r)
                if prod['score'] > 0.3:
                    candidates.append(prod)
        
        if fts:
            fts_rows = await conn.fetch("""
                SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                       price_rub_per_m2, price_rub_per_sheet,
                       ts_rank_cd(to_tsvector('russian', coalesce(name,'') || ' ' || coalesce(category,'')),
                                  plainto_tsquery('russian', $1)) AS score
                FROM products
                WHERE to_tsvector('russian', coalesce(name,'') || ' ' || coalesce(category,'')) @@ plainto_tsquery('russian', $1)
                ORDER BY score DESC
                LIMIT $2
            """, q, limit)
            for r in fts_rows:
                prod = dict(r)
                if prod['score'] > 0.1:
                    candidates.append(prod)
        
        if semantic:
            q_emb = await get_embedding(q)
            q_emb_str = '[' + ','.join(map(str, q_emb)) + ']'
            
            vector_rows = await conn.fetch("""
                SELECT p.id, p.sku, p.name, p.category, p.thickness_mm, p.width_mm, p.length_mm, p.unit,
                       p.price_rub_per_m2, p.price_rub_per_sheet,
                       1 - (e.embedding <=> $1::vector) AS score
                FROM products p
                JOIN product_embeddings e ON e.product_id = p.id
                ORDER BY e.embedding <=> $1::vector
                LIMIT $2
            """, q_emb_str, limit)
            for r in vector_rows:
                prod = dict(r)
                if prod['score'] > 0.5:
                    candidates.append(prod)
        
        if not candidates:
            await redis_conn.set(cache_key, json.dumps([]), ex=300)  # 5 мин TTL для негативных
            return []
        
        seen = {}
        for cand in candidates:
            pid = cand['id']
            if pid in seen:
                seen[pid]['score'] = max(seen[pid]['score'], cand['score'])
            else:
                seen[pid] = cand
        
        results = sorted(seen.values(), key=lambda x: x.get('score', 0), reverse=True)[:limit]
        
        await redis_conn.set(cache_key, json.dumps(results, default=decimal_encoder), ex=300)
        return results

@app.post("/v1/products/search_by_specs", response_model=SearchResult, dependencies=[Depends(RateLimiter(times=RATE_LIMIT, seconds=60))])
async def search_by_specs(transcript: str = Body(...)):
    """
    Парсит параметры из текста и ищет продукты с допусками.
    Возвращает продукты + итоговую цену (если quantity указано).
    """
    params = parse_rus_specs(transcript)
    logger.info(f"Parsed params: {params}")
    
    if not any(params.values()):
        raise HTTPException(400, "No parameters extracted from text")
    
    pool = await get_pool()
    async with pool.acquire() as conn:
        sql = """
            SELECT id, sku, name, category, thickness_mm, width_mm, length_mm, unit,
                   price_rub_per_m2, price_rub_per_sheet, 1.0 AS score
            FROM products
            WHERE 1=1
        """
        sql_params = []
        
        # Допуски: толщина ±0.05, ширина/длина ±10 мм (настраиваемо)
        if params["thickness_mm"] is not None:
            sql += " AND thickness_mm BETWEEN $%d - 0.05 AND $%d + 0.05" % (len(sql_params)+1, len(sql_params)+1)
            sql_params.append(params["thickness_mm"])
        
        if params["width_mm"] is not None:
            sql += " AND width_mm BETWEEN $%d - 10 AND $%d + 10" % (len(sql_params)+1, len(sql_params)+1)
            sql_params.append(params["width_mm"])
        
        if params["length_mm"] is not None:
            sql += " AND length_mm BETWEEN $%d - 10 AND $%d + 10" % (len(sql_params)+1, len(sql_params)+1)
            sql_params.append(params["length_mm"])
        
        sql += " ORDER BY id DESC LIMIT 10"  # Limit по умолчанию
        
        rows = await conn.fetch(sql, *sql_params)
        products = [dict(r) for r in rows]
        
        total_price = None
        qty = params["quantity"]
        if qty and products:
            # Итого: цена за лист * qty (fallback на m2 * площадь, если sheet null)
            first = products[0]
            area = (first.get("width_mm", 1000) / 1000) * (first.get("length_mm", 2000) / 1000)  # m²
            price_per_item = first.get("price_rub_per_sheet") or (first.get("price_rub_per_m2") * area)
            total_price = price_per_item * qty if price_per_item else None
        
        return {"products": products, "total_price": total_price}

if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "5051"))
    uvicorn.run("main:app", host=host, port=port, reload=False, workers=4)  # Prod: несколько workers