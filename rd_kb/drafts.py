from __future__ import annotations

import json
import sqlite3
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .custom_assets import (
    upsert_dataset_card,
    upsert_project_card,
    upsert_research_card,
    upsert_subtech_card,
)
from .git_store import inspect_git_repo
from .schema import (
    SCHEMA_VERSION,
    render_markdown_document,
    serialize_blocks_to_markdown,
    validate_markdown_document,
)


class DraftStateError(ValueError):
    """Raised when a draft lifecycle transition is not allowed."""


class PublishError(RuntimeError):
    """Raised when a draft cannot be published to Markdown/Git."""


@dataclass(frozen=True)
class PublishResult:
    draft_id: str
    document_id: str
    document_path: str
    git_commit: str
    target_module: str
    target_entity_type: str
    published_entity_id: str
    redirect_path: str


DOCUMENT_FOLDERS = {
    "tech_card": "knowledge/tech_cards",
    "research_paper": "knowledge/research_papers",
    "project_case": "knowledge/project_cases",
    "dataset_card": "knowledge/dataset_cards",
    "best_practice": "knowledge/best_practices",
    "experiment_record": "knowledge/experiment_records",
}


PUBLISH_TARGETS = {
    "tech_card": ("technology", "tech_card", "/technology/tech-cards/{id}"),
    "research_paper": ("research", "research_paper", "/research/papers/{id}"),
    "project_case": ("project", "project_case", "/projects/{id}"),
    "dataset_card": ("dataset", "dataset_card", "/datasets/{id}"),
    "best_practice": ("technology", "best_practice", "/technology/best-practices/{id}"),
    "experiment_record": ("research", "experiment_record", "/research/experiments/{id}"),
}


def create_draft(
    conn: sqlite3.Connection,
    *,
    draft_type: str,
    title: str,
    payload: dict[str, Any],
    draft_id: str | None = None,
) -> dict[str, Any]:
    stamp = _now_iso()
    clean_id = draft_id or f"draft-{_slug(title)}-{_compact_timestamp()}"
    conn.execute(
        """
        INSERT INTO knowledge_drafts (
            draft_id, draft_type, title, status, payload_json,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            clean_id,
            draft_type,
            title,
            "draft",
            json.dumps(payload, ensure_ascii=False, sort_keys=True),
            stamp,
            stamp,
        ),
    )
    conn.commit()
    return get_draft(conn, clean_id)


def get_draft(conn: sqlite3.Connection, draft_id: str) -> dict[str, Any]:
    row = conn.execute("SELECT * FROM knowledge_drafts WHERE draft_id = ?", (draft_id,)).fetchone()
    if row is None:
        raise KeyError(f"Draft not found: {draft_id}")
    return _draft_dict(row)


ACTIVE_DRAFT_STATUSES = ("draft", "submitted", "approved")


def list_drafts(
    conn: sqlite3.Connection,
    *,
    status: str | None = None,
    active_only: bool = False,
) -> list[dict[str, Any]]:
    if status:
        rows = conn.execute(
            "SELECT * FROM knowledge_drafts WHERE status = ? ORDER BY updated_at DESC, created_at DESC",
            (status,),
        ).fetchall()
    elif active_only:
        placeholders = ", ".join("?" for _ in ACTIVE_DRAFT_STATUSES)
        rows = conn.execute(
            f"SELECT * FROM knowledge_drafts WHERE status IN ({placeholders}) ORDER BY updated_at DESC, created_at DESC",
            ACTIVE_DRAFT_STATUSES,
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM knowledge_drafts ORDER BY updated_at DESC, created_at DESC").fetchall()
    return [_draft_dict(row) for row in rows]


def update_draft(
    conn: sqlite3.Connection,
    draft_id: str,
    *,
    title: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    draft = get_draft(conn, draft_id)
    if draft["status"] in {"published", "archived"}:
        raise DraftStateError(f"Cannot edit {draft['status']} draft")

    current_payload = dict(draft.get("payload") or {})
    if payload:
        current_payload.update(payload)
    clean_title = str(title or draft["title"]).strip() or draft["title"]
    stamp = _now_iso()
    conn.execute(
        """
        UPDATE knowledge_drafts
        SET title = ?, status = ?, payload_json = ?, updated_at = ?, version = version + 1
        WHERE draft_id = ?
        """,
        (
            clean_title,
            "draft",
            json.dumps(current_payload, ensure_ascii=False, sort_keys=True),
            stamp,
            draft_id,
        ),
    )
    conn.commit()
    return get_draft(conn, draft_id)


def submit_draft(conn: sqlite3.Connection, draft_id: str) -> dict[str, Any]:
    draft = get_draft(conn, draft_id)
    if draft["status"] != "draft":
        raise DraftStateError(f"Only draft can be submitted, got {draft['status']}")
    return _set_draft_status(conn, draft_id, "submitted")


def approve_draft(conn: sqlite3.Connection, draft_id: str) -> dict[str, Any]:
    draft = get_draft(conn, draft_id)
    if draft["status"] != "submitted":
        raise DraftStateError(f"Only submitted draft can be approved, got {draft['status']}")
    return _set_draft_status(conn, draft_id, "approved")


def archive_draft(conn: sqlite3.Connection, draft_id: str, *, reason: str = "") -> dict[str, Any]:
    draft = get_draft(conn, draft_id)
    stamp = _now_iso()
    archive_id = f"archive-{_slug(draft_id)}-{_compact_timestamp()}"
    restore_payload = {"previous_status": draft["status"]}
    conn.execute(
        """
        INSERT INTO archive_records (
            archive_id, object_type, object_id, reason, archived_at,
            restore_payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            archive_id,
            "draft",
            draft_id,
            reason,
            stamp,
            json.dumps(restore_payload, ensure_ascii=False, sort_keys=True),
            stamp,
            stamp,
        ),
    )
    conn.execute(
        "UPDATE knowledge_drafts SET status = ?, updated_at = ?, version = version + 1 WHERE draft_id = ?",
        ("archived", stamp, draft_id),
    )
    conn.commit()
    return _row_dict(conn.execute("SELECT * FROM archive_records WHERE archive_id = ?", (archive_id,)).fetchone())


def restore_archived_draft(conn: sqlite3.Connection, archive_id: str) -> dict[str, Any]:
    archive = conn.execute("SELECT * FROM archive_records WHERE archive_id = ?", (archive_id,)).fetchone()
    if archive is None:
        raise KeyError(f"Archive record not found: {archive_id}")
    archive_dict = _row_dict(archive)
    if archive_dict["object_type"] != "draft":
        raise DraftStateError(f"Unsupported archive object_type: {archive_dict['object_type']}")
    payload = json.loads(archive_dict["restore_payload_json"] or "{}")
    restored_status = payload.get("previous_status") or "draft"
    stamp = _now_iso()
    conn.execute(
        "UPDATE knowledge_drafts SET status = ?, updated_at = ?, version = version + 1 WHERE draft_id = ?",
        (restored_status, stamp, archive_dict["object_id"]),
    )
    conn.execute(
        "UPDATE archive_records SET restored_at = ?, updated_at = ?, version = version + 1 WHERE archive_id = ?",
        (stamp, stamp, archive_id),
    )
    conn.commit()
    return get_draft(conn, archive_dict["object_id"])


def list_archive_records(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM archive_records ORDER BY archived_at DESC").fetchall()
    return [_row_dict(row) for row in rows]


def publish_draft(
    conn: sqlite3.Connection,
    draft_id: str,
    repo_root: Path,
    *,
    auto_approve: bool = False,
    allow_dirty_worktree: bool = False,
) -> PublishResult:
    draft = get_draft(conn, draft_id)
    if draft["status"] != "approved":
        if auto_approve and draft["status"] in {"draft", "submitted"}:
            draft = _set_draft_status(conn, draft_id, "approved")
        else:
            raise DraftStateError(f"Only approved draft can be published, got {draft['status']}")

    status = inspect_git_repo(repo_root)
    dirty_error = ""
    if not status.publishable:
        dirty_error = f"Git repository is not publishable: {status.error or status.dirty_files}"
        if not allow_dirty_worktree:
            _record_publish_failure(conn, draft_id, "", dirty_error)
            raise PublishError("Git repository is not publishable")

    payload = json.loads(draft["payload_json"] or "{}")
    document_id = str(payload.get("document_id") or f"{draft['draft_type']}-{_slug(draft['title'])}")
    document_path = _document_path(draft["draft_type"], document_id)
    markdown = _render_draft_markdown(draft, payload, document_id)
    validation = validate_markdown_document(markdown)
    if not validation.ok:
        message = "; ".join(validation.errors)
        _record_publish_failure(conn, draft_id, document_id, message)
        raise PublishError(message)

    job_id = f"git-job-{_slug(draft_id)}-{_compact_timestamp()}"
    stamp = _now_iso()
    conn.execute(
        """
        INSERT INTO git_publish_jobs (
            job_id, draft_id, document_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        """,
        (job_id, draft_id, document_id, "writing_files", stamp, stamp),
    )
    conn.commit()

    target = repo_root / document_path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(markdown, encoding="utf-8")

    git_commit = ""
    job_status = "pending_git" if dirty_error else "committed"
    job_error = dirty_error
    if not dirty_error:
        try:
            _git(repo_root, "add", document_path)
            _git(repo_root, "commit", "-m", f"Publish {draft['draft_type']}: {draft['title']}")
            git_commit = _git(repo_root, "rev-parse", "HEAD").stdout.strip()
        except PublishError as error:
            stamp = _now_iso()
            conn.execute(
                """
                UPDATE git_publish_jobs
                SET status = ?, error = ?, updated_at = ?, version = version + 1
                WHERE job_id = ?
                """,
                ("failed", str(error), stamp, job_id),
            )
            conn.commit()
            raise

    target_module, target_entity_type, published_entity_id, redirect_path = _publish_target(draft["draft_type"], document_id)
    _record_successful_publish(
        conn,
        draft,
        payload,
        document_id,
        document_path,
        git_commit,
        job_id,
        target_module=target_module,
        target_entity_type=target_entity_type,
        published_entity_id=published_entity_id,
        redirect_path=redirect_path,
        job_status=job_status,
        job_error=job_error,
    )
    return PublishResult(
        draft_id=draft_id,
        document_id=document_id,
        document_path=document_path,
        git_commit=git_commit,
        target_module=target_module,
        target_entity_type=target_entity_type,
        published_entity_id=published_entity_id,
        redirect_path=redirect_path,
    )


def _record_successful_publish(
    conn: sqlite3.Connection,
    draft: dict[str, Any],
    payload: dict[str, Any],
    document_id: str,
    document_path: str,
    git_commit: str,
    job_id: str,
    *,
    target_module: str,
    target_entity_type: str,
    published_entity_id: str,
    redirect_path: str,
    job_status: str = "committed",
    job_error: str = "",
) -> None:
    stamp = _now_iso()
    content_hash = str(payload.get("content_hash") or "")
    _materialize_workspace_card(conn, draft, payload, document_id, document_path)
    conn.execute(
        """
        INSERT INTO documents (
            document_id, document_type, title, status, document_path,
            schema_version, content_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(document_id) DO UPDATE SET
            title = excluded.title,
            status = excluded.status,
            document_path = excluded.document_path,
            schema_version = excluded.schema_version,
            content_hash = excluded.content_hash,
            updated_at = excluded.updated_at,
            version = documents.version + 1
        """,
        (
            document_id,
            draft["draft_type"],
            draft["title"],
            "published",
            document_path,
            SCHEMA_VERSION,
            content_hash,
            draft["created_at"],
            stamp,
        ),
    )
    version_row = conn.execute(
        "SELECT COALESCE(MAX(document_version), 0) + 1 AS next_version FROM document_versions WHERE document_id = ?",
        (document_id,),
    ).fetchone()
    document_version = int(version_row["next_version"])
    conn.execute(
        """
        INSERT INTO document_versions (
            document_id, document_version, git_commit, content_hash,
            document_path, schema_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (document_id, document_version, git_commit, content_hash, document_path, SCHEMA_VERSION, stamp, stamp),
    )
    _insert_document_blocks(conn, document_id, payload.get("blocks") if isinstance(payload.get("blocks"), list) else [], stamp)
    conn.execute(
        """
        UPDATE knowledge_drafts
        SET status = ?, document_id = ?, updated_at = ?, version = version + 1
        WHERE draft_id = ?
        """,
        ("published", document_id, stamp, draft["draft_id"]),
    )
    conn.execute(
        """
        INSERT INTO published_knowledge (
            published_id, document_id, draft_id, document_path,
            git_commit, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"pub-{_slug(document_id)}-{document_version}",
            document_id,
            draft["draft_id"],
            document_path,
            git_commit,
            "published",
            stamp,
            stamp,
        ),
    )
    conn.execute(
        """
        INSERT INTO draft_publish_records (
            record_id, draft_id, document_id, target_module, target_entity_type,
            published_entity_id, redirect_path, git_commit, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            f"route-{_slug(draft['draft_id'])}-{_slug(document_id)}",
            draft["draft_id"],
            document_id,
            target_module,
            target_entity_type,
            published_entity_id,
            redirect_path,
            git_commit,
            stamp,
            stamp,
        ),
    )
    conn.execute(
        """
        UPDATE git_publish_jobs
        SET status = ?, git_commit = ?, error = ?, updated_at = ?, version = version + 1
        WHERE job_id = ?
        """,
        (job_status, git_commit, job_error, stamp, job_id),
    )
    conn.commit()


def _publish_target(draft_type: str, document_id: str) -> tuple[str, str, str, str]:
    module, entity_type, path_template = PUBLISH_TARGETS.get(
        draft_type,
        ("knowledge", draft_type, "/knowledge/{id}"),
    )
    published_entity_id = document_id
    return module, entity_type, published_entity_id, path_template.format(id=published_entity_id)


def _materialize_workspace_card(
    conn: sqlite3.Connection,
    draft: dict[str, Any],
    payload: dict[str, Any],
    document_id: str,
    document_path: str,
) -> None:
    card_payload = {**payload}
    card_payload["id"] = str(payload.get("id") or document_id)
    card_payload.setdefault("title", draft["title"])
    card_payload.setdefault("docPath", document_path)
    card_payload.setdefault("sourceDocumentId", document_id)

    draft_type = draft["draft_type"]
    if draft_type == "tech_card":
        card_payload["techName"] = str(payload.get("techName") or payload.get("title") or draft["title"])
        upsert_subtech_card(conn, card_payload, commit=False)
        return
    if draft_type == "research_paper":
        upsert_research_card(conn, card_payload, commit=False)
        return
    if draft_type == "project_case":
        upsert_project_card(conn, card_payload, commit=False)
        return
    if draft_type == "dataset_card":
        upsert_dataset_card(conn, card_payload, commit=False)


def _insert_document_blocks(conn: sqlite3.Connection, document_id: str, blocks: list[dict[str, Any]], stamp: str) -> None:
    conn.execute("DELETE FROM document_blocks WHERE document_id = ?", (document_id,))
    for index, block in enumerate(blocks, start=1):
        conn.execute(
            """
            INSERT INTO document_blocks (
                block_id, document_id, block_order, block_type, title,
                content, src, caption, table_text, code, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"{document_id}-block-{index}",
                document_id,
                index,
                str(block.get("type") or "text"),
                str(block.get("title") or ""),
                str(block.get("content") or ""),
                str(block.get("src") or ""),
                str(block.get("caption") or ""),
                str(block.get("tableText") or ""),
                str(block.get("code") or ""),
                stamp,
                stamp,
            ),
        )


def _record_publish_failure(conn: sqlite3.Connection, draft_id: str, document_id: str, error: str) -> None:
    stamp = _now_iso()
    conn.execute(
        """
        INSERT INTO git_publish_jobs (
            job_id, draft_id, document_id, status, error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (f"git-job-{_slug(draft_id)}-{_compact_timestamp()}", draft_id, document_id, "failed", error, stamp, stamp),
    )
    conn.commit()


def _render_draft_markdown(draft: dict[str, Any], payload: dict[str, Any], document_id: str) -> str:
    stamp = _now_iso()
    blocks = payload.get("blocks") if isinstance(payload.get("blocks"), list) else []
    sections = [str(payload.get("body") or "").strip(), serialize_blocks_to_markdown(blocks)]
    body = "\n\n".join(section for section in sections if section).strip()
    front_matter = {
        "schema_version": SCHEMA_VERSION,
        "document_id": document_id,
        "document_type": draft["draft_type"],
        "title": draft["title"],
        "status": "published",
        "created_at": draft["created_at"],
        "updated_at": stamp,
    }
    return render_markdown_document(front_matter, body)


def _set_draft_status(conn: sqlite3.Connection, draft_id: str, status: str) -> dict[str, Any]:
    stamp = _now_iso()
    conn.execute(
        "UPDATE knowledge_drafts SET status = ?, updated_at = ?, version = version + 1 WHERE draft_id = ?",
        (status, stamp, draft_id),
    )
    conn.commit()
    return get_draft(conn, draft_id)


def _document_path(draft_type: str, document_id: str) -> str:
    folder = DOCUMENT_FOLDERS.get(draft_type, "knowledge/misc")
    return f"{folder}/{_slug(document_id)}.md"


def _git(repo_root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(["git", "-C", str(repo_root), *args], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise PublishError((result.stderr or result.stdout or "git command failed").strip())
    return result


def _row_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {key: row[key] for key in row.keys()}


def _draft_dict(row: sqlite3.Row) -> dict[str, Any]:
    item = _row_dict(row)
    try:
        item["payload"] = json.loads(item.get("payload_json") or "{}")
    except json.JSONDecodeError:
        item["payload"] = {}
    return item


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _compact_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")


def _slug(value: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in cleaned:
        cleaned = cleaned.replace("--", "-")
    return cleaned.strip("-")[:96] or "item"
