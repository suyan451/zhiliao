from __future__ import annotations

import hashlib
import json
import sqlite3
from typing import Any

from .db import now
from .drafts import create_draft, get_draft
from .research_lifecycle import normalize_research_status


SOURCE_TYPES = {
    "paper_brief": {
        "draft_type": "research_paper",
        "title_key": "title",
        "fallback_title": "未命名论文简报",
        "required": ("title", "direction", "summary", "industrialValue"),
    },
    "project_review": {
        "draft_type": "project_case",
        "title_key": "title",
        "fallback_title": "未命名项目复盘",
        "required": ("title", "direction", "requirements", "keyTech"),
    },
    "dataset_note": {
        "draft_type": "dataset_card",
        "title_key": "title",
        "fallback_title": "未命名数据说明",
        "required": ("title", "direction", "path", "characteristics"),
    },
    "tech_template": {
        "draft_type": "tech_card",
        "title_key": "techName",
        "fallback_title": "未命名技术卡模板",
        "required": ("techName", "direction", "principle", "applicationEffect"),
    },
}


def import_text_package(conn: sqlite3.Connection, *, source_type: str, raw_content: str) -> dict[str, Any]:
    clean_source_type = str(source_type or "").strip()
    raw = str(raw_content or "").strip()
    if clean_source_type not in SOURCE_TYPES:
        raise ValueError(f"Unsupported import source_type: {source_type}")
    if not raw:
        raise ValueError("Import content is required")

    source_hash = _source_hash(raw)
    existing = conn.execute(
        "SELECT * FROM import_packages WHERE source_type = ? AND source_hash = ?",
        (clean_source_type, source_hash),
    ).fetchone()
    if existing:
        return _duplicate_result(conn, existing)

    stamp = now()
    package_id = f"import-{clean_source_type}-{source_hash[:16]}"
    job_id = f"ingest-{clean_source_type}-{source_hash[:16]}"
    conn.execute(
        """
        INSERT INTO import_packages (
            package_id, source_type, source_hash, raw_content, status,
            metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (package_id, clean_source_type, source_hash, raw, "uploaded", "{}", stamp, stamp),
    )
    conn.execute(
        """
        INSERT INTO ingestion_jobs (
            job_id, package_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (job_id, package_id, "running", stamp, stamp),
    )
    conn.commit()

    parsed = _parse_by_source_type(clean_source_type, raw)
    confidence = _confidence(clean_source_type, parsed)
    config = SOURCE_TYPES[clean_source_type]
    title = parsed.get(config["title_key"]) or config["fallback_title"]
    payload = {
        **parsed,
        "body": raw,
        "import": {
            "package_id": package_id,
            "source_type": clean_source_type,
            "source_hash": source_hash,
            "confidence": confidence,
        },
    }
    draft = create_draft(conn, draft_type=config["draft_type"], title=title, payload=payload)
    report = {
        "draft_id": draft["draft_id"],
        "draft_type": draft["draft_type"],
        "title": title,
        "confidence": confidence,
        "fields": sorted(parsed.keys()),
    }
    stamp = now()
    conn.execute(
        """
        UPDATE import_packages
        SET status = ?, metadata_json = ?, updated_at = ?, version = version + 1
        WHERE package_id = ?
        """,
        ("draft_created", json.dumps(report, ensure_ascii=False, sort_keys=True), stamp, package_id),
    )
    conn.execute(
        """
        UPDATE ingestion_jobs
        SET status = ?, result_json = ?, updated_at = ?, version = version + 1
        WHERE job_id = ?
        """,
        ("succeeded", json.dumps(report, ensure_ascii=False, sort_keys=True), stamp, job_id),
    )
    conn.commit()
    return {"duplicate": False, "package_id": package_id, "job_id": job_id, "confidence": confidence, "draft": draft}


def _duplicate_result(conn: sqlite3.Connection, package: sqlite3.Row) -> dict[str, Any]:
    metadata = json.loads(package["metadata_json"] or "{}")
    draft_id = metadata.get("draft_id")
    draft = get_draft(conn, draft_id) if draft_id else None
    return {
        "duplicate": True,
        "package_id": package["package_id"],
        "job_id": "",
        "confidence": float(metadata.get("confidence") or 0),
        "draft": draft,
    }


def _parse_by_source_type(source_type: str, raw: str) -> dict[str, str]:
    sections = _collect_sections(raw)
    if source_type == "paper_brief":
        parsed = _apply_aliases(
            sections,
            {
                "title": ("标题", "论文标题", "paper title", "title"),
                "direction": ("技术方向", "方向", "direction"),
                "status": ("验证状态", "状态", "status"),
                "officialGithub": ("官方 github", "github", "官方代码仓库", "代码仓库", "repo"),
                "paperUrl": ("原文链接", "论文链接", "paper", "paper url", "url"),
                "summary": ("论文概要", "概要", "摘要", "summary"),
                "directionKeywords": ("技术方向关键词", "方向关键词", "关键词", "keywords"),
                "industrialValue": ("工业价值", "对工业场景的技术价值", "技术价值", "industrial value"),
                "experimentObservation": ("实验现象", "验证现象", "实验结果", "observation"),
                "failureReason": ("失败原因", "失败分析", "无效原因", "failure reason"),
                "verificationConclusion": ("验证结论", "实验结论", "conclusion"),
                "experimentExperience": ("实验经验", "验证经验", "experience"),
            },
        )
        if "status" in parsed:
            parsed["status"] = normalize_research_status(parsed["status"])
        else:
            parsed["status"] = "待读"
        return parsed
    if source_type == "project_review":
        return _apply_aliases(
            sections,
            {
                "title": ("项目名称", "标题", "项目", "project title", "title"),
                "direction": ("技术方向", "方向", "direction"),
                "status": ("项目状态", "状态", "status"),
                "requirements": ("核心项目需求", "项目需求", "需求", "requirements"),
                "metricSpec": ("规格指标", "指标", "验收指标", "metrics"),
                "keyTech": ("关键技术", "技术方案", "key tech", "key technology"),
                "flow": ("方案流程图", "方案流程", "流程", "flow"),
                "experience": ("项目经验", "经验", "复盘", "retrospective"),
                "docPath": ("文档路径", "文档", "doc", "doc path"),
            },
        )
    if source_type == "tech_template":
        return _apply_aliases(
            sections,
            {
                "techName": ("技术名称", "名称", "子技术", "tech name", "title"),
                "direction": ("技术方向", "方向", "direction"),
                "officialPaperLink": ("官方论文链接", "论文链接", "paper url", "paper"),
                "codeRepo": ("官方代码仓库", "代码仓库", "github", "repo"),
                "lineage": ("技术脉络图", "技术脉络", "lineage"),
                "principle": ("技术原理", "原理", "principle"),
                "applicationEffect": ("应用效果", "效果", "application effect"),
                "strengths": ("优势", "优点", "strengths"),
                "limitations": ("不足", "限制", "limitations"),
                "projectUsage": ("项目使用记录", "项目应用", "project usage"),
            },
        )
    return _apply_aliases(
        sections,
        {
            "title": ("数据名称", "数据集名称", "标题", "dataset title", "title"),
            "direction": ("技术方向", "方向", "direction"),
            "path": ("数据路径", "路径", "path"),
            "characteristics": ("数据特点", "特点", "场景信息", "characteristics"),
            "taskFit": ("适配任务", "任务", "task", "task fit"),
            "processingNotes": ("数据处理要点", "处理要点", "处理流程", "processing notes"),
            "quality": ("数据质量", "质量", "quality"),
            "labelQuality": ("标注质量", "标注", "label quality"),
            "categories": ("类别信息", "类别", "classes", "categories"),
            "sampleImagesText": ("样例图片路径", "样例图", "样例图片", "sample images"),
        },
    )


def _collect_sections(raw: str) -> dict[str, str]:
    sections: dict[str, list[str]] = {}
    current = ""
    for raw_line in raw.splitlines():
        line = raw_line.strip()
        if not line:
            if current:
                sections[current].append("")
            continue
        if line.startswith("#"):
            current = _normalize_label(line.lstrip("#").strip())
            sections.setdefault(current, [])
            continue
        if "：" in line or ":" in line:
            separator = "：" if "：" in line else ":"
            label, value = line.split(separator, 1)
            if 2 <= len(label.strip()) <= 32:
                current = _normalize_label(label.lstrip("-* ").strip())
                sections[current] = [value.strip()]
                continue
        if current:
            sections[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def _apply_aliases(sections: dict[str, str], aliases_by_key: dict[str, tuple[str, ...]]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    normalized = {_normalize_label(key): value for key, value in sections.items()}
    for key, aliases in aliases_by_key.items():
        for alias in aliases:
            value = normalized.get(_normalize_label(alias), "")
            if value:
                parsed[key] = value
                break
    return parsed


def _confidence(source_type: str, parsed: dict[str, str]) -> float:
    required = SOURCE_TYPES[source_type]["required"]
    hit_count = sum(1 for key in required if parsed.get(key))
    return round(hit_count / len(required), 2)


def _source_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _normalize_label(label: str) -> str:
    return " ".join(str(label or "").strip().rstrip("：:").lower().split())
