from __future__ import annotations

import json
import sqlite3
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

def build_knowledge_audit(conn: sqlite3.Connection, repo_root: Path) -> dict[str, Any]:
    """Build a read-only maintenance report for DB, Markdown and publish state."""
    root = repo_root.resolve()
    unpublished_drafts = _query(
        conn,
        """
        SELECT draft_id, draft_type, title, status, document_id, updated_at
        FROM knowledge_drafts
        WHERE status IN ('draft', 'submitted', 'approved')
        ORDER BY updated_at DESC, created_at DESC
        """,
    )
    failed_publish_jobs = _query(
        conn,
        """
        SELECT job_id, draft_id, document_id, status, error, updated_at
        FROM git_publish_jobs
        WHERE status IN ('failed', 'error')
        ORDER BY updated_at DESC, created_at DESC
        """,
    )
    archived_records = _query(
        conn,
        """
        SELECT archive_id, object_type, object_id, reason, archived_at, restored_at
        FROM archive_records
        WHERE restored_at IS NULL OR restored_at = ''
        ORDER BY archived_at DESC
        """,
    )
    missing_markdown_documents = [
        item
        for item in _query(
            conn,
            """
            SELECT document_id, document_type, title, status, document_path, updated_at
            FROM documents
            WHERE COALESCE(document_path, '') != ''
            ORDER BY updated_at DESC, created_at DESC
            """,
        )
        if not _path_exists(root, item["document_path"])
    ]
    orphan_published_knowledge = _query(
        conn,
        """
        SELECT p.published_id, p.document_id, p.draft_id, p.document_path, p.status, p.updated_at
        FROM published_knowledge p
        LEFT JOIN documents d ON d.document_id = p.document_id
        LEFT JOIN knowledge_drafts k ON k.draft_id = p.draft_id
        WHERE d.document_id IS NULL OR (p.draft_id IS NOT NULL AND p.draft_id != '' AND k.draft_id IS NULL)
        ORDER BY p.updated_at DESC, p.created_at DESC
        """,
    )
    report = {
        "generated_at": _now_iso(),
        "repo_root": str(root),
        "summary": {
            "unpublished_drafts": len(unpublished_drafts),
            "failed_publish_jobs": len(failed_publish_jobs),
            "archived_records": len(archived_records),
            "missing_markdown_documents": len(missing_markdown_documents),
            "orphan_published_knowledge": len(orphan_published_knowledge),
        },
        "unpublished_drafts": unpublished_drafts,
        "failed_publish_jobs": failed_publish_jobs,
        "archived_records": archived_records,
        "missing_markdown_documents": missing_markdown_documents,
        "orphan_published_knowledge": orphan_published_knowledge,
    }
    return report


def create_knowledge_backup(repo_root: Path, output_dir: Path) -> Path:
    """Export Markdown knowledge, local DB and supporting config into one zip."""
    root = repo_root.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d-%H%M%S")
    backup_path = output_dir / f"knowledge-backup-{timestamp}.zip"
    included_paths = _collect_backup_paths(root)
    manifest = {
        "created_at": _now_iso(),
        "repo_root": str(root),
        "included_paths": [path.as_posix() for path in included_paths],
    }

    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("backup-manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        for relative_path in included_paths:
            archive.write(root / relative_path, relative_path.as_posix())

    return backup_path


def _collect_backup_paths(root: Path) -> list[Path]:
    include_roots = [
        root / "knowledge",
        root / "kb",
        root / "docs",
        root / "configs",
        root / "templates",
    ]
    include_files = [
        root / "data" / "rd_knowledge.db",
        root / "web" / "public" / "kb-data.json",
    ]
    paths: list[Path] = []
    for folder in include_roots:
        if not folder.exists():
            continue
        paths.extend(path for path in folder.rglob("*") if path.is_file())
    paths.extend(path for path in include_files if path.exists() and path.is_file())
    return sorted({path.relative_to(root) for path in paths}, key=lambda item: item.as_posix())


def _query(conn: sqlite3.Connection, sql: str) -> list[dict[str, Any]]:
    rows = conn.execute(sql).fetchall()
    return [{key: row[key] for key in row.keys()} for row in rows]


def _path_exists(root: Path, document_path: str) -> bool:
    path = Path(document_path)
    if path.is_absolute():
        return path.exists()
    return (root / path).exists()


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
