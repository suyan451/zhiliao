from __future__ import annotations

import json
import sqlite3
from typing import Any

from .assets import validate_dataset_path
from .db import now
from .research_lifecycle import transition_research_status


def text(value: Any) -> str:
    return "" if value is None else str(value)


def custom_fields_json(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps([text(item) for item in value], ensure_ascii=False)
    if not value:
        return "[]"
    return json.dumps([text(value)], ensure_ascii=False)


def parse_custom_fields(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [text(item) for item in parsed]


def list_json(value: Any) -> str:
    if isinstance(value, list):
        return json.dumps([text(item) for item in value if text(item)], ensure_ascii=False)
    if not value:
        return "[]"
    return json.dumps([text(value)], ensure_ascii=False)


def parse_list_json(value: str | None) -> list[str]:
    return parse_custom_fields(value)


def blocks_json(value: Any) -> str:
    if not isinstance(value, list):
        return "[]"
    blocks: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        block = {
            "type": text(item.get("type")) or "text",
            "title": text(item.get("title")),
            "content": text(item.get("content")),
            "src": text(item.get("src")),
            "caption": text(item.get("caption")),
            "tableText": text(item.get("tableText")),
            "code": text(item.get("code")),
        }
        if any(block[key] for key in ("title", "content", "src", "caption", "tableText", "code")):
            blocks.append(block)
    return json.dumps(blocks, ensure_ascii=False)


def parse_blocks_json(value: str | None) -> list[dict[str, str]]:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [
        {
            "type": text(item.get("type")) or "text",
            "title": text(item.get("title")),
            "content": text(item.get("content")),
            "src": text(item.get("src")),
            "caption": text(item.get("caption")),
            "tableText": text(item.get("tableText")),
            "code": text(item.get("code")),
        }
        for item in parsed
        if isinstance(item, dict)
    ]


def upsert_direction(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    stamp = now()
    name = text(payload.get("name")).strip()
    if not name:
        raise ValueError("Direction name is required")
    row = {
        "name": name,
        "summary": text(payload.get("summary")),
    }
    conn.execute(
        """
        INSERT INTO ui_directions (name, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(name) DO UPDATE SET
            summary = excluded.summary,
            updated_at = excluded.updated_at
        """,
        (row["name"], row["summary"], stamp, stamp),
    )
    conn.commit()
    return row


def upsert_subtech_card(conn: sqlite3.Connection, payload: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    stamp = now()
    card_id = text(payload.get("id")).strip() or f"subtech-{stamp.replace(' ', '-').replace(':', '')}"
    row = {
        "id": card_id,
        "direction": text(payload.get("direction")),
        "techName": text(payload.get("techName")),
        "officialPaperLink": text(payload.get("officialPaperLink")),
        "codeRepo": text(payload.get("codeRepo")),
        "lineage": text(payload.get("lineage")),
        "principle": text(payload.get("principle")),
        "applicationEffect": text(payload.get("applicationEffect")),
        "strengths": text(payload.get("strengths")),
        "limitations": text(payload.get("limitations")),
        "projectUsage": text(payload.get("projectUsage")),
        "relatedProjects": payload.get("relatedProjects") if isinstance(payload.get("relatedProjects"), list) else parse_list_json(text(payload.get("relatedProjects")).replace(",", "\n").replace("，", "\n")),
        "relatedDatasets": payload.get("relatedDatasets") if isinstance(payload.get("relatedDatasets"), list) else parse_list_json(text(payload.get("relatedDatasets")).replace(",", "\n").replace("，", "\n")),
        "relatedPapers": payload.get("relatedPapers") if isinstance(payload.get("relatedPapers"), list) else parse_list_json(text(payload.get("relatedPapers")).replace(",", "\n").replace("，", "\n")),
        "relatedTechCards": payload.get("relatedTechCards") if isinstance(payload.get("relatedTechCards"), list) else parse_list_json(text(payload.get("relatedTechCards")).replace(",", "\n").replace("，", "\n")),
        "customFields": payload.get("customFields") if isinstance(payload.get("customFields"), list) else [],
        "blocks": payload.get("blocks") if isinstance(payload.get("blocks"), list) else [],
    }
    if not row["techName"]:
        raise ValueError("Technology name is required")
    conn.execute(
        """
        INSERT INTO subtech_cards (
            id, direction, tech_name, official_paper_link, code_repo, lineage, principle,
            application_effect, strengths, limitations, project_usage, related_projects_json,
            related_datasets_json, related_papers_json, related_tech_cards_json,
            custom_fields_json, blocks_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            direction = excluded.direction,
            tech_name = excluded.tech_name,
            official_paper_link = excluded.official_paper_link,
            code_repo = excluded.code_repo,
            lineage = excluded.lineage,
            principle = excluded.principle,
            application_effect = excluded.application_effect,
            strengths = excluded.strengths,
            limitations = excluded.limitations,
            project_usage = excluded.project_usage,
            related_projects_json = excluded.related_projects_json,
            related_datasets_json = excluded.related_datasets_json,
            related_papers_json = excluded.related_papers_json,
            related_tech_cards_json = excluded.related_tech_cards_json,
            custom_fields_json = excluded.custom_fields_json,
            blocks_json = excluded.blocks_json,
            updated_at = excluded.updated_at
        """,
        (
            row["id"],
            row["direction"],
            row["techName"],
            row["officialPaperLink"],
            row["codeRepo"],
            row["lineage"],
            row["principle"],
            row["applicationEffect"],
            row["strengths"],
            row["limitations"],
            row["projectUsage"],
            list_json(row["relatedProjects"]),
            list_json(row["relatedDatasets"]),
            list_json(row["relatedPapers"]),
            list_json(row["relatedTechCards"]),
            custom_fields_json(row["customFields"]),
            blocks_json(row["blocks"]),
            stamp,
            stamp,
        ),
    )
    if commit:
        conn.commit()
    return row


def upsert_research_card(conn: sqlite3.Connection, payload: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    stamp = now()
    card_id = text(payload.get("id")).strip() or f"research-{stamp.replace(' ', '-').replace(':', '')}"
    existing = conn.execute("SELECT * FROM research_cards WHERE id = ?", (card_id,)).fetchone()
    previous_status = existing["status"] if existing else "待读"
    requested_status = text(payload.get("status")) or previous_status
    lifecycle_payload = _research_lifecycle_payload(existing, payload)
    row = {
        "id": card_id,
        "title": text(payload.get("title")),
        "direction": text(payload.get("direction")),
        "status": transition_research_status(previous_status, requested_status, lifecycle_payload),
        "officialGithub": text(payload.get("officialGithub")),
        "paperUrl": text(payload.get("paperUrl")),
        "summary": text(payload.get("summary")),
        "directionKeywords": text(payload.get("directionKeywords")),
        "industrialValue": text(payload.get("industrialValue")),
        "verificationConclusion": text(payload.get("verificationConclusion")),
        "experimentObservation": text(payload.get("experimentObservation")),
        "failureReason": text(payload.get("failureReason")),
        "experimentExperience": text(payload.get("experimentExperience")),
        "blocks": payload.get("blocks") if isinstance(payload.get("blocks"), list) else [],
    }
    if not row["title"]:
        raise ValueError("Paper title is required")
    conn.execute(
        """
        INSERT INTO research_cards (
            id, title, direction, status, official_github, paper_url, summary,
            direction_keywords, industrial_value, verification_conclusion,
            experiment_observation, failure_reason, experiment_experience,
            blocks_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            direction = excluded.direction,
            status = excluded.status,
            official_github = excluded.official_github,
            paper_url = excluded.paper_url,
            summary = excluded.summary,
            direction_keywords = excluded.direction_keywords,
            industrial_value = excluded.industrial_value,
            verification_conclusion = excluded.verification_conclusion,
            experiment_observation = excluded.experiment_observation,
            failure_reason = excluded.failure_reason,
            experiment_experience = excluded.experiment_experience,
            blocks_json = excluded.blocks_json,
            updated_at = excluded.updated_at
        """,
        (
            row["id"],
            row["title"],
            row["direction"],
            row["status"],
            row["officialGithub"],
            row["paperUrl"],
            row["summary"],
            row["directionKeywords"],
            row["industrialValue"],
            row["verificationConclusion"],
            row["experimentObservation"],
            row["failureReason"],
            row["experimentExperience"],
            blocks_json(row["blocks"]),
            stamp,
            stamp,
        ),
    )
    if commit:
        conn.commit()
    return row


def _research_lifecycle_payload(existing: sqlite3.Row | None, payload: dict[str, Any]) -> dict[str, Any]:
    if existing is None:
        base: dict[str, Any] = {}
    else:
        base = {
            "industrialValue": existing["industrial_value"],
            "verificationConclusion": existing["verification_conclusion"],
            "experimentObservation": existing["experiment_observation"],
            "failureReason": existing["failure_reason"],
            "experimentExperience": existing["experiment_experience"],
        }
    return {**base, **payload}


def upsert_project_card(conn: sqlite3.Connection, payload: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    stamp = now()
    card_id = text(payload.get("id")).strip() or f"project-{stamp.replace(' ', '-').replace(':', '')}"
    row = {
        "id": card_id,
        "title": text(payload.get("title")),
        "direction": text(payload.get("direction")),
        "status": text(payload.get("status")) or "沉淀中",
        "projectStage": text(payload.get("projectStage")),
        "acceptanceMetrics": text(payload.get("acceptanceMetrics")),
        "requirements": text(payload.get("requirements")),
        "metricSpec": text(payload.get("metricSpec")),
        "keyTech": text(payload.get("keyTech")),
        "relatedDatasets": payload.get("relatedDatasets") if isinstance(payload.get("relatedDatasets"), list) else parse_list_json(text(payload.get("relatedDatasets")).replace(",", "\n").replace("，", "\n")),
        "relatedPapers": payload.get("relatedPapers") if isinstance(payload.get("relatedPapers"), list) else parse_list_json(text(payload.get("relatedPapers")).replace(",", "\n").replace("，", "\n")),
        "relatedTechCards": payload.get("relatedTechCards") if isinstance(payload.get("relatedTechCards"), list) else parse_list_json(text(payload.get("relatedTechCards")).replace(",", "\n").replace("，", "\n")),
        "flow": text(payload.get("flow")),
        "experience": text(payload.get("experience")),
        "retrospectiveConclusion": text(payload.get("retrospectiveConclusion")),
        "docPath": text(payload.get("docPath")),
        "blocks": payload.get("blocks") if isinstance(payload.get("blocks"), list) else [],
    }
    if not row["title"]:
        raise ValueError("Project title is required")
    conn.execute(
        """
        INSERT INTO project_cards (
            id, title, direction, status, project_stage, acceptance_metrics,
            requirements, metric_spec, key_tech, related_datasets_json,
            related_papers_json, related_tech_cards_json, flow, experience,
            retrospective_conclusion, doc_path, blocks_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            direction = excluded.direction,
            status = excluded.status,
            project_stage = excluded.project_stage,
            acceptance_metrics = excluded.acceptance_metrics,
            requirements = excluded.requirements,
            metric_spec = excluded.metric_spec,
            key_tech = excluded.key_tech,
            related_datasets_json = excluded.related_datasets_json,
            related_papers_json = excluded.related_papers_json,
            related_tech_cards_json = excluded.related_tech_cards_json,
            flow = excluded.flow,
            experience = excluded.experience,
            retrospective_conclusion = excluded.retrospective_conclusion,
            doc_path = excluded.doc_path,
            blocks_json = excluded.blocks_json,
            updated_at = excluded.updated_at
        """,
        (
            row["id"],
            row["title"],
            row["direction"],
            row["status"],
            row["projectStage"],
            row["acceptanceMetrics"],
            row["requirements"],
            row["metricSpec"],
            row["keyTech"],
            list_json(row["relatedDatasets"]),
            list_json(row["relatedPapers"]),
            list_json(row["relatedTechCards"]),
            row["flow"],
            row["experience"],
            row["retrospectiveConclusion"],
            row["docPath"],
            blocks_json(row["blocks"]),
            stamp,
            stamp,
        ),
    )
    if commit:
        conn.commit()
    return row


def upsert_dataset_card(conn: sqlite3.Connection, payload: dict[str, Any], *, commit: bool = True) -> dict[str, Any]:
    stamp = now()
    card_id = text(payload.get("id")).strip() or f"dataset-{stamp.replace(' ', '-').replace(':', '')}"
    row = {
        "id": card_id,
        "title": text(payload.get("title")),
        "direction": text(payload.get("direction")),
        "path": text(payload.get("path")),
        "dataVersion": text(payload.get("dataVersion")),
        "annotationVersion": text(payload.get("annotationVersion")),
        "characteristics": text(payload.get("characteristics")),
        "taskFit": text(payload.get("taskFit")),
        "processingNotes": text(payload.get("processingNotes")),
        "processingScript": text(payload.get("processingScript")),
        "quality": text(payload.get("quality")),
        "labelQuality": text(payload.get("labelQuality")),
        "categories": text(payload.get("categories")),
        "sampleImages": payload.get("sampleImages") if isinstance(payload.get("sampleImages"), list) else [],
        "relatedProjects": payload.get("relatedProjects") if isinstance(payload.get("relatedProjects"), list) else parse_list_json(text(payload.get("relatedProjects")).replace(",", "\n").replace("，", "\n")),
        "relatedTechValidations": payload.get("relatedTechValidations") if isinstance(payload.get("relatedTechValidations"), list) else parse_list_json(text(payload.get("relatedTechValidations")).replace(",", "\n").replace("，", "\n")),
        "blocks": payload.get("blocks") if isinstance(payload.get("blocks"), list) else [],
    }
    if not row["title"]:
        raise ValueError("Dataset title is required")
    conn.execute(
        """
        INSERT INTO dataset_cards (
            id, title, direction, path, data_version, annotation_version,
            characteristics, task_fit, processing_notes, processing_script,
            quality, label_quality, categories, sample_images_json,
            related_projects_json, related_tech_validations_json, blocks_json,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            direction = excluded.direction,
            path = excluded.path,
            data_version = excluded.data_version,
            annotation_version = excluded.annotation_version,
            characteristics = excluded.characteristics,
            task_fit = excluded.task_fit,
            processing_notes = excluded.processing_notes,
            processing_script = excluded.processing_script,
            quality = excluded.quality,
            label_quality = excluded.label_quality,
            categories = excluded.categories,
            sample_images_json = excluded.sample_images_json,
            related_projects_json = excluded.related_projects_json,
            related_tech_validations_json = excluded.related_tech_validations_json,
            blocks_json = excluded.blocks_json,
            updated_at = excluded.updated_at
        """,
        (
            row["id"],
            row["title"],
            row["direction"],
            row["path"],
            row["dataVersion"],
            row["annotationVersion"],
            row["characteristics"],
            row["taskFit"],
            row["processingNotes"],
            row["processingScript"],
            row["quality"],
            row["labelQuality"],
            row["categories"],
            list_json(row["sampleImages"]),
            list_json(row["relatedProjects"]),
            list_json(row["relatedTechValidations"]),
            blocks_json(row["blocks"]),
            stamp,
            stamp,
        ),
    )
    if commit:
        conn.commit()
    return row


def delete_dataset_card(conn: sqlite3.Connection, card_id: str) -> dict[str, str]:
    clean_id = text(card_id).strip()
    if not clean_id:
        raise ValueError("Dataset id is required")
    conn.execute("DELETE FROM dataset_cards WHERE id = ?", (clean_id,))
    conn.commit()
    return {"id": clean_id}


def read_custom_assets(conn: sqlite3.Connection) -> dict[str, list[dict[str, Any]]]:
    directions = [
        {"name": row["name"], "summary": row["summary"]}
        for row in conn.execute("SELECT name, summary FROM ui_directions ORDER BY created_at").fetchall()
    ]
    subtech_cards = [
        {
            "id": row["id"],
            "direction": row["direction"],
            "techName": row["tech_name"],
            "officialPaperLink": row["official_paper_link"],
            "codeRepo": row["code_repo"],
            "lineage": row["lineage"],
            "principle": row["principle"],
            "applicationEffect": row["application_effect"],
            "strengths": row["strengths"],
            "limitations": row["limitations"],
            "projectUsage": row["project_usage"],
            "relatedProjects": parse_list_json(row["related_projects_json"]),
            "relatedDatasets": parse_list_json(row["related_datasets_json"]),
            "relatedPapers": parse_list_json(row["related_papers_json"]),
            "relatedTechCards": parse_list_json(row["related_tech_cards_json"]),
            "customFields": parse_custom_fields(row["custom_fields_json"]),
            "blocks": parse_blocks_json(row["blocks_json"]),
        }
        for row in conn.execute("SELECT * FROM subtech_cards ORDER BY created_at").fetchall()
    ]
    research_cards = [
        {
            "id": row["id"],
            "title": row["title"],
            "direction": row["direction"],
            "status": row["status"],
            "officialGithub": row["official_github"],
            "paperUrl": row["paper_url"],
            "summary": row["summary"],
            "directionKeywords": row["direction_keywords"],
            "industrialValue": row["industrial_value"],
            "verificationConclusion": row["verification_conclusion"],
            "experimentObservation": row["experiment_observation"],
            "failureReason": row["failure_reason"],
            "experimentExperience": row["experiment_experience"],
            "blocks": parse_blocks_json(row["blocks_json"]),
        }
        for row in conn.execute("SELECT * FROM research_cards ORDER BY created_at").fetchall()
    ]
    project_cards = [
        {
            "id": row["id"],
            "title": row["title"],
            "direction": row["direction"],
            "status": row["status"],
            "projectStage": row["project_stage"],
            "acceptanceMetrics": row["acceptance_metrics"],
            "requirements": row["requirements"],
            "metricSpec": row["metric_spec"],
            "keyTech": row["key_tech"],
            "relatedDatasets": parse_list_json(row["related_datasets_json"]),
            "relatedPapers": parse_list_json(row["related_papers_json"]),
            "relatedTechCards": parse_list_json(row["related_tech_cards_json"]),
            "flow": row["flow"],
            "experience": row["experience"],
            "retrospectiveConclusion": row["retrospective_conclusion"],
            "docPath": row["doc_path"],
            "blocks": parse_blocks_json(row["blocks_json"]),
        }
        for row in conn.execute("SELECT * FROM project_cards ORDER BY created_at").fetchall()
    ]
    dataset_cards = [
        {
            "id": row["id"],
            "title": row["title"],
            "direction": row["direction"],
            "path": row["path"],
            "dataVersion": row["data_version"],
            "annotationVersion": row["annotation_version"],
            "pathStatus": validate_dataset_path(row["path"]),
            "characteristics": row["characteristics"],
            "taskFit": row["task_fit"],
            "processingNotes": row["processing_notes"],
            "processingScript": row["processing_script"],
            "quality": row["quality"],
            "labelQuality": row["label_quality"],
            "categories": row["categories"],
            "sampleImages": parse_list_json(row["sample_images_json"]),
            "relatedProjects": parse_list_json(row["related_projects_json"]),
            "relatedTechValidations": parse_list_json(row["related_tech_validations_json"]),
            "blocks": parse_blocks_json(row["blocks_json"]),
        }
        for row in conn.execute("SELECT * FROM dataset_cards ORDER BY created_at").fetchall()
    ]
    return {
        "customDirections": directions,
        "customSubTechCards": subtech_cards,
        "customResearchCards": research_cards,
        "customProjectCards": project_cards,
        "customDatasetCards": dataset_cards,
    }
