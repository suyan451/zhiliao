from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import PurePosixPath
from typing import Any


SCHEMA_VERSION = "1"

ALLOWED_DOCUMENT_TYPES = {
    "tech_card",
    "research_paper",
    "project_case",
    "dataset_card",
    "best_practice",
    "experiment_record",
}

ALLOWED_DOCUMENT_STATUSES = {
    "draft",
    "submitted",
    "approved",
    "published",
    "archived",
}

ALLOWED_BLOCK_TYPES = {
    "text",
    "image",
    "table",
    "mermaid",
    "file",
}

REQUIRED_FRONT_MATTER_FIELDS = (
    "schema_version",
    "document_id",
    "document_type",
    "title",
    "status",
    "created_at",
    "updated_at",
)


class ValidationError(ValueError):
    """Raised when a knowledge document block cannot be safely serialized."""


@dataclass(frozen=True)
class MarkdownValidationResult:
    ok: bool
    front_matter: dict[str, str]
    body: str
    errors: list[str]
    warnings: list[str]


def parse_front_matter(markdown: str) -> tuple[dict[str, str], str, list[str]]:
    errors: list[str] = []
    if not markdown.startswith("---\n"):
        return {}, markdown, ["Missing front matter block"]

    end = markdown.find("\n---", 4)
    if end == -1:
        return {}, markdown, ["Unclosed front matter block"]

    raw_header = markdown[4:end]
    body = markdown[end + len("\n---") :].lstrip("\n")
    front_matter: dict[str, str] = {}
    for line_no, line in enumerate(raw_header.splitlines(), start=1):
        clean = line.strip()
        if not clean or clean.startswith("#"):
            continue
        if ":" not in clean:
            errors.append(f"Invalid front matter line {line_no}: {line}")
            continue
        key, value = clean.split(":", 1)
        front_matter[key.strip()] = value.strip().strip('"')
    return front_matter, body, errors


def render_markdown_document(front_matter: dict[str, Any], body: str) -> str:
    lines = ["---"]
    for key, value in front_matter.items():
        lines.append(f"{key}: {value}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def validate_markdown_document(markdown: str) -> MarkdownValidationResult:
    front_matter, body, errors = parse_front_matter(markdown)
    warnings: list[str] = []

    for field in REQUIRED_FRONT_MATTER_FIELDS:
        if not front_matter.get(field):
            errors.append(f"Missing required front matter field: {field}")

    schema_version = front_matter.get("schema_version")
    if schema_version and schema_version != SCHEMA_VERSION:
        errors.append(f"Unsupported schema_version: {schema_version}")

    document_type = front_matter.get("document_type")
    if document_type and document_type not in ALLOWED_DOCUMENT_TYPES:
        errors.append(f"Unsupported document_type: {document_type}")

    status = front_matter.get("status")
    if status and status not in ALLOWED_DOCUMENT_STATUSES:
        errors.append(f"Unsupported status: {status}")

    for date_field in ("created_at", "updated_at"):
        raw = front_matter.get(date_field)
        if raw and not _is_iso_datetime(raw):
            errors.append(f"{date_field} must be ISO-8601 datetime: {raw}")

    if not body.strip():
        warnings.append("Document body is empty")

    return MarkdownValidationResult(
        ok=not errors,
        front_matter=front_matter,
        body=body,
        errors=errors,
        warnings=warnings,
    )


def validate_blocks(blocks: list[dict[str, Any]]) -> None:
    for index, block in enumerate(blocks, start=1):
        block_type = str(block.get("type") or "text")
        if block_type not in ALLOWED_BLOCK_TYPES:
            raise ValidationError(f"Unsupported block type: {block_type}")
        src = str(block.get("src") or "")
        if block_type in {"image", "file"} and src and not is_safe_relative_asset_path(src):
            raise ValidationError(f"Unsafe asset path in block {index}: {src}")


def serialize_blocks_to_markdown(blocks: list[dict[str, Any]]) -> str:
    validate_blocks(blocks)
    chunks: list[str] = []
    for block in blocks:
        block_type = str(block.get("type") or "text")
        title = str(block.get("title") or "").strip()
        content = str(block.get("content") or "").strip()
        src = str(block.get("src") or "").strip()
        caption = str(block.get("caption") or title).strip()
        table_text = str(block.get("tableText") or "").strip()
        code = str(block.get("code") or "").strip()

        if title:
            chunks.append(f"## {title}")
        if block_type == "text" and content:
            chunks.append(content)
        elif block_type == "image" and src:
            chunks.append(f"![{caption}]({src})")
        elif block_type == "table" and table_text:
            chunks.append(table_text)
        elif block_type == "mermaid" and code:
            chunks.append(f"```mermaid\n{code}\n```")
        elif block_type == "file" and src:
            label = caption or src
            chunks.append(f"[{label}]({src})")
    return "\n\n".join(chunks).strip()


def is_safe_relative_asset_path(path: str) -> bool:
    if not path or path.startswith("/") or "://" in path:
        return False
    posix = PurePosixPath(path)
    if posix.is_absolute():
        return False
    return ".." not in posix.parts


def _is_iso_datetime(value: str) -> bool:
    try:
        datetime.fromisoformat(value)
    except ValueError:
        return False
    return True
