import re
from typing import Optional, Dict

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

    # Явные ключевые слова с вариациями окончаний
    for name_variants, key in [
        (r"толщин[аойу]?", "thickness_mm"),
        (r"ширин[аойу]?", "width_mm"),
        (r"длин[аойу]?", "length_mm")
    ]:
        pattern = rf"{name_variants}\s*{NUM}\s*([a-zа-я]+)?"
        m = re.search(pattern, t)
        if m:
            slots[key] = _to_mm(m.group(1), m.group(2))
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