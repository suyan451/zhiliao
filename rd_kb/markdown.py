from __future__ import annotations

from pathlib import Path
from typing import Mapping

from .paths import TEMPLATE_DIR


def render_template(template_name: str, values: Mapping[str, object]) -> str:
    template = (TEMPLATE_DIR / template_name).read_text(encoding="utf-8")
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", "" if value is None else str(value))
    return rendered


def write_markdown(path: Path, template_name: str, values: Mapping[str, object]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_template(template_name, values), encoding="utf-8")
    return str(path)
