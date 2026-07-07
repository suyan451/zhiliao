from __future__ import annotations

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.custom_assets import read_custom_assets
from rd_kb.db import DB_PATH, seed_defaults
from rd_kb.directions import read_direction_registry, seed_directions_from_names


OUT = ROOT / "web" / "public" / "kb-data.json"
DIRECTIONS_PATH = ROOT / "configs" / "ui_directions.json"

DEFAULT_DIRECTIONS = [
    "分类",
    "异常检测",
    "语义分割",
    "目标检测",
    "实例分割",
    "预训练",
    "交互式分割",
    "提示分割",
    "知识蒸馏",
]

TABLES = {
    "domains": "domains",
    "papers": "papers",
    "methods": "methods",
    "experiments": "experiments",
    "bestPractices": "best_practices",
    "projects": "projects",
    "assets": "assets",
}

CUSTOM_ASSET_KEYS = (
    "customDirections",
    "customSubTechCards",
    "customResearchCards",
    "customProjectCards",
    "customDatasetCards",
)


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def read_table(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    rows = conn.execute(f"SELECT * FROM {table}").fetchall()
    return [row_to_dict(row) for row in rows]


def configured_directions() -> list[str]:
    if not DIRECTIONS_PATH.exists():
        return []
    try:
        data = json.loads(DIRECTIONS_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    return [str(item).strip() for item in data.get("directions", []) if str(item).strip()]


def collect_directions(payload: dict[str, list[dict[str, Any]]]) -> list[str]:
    seen: dict[str, None] = {}
    domain_names = {
        str(item.get("slug") or ""): str(item.get("name") or "")
        for item in payload.get("domains", [])
        if item.get("slug") and item.get("name")
    }
    for name in [*DEFAULT_DIRECTIONS, *configured_directions()]:
        seen[name] = None
    for item in payload.get("customDirections", []):
        name = str(item.get("name") or "").strip()
        if name:
            seen[name] = None
    for collection in payload.values():
        for item in collection:
            task = str(item.get("task") or "").strip()
            if task:
                seen[task] = None
            direction = str(item.get("direction") or "").strip()
            if direction:
                seen[direction] = None
            domain_slug = str(item.get("domain_slug") or "").strip()
            domain_name = domain_names.get(domain_slug, "")
            if domain_name:
                seen[domain_name] = None
    return list(seen.keys())


def main() -> None:
    seed_defaults()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        tables = {json_key: read_table(conn, table) for json_key, table in TABLES.items()}
        custom_assets = read_custom_assets(conn)
    finally:
        conn.close()

    tables = {**tables, **{key: custom_assets.get(key, []) for key in CUSTOM_ASSET_KEYS}}
    direction_names = collect_directions(tables)
    registry_conn = sqlite3.connect(DB_PATH)
    registry_conn.row_factory = sqlite3.Row
    try:
        seed_directions_from_names(registry_conn, direction_names)
        direction_registry = read_direction_registry(registry_conn)
    finally:
        registry_conn.close()
    payload: dict[str, Any] = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "directions": [item["name"] for item in direction_registry["techDirections"]],
        "techDirections": direction_registry["techDirections"],
        "directionAliases": direction_registry["directionAliases"],
        **tables,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
