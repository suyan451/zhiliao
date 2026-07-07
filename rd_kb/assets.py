from __future__ import annotations

from pathlib import Path


def validate_dataset_path(path: str) -> str:
    raw = str(path or "").strip()
    if not raw:
        return "未填写"
    return "路径可访问" if Path(raw).exists() else "路径不可访问"
