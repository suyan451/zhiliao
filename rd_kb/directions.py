from __future__ import annotations

import sqlite3
from typing import Any

from .db import now


UNCATEGORIZED_NAME = "未分类"


def ensure_direction(
    conn: sqlite3.Connection,
    *,
    name: str,
    summary: str = "",
    direction_id: str | None = None,
    parent_id: str = "",
) -> dict[str, Any]:
    clean_name = _clean_name(name)
    existing = _find_direction(conn, clean_name)
    if existing:
        if summary and summary != existing["summary"]:
            stamp = now()
            conn.execute(
                """
                UPDATE tech_directions
                SET summary = ?, updated_at = ?, version = version + 1
                WHERE direction_id = ?
                """,
                (summary, stamp, existing["direction_id"]),
            )
            conn.commit()
            return get_direction(conn, existing["direction_id"])
        return existing

    stamp = now()
    clean_id = direction_id or f"dir-{_slug(clean_name)}"
    conn.execute(
        """
        INSERT INTO tech_directions (
            direction_id, name, summary, parent_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(direction_id) DO UPDATE SET
            name = excluded.name,
            summary = excluded.summary,
            parent_id = excluded.parent_id,
            updated_at = excluded.updated_at,
            version = tech_directions.version + 1
        """,
        (clean_id, clean_name, summary, parent_id, "active", stamp, stamp),
    )
    _upsert_alias(conn, clean_name, clean_id, stamp)
    conn.commit()
    return get_direction(conn, clean_id)


def get_direction(conn: sqlite3.Connection, direction_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM tech_directions WHERE direction_id = ?", (direction_id,)).fetchone()
    if row is None:
        raise KeyError(f"Direction not found: {direction_id}")
    return _row_dict(row)


def resolve_direction(conn: sqlite3.Connection, name: str) -> dict[str, Any]:
    clean_name = _clean_name(name)
    return _find_direction(conn, clean_name) or ensure_direction(conn, name=clean_name)


def list_directions(conn: sqlite3.Connection, *, include_archived: bool = False) -> list[dict[str, Any]]:
    if include_archived:
        rows = conn.execute("SELECT * FROM tech_directions ORDER BY created_at, name").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM tech_directions WHERE status != 'archived' ORDER BY created_at, name"
        ).fetchall()
    return [_row_dict(row) for row in rows]


def rename_direction(conn: sqlite3.Connection, direction_id: str, new_name: str) -> dict[str, Any]:
    direction = get_direction(conn, direction_id)
    clean_name = _clean_name(new_name)
    stamp = now()
    _upsert_alias(conn, direction["name"], direction_id, stamp)
    conn.execute(
        """
        UPDATE tech_directions
        SET name = ?, updated_at = ?, version = version + 1
        WHERE direction_id = ?
        """,
        (clean_name, stamp, direction_id),
    )
    _upsert_alias(conn, clean_name, direction_id, stamp)
    conn.execute(
        """
        UPDATE asset_direction_links
        SET direction_name = ?, updated_at = ?, version = version + 1
        WHERE direction_id = ?
        """,
        (clean_name, stamp, direction_id),
    )
    conn.commit()
    return get_direction(conn, direction_id)


def archive_direction(conn: sqlite3.Connection, direction_id: str) -> dict[str, Any]:
    return _set_direction_status(conn, direction_id, "archived")


def restore_direction(conn: sqlite3.Connection, direction_id: str) -> dict[str, Any]:
    return _set_direction_status(conn, direction_id, "active")


def link_asset_direction(
    conn: sqlite3.Connection,
    *,
    asset_id: str,
    asset_type: str,
    direction_name: str = "",
    direction_id: str = "",
) -> dict[str, Any]:
    direction = get_direction(conn, direction_id) if direction_id else resolve_direction(conn, direction_name)
    stamp = now()
    clean_asset_id = str(asset_id).strip()
    clean_asset_type = str(asset_type).strip()
    link_id = f"dirlink-{_slug(clean_asset_type)}-{_slug(clean_asset_id)}-{direction['direction_id']}"
    conn.execute(
        """
        INSERT INTO asset_direction_links (
            link_id, asset_id, asset_type, direction_id, direction_name, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(link_id) DO UPDATE SET
            direction_id = excluded.direction_id,
            direction_name = excluded.direction_name,
            updated_at = excluded.updated_at,
            version = asset_direction_links.version + 1
        """,
        (
            link_id,
            clean_asset_id,
            clean_asset_type,
            direction["direction_id"],
            direction["name"],
            stamp,
            stamp,
        ),
    )
    conn.commit()
    return _row_dict(conn.execute("SELECT * FROM asset_direction_links WHERE link_id = ?", (link_id,)).fetchone())


def seed_directions_from_names(conn: sqlite3.Connection, names: list[str]) -> list[dict[str, Any]]:
    for name in names:
        ensure_direction(conn, name=name)
    return list_directions(conn)


def read_direction_registry(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    directions = list_directions(conn)
    aliases = [
        _row_dict(row)
        for row in conn.execute(
            """
            SELECT alias, direction_id
            FROM direction_aliases
            ORDER BY created_at, alias
            """
        ).fetchall()
    ]
    return {"techDirections": directions, "directionAliases": aliases}


def _set_direction_status(conn: sqlite3.Connection, direction_id: str, status: str) -> dict[str, Any]:
    stamp = now()
    conn.execute(
        """
        UPDATE tech_directions
        SET status = ?, updated_at = ?, version = version + 1
        WHERE direction_id = ?
        """,
        (status, stamp, direction_id),
    )
    conn.commit()
    return get_direction(conn, direction_id)


def _find_direction(conn: sqlite3.Connection, name: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM tech_directions WHERE name = ?", (name,)).fetchone()
    if row is not None:
        return _row_dict(row)
    alias = conn.execute("SELECT direction_id FROM direction_aliases WHERE alias = ?", (name,)).fetchone()
    if alias is None:
        return None
    return get_direction(conn, alias["direction_id"])


def _upsert_alias(conn: sqlite3.Connection, alias: str, direction_id: str, stamp: str) -> None:
    conn.execute(
        """
        INSERT INTO direction_aliases (alias, direction_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(alias) DO UPDATE SET
            direction_id = excluded.direction_id,
            updated_at = excluded.updated_at,
            version = direction_aliases.version + 1
        """,
        (_clean_name(alias), direction_id, stamp, stamp),
    )


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _clean_name(name: str) -> str:
    return str(name or "").strip() or UNCATEGORIZED_NAME


def _slug(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in str(value))
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")[:96] or "item"
