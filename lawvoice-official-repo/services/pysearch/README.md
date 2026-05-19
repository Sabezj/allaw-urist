# Python Search Service (VirtualEnv, FastAPI)

Запуск через virtualenv. Эндпоинты:
- `GET /v1/products/list?limit=10`
- `GET /v1/products/search?q=...&limit=10`
- `GET /healthz`

## Требования
- Python 3.9+
- PostgreSQL с таблицей `products(id serial, name text, price_rub_m2 numeric)`
- `DATABASE_URL` в окружении

## Windows (PowerShell)
```powershell
cd pysearch
$env:DATABASE_URL="postgres://postgres:postgres@localhost:5432/db"
.\start_py_search.ps1
```

## Linux/macOS (bash)
```bash
cd pysearch
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/db"
chmod +x ./start_py_search.sh
./start_py_search.sh
```

Проверь `http://127.0.0.1:5051/healthz`.