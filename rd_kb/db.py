from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from .markdown import write_markdown
from .paths import DB_PATH, KB_DIR, ensure_dirs


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    ensure_dirs()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection | None = None) -> None:
    own_conn = conn is None
    conn = conn or connect()
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS domains (
            slug TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            owner TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS papers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            year INTEGER,
            venue TEXT,
            url TEXT,
            code_url TEXT,
            domain_slug TEXT,
            task TEXT,
            keywords TEXT,
            abstract TEXT,
            summary TEXT,
            method_type TEXT,
            industrial_value TEXT,
            risk TEXT,
            reproducibility TEXT,
            priority TEXT DEFAULT 'B',
            status TEXT DEFAULT '候选',
            card_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS methods (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            domain_slug TEXT,
            category TEXT,
            task TEXT,
            summary TEXT,
            applicable_scenarios TEXT,
            implementation_cost TEXT,
            validation_status TEXT DEFAULT '待验证',
            priority TEXT DEFAULT 'B',
            best_score TEXT,
            evidence TEXT,
            paper_ids TEXT,
            card_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS experiments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exp_id TEXT UNIQUE NOT NULL,
            title TEXT NOT NULL,
            domain_slug TEXT,
            task TEXT,
            scenario TEXT,
            method_name TEXT,
            dataset TEXT,
            teacher_model TEXT,
            student_model TEXT,
            baseline TEXT,
            metrics_json TEXT,
            result_summary TEXT,
            status TEXT DEFAULT '计划中',
            conclusion TEXT,
            recommendation TEXT,
            artifact_path TEXT,
            record_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS best_practices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_slug TEXT,
            task TEXT,
            scenario TEXT,
            title TEXT NOT NULL,
            method_name TEXT,
            result_summary TEXT,
            evidence_exp_ids TEXT,
            applicable_conditions TEXT,
            limits TEXT,
            doc_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            domain_slug TEXT,
            scenario TEXT,
            problem TEXT,
            solution TEXT,
            status TEXT DEFAULT '进行中',
            doc_path TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT,
            domain_slug TEXT,
            path TEXT,
            description TEXT,
            related_method TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ui_directions (
            name TEXT PRIMARY KEY,
            summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tech_directions (
            direction_id TEXT PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            summary TEXT,
            parent_id TEXT,
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(parent_id) REFERENCES tech_directions(direction_id)
        );

        CREATE TABLE IF NOT EXISTS direction_aliases (
            alias TEXT PRIMARY KEY,
            direction_id TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(direction_id) REFERENCES tech_directions(direction_id)
        );

        CREATE TABLE IF NOT EXISTS subtech_cards (
            id TEXT PRIMARY KEY,
            direction TEXT,
            tech_name TEXT,
            official_paper_link TEXT,
            code_repo TEXT,
            lineage TEXT,
            principle TEXT,
            application_effect TEXT,
            strengths TEXT,
            limitations TEXT,
            project_usage TEXT,
            related_projects_json TEXT,
            related_datasets_json TEXT,
            related_papers_json TEXT,
            related_tech_cards_json TEXT,
            custom_fields_json TEXT,
            blocks_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS research_cards (
            id TEXT PRIMARY KEY,
            title TEXT,
            direction TEXT,
            status TEXT,
            official_github TEXT,
            paper_url TEXT,
            summary TEXT,
            direction_keywords TEXT,
            industrial_value TEXT,
            verification_conclusion TEXT,
            experiment_observation TEXT,
            failure_reason TEXT,
            experiment_experience TEXT,
            blocks_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS project_cards (
            id TEXT PRIMARY KEY,
            title TEXT,
            direction TEXT,
            status TEXT,
            project_stage TEXT,
            acceptance_metrics TEXT,
            requirements TEXT,
            metric_spec TEXT,
            key_tech TEXT,
            related_datasets_json TEXT,
            related_papers_json TEXT,
            related_tech_cards_json TEXT,
            flow TEXT,
            experience TEXT,
            retrospective_conclusion TEXT,
            doc_path TEXT,
            blocks_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dataset_cards (
            id TEXT PRIMARY KEY,
            title TEXT,
            direction TEXT,
            path TEXT,
            data_version TEXT,
            annotation_version TEXT,
            characteristics TEXT,
            task_fit TEXT,
            processing_notes TEXT,
            processing_script TEXT,
            quality TEXT,
            label_quality TEXT,
            categories TEXT,
            sample_images_json TEXT,
            related_projects_json TEXT,
            related_tech_validations_json TEXT,
            blocks_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS documents (
            document_id TEXT PRIMARY KEY,
            document_type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            document_path TEXT,
            schema_version TEXT NOT NULL DEFAULT '1',
            content_hash TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS document_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            document_id TEXT NOT NULL,
            document_version INTEGER NOT NULL,
            git_commit TEXT,
            content_hash TEXT,
            document_path TEXT,
            schema_version TEXT NOT NULL DEFAULT '1',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(document_id, document_version),
            FOREIGN KEY(document_id) REFERENCES documents(document_id)
        );

        CREATE TABLE IF NOT EXISTS document_blocks (
            block_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            block_order INTEGER NOT NULL DEFAULT 0,
            block_type TEXT NOT NULL DEFAULT 'text',
            title TEXT,
            content TEXT,
            src TEXT,
            caption TEXT,
            table_text TEXT,
            code TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(document_id) REFERENCES documents(document_id)
        );

        CREATE TABLE IF NOT EXISTS import_packages (
            package_id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            raw_content TEXT,
            status TEXT NOT NULL DEFAULT 'uploaded',
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            UNIQUE(source_type, source_hash)
        );

        CREATE TABLE IF NOT EXISTS ingestion_jobs (
            job_id TEXT PRIMARY KEY,
            package_id TEXT,
            status TEXT NOT NULL DEFAULT 'queued',
            result_json TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(package_id) REFERENCES import_packages(package_id)
        );

        CREATE TABLE IF NOT EXISTS knowledge_sources (
            source_id TEXT PRIMARY KEY,
            source_type TEXT NOT NULL,
            title TEXT,
            locator TEXT,
            metadata_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS knowledge_drafts (
            draft_id TEXT PRIMARY KEY,
            draft_type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'draft',
            payload_json TEXT NOT NULL DEFAULT '{}',
            source_id TEXT,
            document_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(source_id) REFERENCES knowledge_sources(source_id),
            FOREIGN KEY(document_id) REFERENCES documents(document_id)
        );

        CREATE TABLE IF NOT EXISTS knowledge_assets (
            asset_id TEXT PRIMARY KEY,
            asset_type TEXT NOT NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            document_id TEXT,
            draft_id TEXT,
            summary TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(document_id) REFERENCES documents(document_id),
            FOREIGN KEY(draft_id) REFERENCES knowledge_drafts(draft_id)
        );

        CREATE TABLE IF NOT EXISTS asset_direction_links (
            link_id TEXT PRIMARY KEY,
            asset_id TEXT NOT NULL,
            asset_type TEXT NOT NULL,
            direction_id TEXT,
            direction_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS review_records (
            review_id TEXT PRIMARY KEY,
            draft_id TEXT,
            action TEXT NOT NULL,
            actor TEXT,
            comment TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(draft_id) REFERENCES knowledge_drafts(draft_id)
        );

        CREATE TABLE IF NOT EXISTS published_knowledge (
            published_id TEXT PRIMARY KEY,
            document_id TEXT NOT NULL,
            draft_id TEXT,
            document_path TEXT NOT NULL,
            git_commit TEXT,
            status TEXT NOT NULL DEFAULT 'published',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(document_id) REFERENCES documents(document_id),
            FOREIGN KEY(draft_id) REFERENCES knowledge_drafts(draft_id)
        );

        CREATE TABLE IF NOT EXISTS draft_publish_records (
            record_id TEXT PRIMARY KEY,
            draft_id TEXT NOT NULL,
            document_id TEXT NOT NULL,
            target_module TEXT NOT NULL,
            target_entity_type TEXT NOT NULL,
            published_entity_id TEXT NOT NULL,
            redirect_path TEXT,
            git_commit TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(draft_id) REFERENCES knowledge_drafts(draft_id),
            FOREIGN KEY(document_id) REFERENCES documents(document_id)
        );

        CREATE TABLE IF NOT EXISTS git_publish_jobs (
            job_id TEXT PRIMARY KEY,
            draft_id TEXT,
            document_id TEXT,
            status TEXT NOT NULL DEFAULT 'queued',
            git_commit TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1,
            FOREIGN KEY(draft_id) REFERENCES knowledge_drafts(draft_id),
            FOREIGN KEY(document_id) REFERENCES documents(document_id)
        );

        CREATE TABLE IF NOT EXISTS archive_records (
            archive_id TEXT PRIMARY KEY,
            object_type TEXT NOT NULL,
            object_id TEXT NOT NULL,
            reason TEXT,
            archived_at TEXT NOT NULL,
            restored_at TEXT,
            restore_payload_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            version INTEGER NOT NULL DEFAULT 1
        );

        CREATE VIEW IF NOT EXISTS legacy_knowledge_assets AS
        SELECT
            'paper-' || id AS asset_id,
            'research_paper' AS asset_type,
            'papers' AS legacy_table,
            CAST(id AS TEXT) AS legacy_id,
            title AS title,
            COALESCE(NULLIF(task, ''), domain_slug) AS direction,
            status AS status,
            card_path AS document_path,
            created_at AS created_at,
            updated_at AS updated_at
        FROM papers
        UNION ALL
        SELECT
            'method-' || id AS asset_id,
            'tech_card' AS asset_type,
            'methods' AS legacy_table,
            CAST(id AS TEXT) AS legacy_id,
            name AS title,
            COALESCE(NULLIF(task, ''), domain_slug) AS direction,
            validation_status AS status,
            card_path AS document_path,
            created_at AS created_at,
            updated_at AS updated_at
        FROM methods
        UNION ALL
        SELECT
            'project-' || id AS asset_id,
            'project_case' AS asset_type,
            'projects' AS legacy_table,
            CAST(id AS TEXT) AS legacy_id,
            name AS title,
            COALESCE(NULLIF(domain_slug, ''), scenario) AS direction,
            status AS status,
            doc_path AS document_path,
            created_at AS created_at,
            updated_at AS updated_at
        FROM projects
        UNION ALL
        SELECT
            'asset-' || id AS asset_id,
            CASE WHEN type = 'dataset' THEN 'dataset_card' ELSE 'asset' END AS asset_type,
            'assets' AS legacy_table,
            CAST(id AS TEXT) AS legacy_id,
            name AS title,
            domain_slug AS direction,
            '' AS status,
            path AS document_path,
            created_at AS created_at,
            updated_at AS updated_at
        FROM assets;
        """
    )
    for table in ("subtech_cards", "research_cards", "project_cards", "dataset_cards"):
        columns = {row[1] for row in cur.execute(f"PRAGMA table_info({table})").fetchall()}
        if "blocks_json" not in columns:
            cur.execute(f"ALTER TABLE {table} ADD COLUMN blocks_json TEXT")
    research_columns = {row[1] for row in cur.execute("PRAGMA table_info(research_cards)").fetchall()}
    if "experiment_observation" not in research_columns:
        cur.execute("ALTER TABLE research_cards ADD COLUMN experiment_observation TEXT")
    if "failure_reason" not in research_columns:
        cur.execute("ALTER TABLE research_cards ADD COLUMN failure_reason TEXT")
    subtech_columns = {row[1] for row in cur.execute("PRAGMA table_info(subtech_cards)").fetchall()}
    for column in (
        "related_projects_json",
        "related_datasets_json",
        "related_papers_json",
        "related_tech_cards_json",
    ):
        if column not in subtech_columns:
            cur.execute(f"ALTER TABLE subtech_cards ADD COLUMN {column} TEXT")
    project_columns = {row[1] for row in cur.execute("PRAGMA table_info(project_cards)").fetchall()}
    for column in (
        "project_stage",
        "acceptance_metrics",
        "related_datasets_json",
        "related_papers_json",
        "related_tech_cards_json",
        "retrospective_conclusion",
    ):
        if column not in project_columns:
            cur.execute(f"ALTER TABLE project_cards ADD COLUMN {column} TEXT")
    dataset_columns = {row[1] for row in cur.execute("PRAGMA table_info(dataset_cards)").fetchall()}
    for column in (
        "data_version",
        "annotation_version",
        "processing_script",
        "related_projects_json",
        "related_tech_validations_json",
    ):
        if column not in dataset_columns:
            cur.execute(f"ALTER TABLE dataset_cards ADD COLUMN {column} TEXT")
    conn.commit()
    if own_conn:
        conn.close()


def table_df(table: str, conn: sqlite3.Connection | None = None) -> pd.DataFrame:
    allowed = {"domains", "papers", "methods", "experiments", "best_practices", "projects", "assets"}
    if table not in allowed:
        raise ValueError(f"Unsupported table: {table}")
    own_conn = conn is None
    conn = conn or connect()
    df = pd.read_sql_query(f"SELECT * FROM {table}", conn)
    if own_conn:
        conn.close()
    return df


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with connect() as conn:
        conn.execute(sql, tuple(params))
        conn.commit()


def insert_paper(values: dict[str, Any]) -> int:
    stamp = now()
    defaults = {
        "year": None,
        "venue": "",
        "url": "",
        "code_url": "",
        "domain_slug": "",
        "task": "",
        "keywords": "",
        "abstract": "",
        "summary": "",
        "method_type": "",
        "industrial_value": "",
        "risk": "",
        "reproducibility": "",
        "priority": "B",
        "status": "候选",
        "card_path": "",
        "created_at": stamp,
        "updated_at": stamp,
    }
    row = {**defaults, **values}
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO papers (
                title, year, venue, url, code_url, domain_slug, task, keywords, abstract,
                summary, method_type, industrial_value, risk, reproducibility, priority,
                status, card_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["title"],
                row["year"],
                row["venue"],
                row["url"],
                row["code_url"],
                row["domain_slug"],
                row["task"],
                row["keywords"],
                row["abstract"],
                row["summary"],
                row["method_type"],
                row["industrial_value"],
                row["risk"],
                row["reproducibility"],
                row["priority"],
                row["status"],
                row["card_path"],
                row["created_at"],
                row["updated_at"],
            ),
        )
        paper_id = int(cur.lastrowid)
        card_path = KB_DIR / "papers" / f"{paper_id:04d}_{safe_slug(row['title'])}.md"
        row["card_path"] = write_markdown(card_path, "paper_card.md", row)
        conn.execute("UPDATE papers SET card_path = ? WHERE id = ?", (row["card_path"], paper_id))
        conn.commit()
    return paper_id


def insert_method(values: dict[str, Any]) -> int:
    stamp = now()
    defaults = {
        "domain_slug": "",
        "category": "",
        "task": "",
        "summary": "",
        "applicable_scenarios": "",
        "implementation_cost": "",
        "validation_status": "待验证",
        "priority": "B",
        "best_score": "",
        "evidence": "",
        "paper_ids": "",
        "card_path": "",
        "created_at": stamp,
        "updated_at": stamp,
    }
    row = {**defaults, **values}
    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO methods (
                name, domain_slug, category, task, summary, applicable_scenarios,
                implementation_cost, validation_status, priority, best_score,
                evidence, paper_ids, card_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["name"],
                row["domain_slug"],
                row["category"],
                row["task"],
                row["summary"],
                row["applicable_scenarios"],
                row["implementation_cost"],
                row["validation_status"],
                row["priority"],
                row["best_score"],
                row["evidence"],
                row["paper_ids"],
                row["card_path"],
                row["created_at"],
                row["updated_at"],
            ),
        )
        method_id = int(cur.lastrowid)
        card_path = KB_DIR / "methods" / f"{method_id:04d}_{safe_slug(row['name'])}.md"
        row["card_path"] = write_markdown(card_path, "method_card.md", row)
        conn.execute("UPDATE methods SET card_path = ? WHERE id = ?", (row["card_path"], method_id))
        conn.commit()
    return method_id


def insert_experiment(values: dict[str, Any]) -> int:
    stamp = now()
    defaults = {
        "domain_slug": "",
        "task": "",
        "scenario": "",
        "method_name": "",
        "dataset": "",
        "teacher_model": "",
        "student_model": "",
        "baseline": "",
        "metrics_json": "{}",
        "result_summary": "",
        "status": "计划中",
        "conclusion": "",
        "recommendation": "",
        "artifact_path": "",
        "record_path": "",
        "created_at": stamp,
        "updated_at": stamp,
    }
    row = {**defaults, **values}
    if not isinstance(row["metrics_json"], str):
        row["metrics_json"] = json.dumps(row["metrics_json"], ensure_ascii=False, indent=2)

    with connect() as conn:
        cur = conn.execute(
            """
            INSERT INTO experiments (
                exp_id, title, domain_slug, task, scenario, method_name, dataset,
                teacher_model, student_model, baseline, metrics_json, result_summary,
                status, conclusion, recommendation, artifact_path, record_path,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["exp_id"],
                row["title"],
                row["domain_slug"],
                row["task"],
                row["scenario"],
                row["method_name"],
                row["dataset"],
                row["teacher_model"],
                row["student_model"],
                row["baseline"],
                row["metrics_json"],
                row["result_summary"],
                row["status"],
                row["conclusion"],
                row["recommendation"],
                row["artifact_path"],
                row["record_path"],
                row["created_at"],
                row["updated_at"],
            ),
        )
        exp_row_id = int(cur.lastrowid)
        record_path = KB_DIR / "experiments" / f"{row['exp_id']}_{safe_slug(row['title'])}.md"
        row["record_path"] = write_markdown(record_path, "experiment_record.md", row)
        conn.execute("UPDATE experiments SET record_path = ? WHERE id = ?", (row["record_path"], exp_row_id))
        conn.commit()
    return exp_row_id


def seed_defaults() -> None:
    init_db()
    with connect() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM domains").fetchone()[0]
        if existing:
            return
        stamp = now()
        domains = [
            ("kd", "知识蒸馏", "面向分类、检测、分割、异常检测等任务的 teacher-student 压缩与迁移。"),
            ("sam", "SAM 与基础分割模型", "SAM 及基础分割模型在工业标注、检测、分割中的适配。"),
            ("pretrain", "预训练与自监督", "工业视觉数据上的预训练、自监督和迁移学习。"),
            ("model_arch", "模型结构", "检测、分割、分类、异常检测模型结构选型与改造。"),
            ("solution", "工业解决方案", "项目方案、现场经验、交付流程和标准化方案沉淀。"),
        ]
        conn.executemany(
            "INSERT INTO domains (slug, name, description, owner, created_at) VALUES (?, ?, ?, ?, ?)",
            [(slug, name, desc, "", stamp) for slug, name, desc in domains],
        )
        conn.commit()

    p1 = insert_paper(
        {
            "title": "Feature Distillation for Industrial Segmentation Baselines",
            "year": 2026,
            "venue": "示例论文",
            "domain_slug": "kd",
            "task": "语义分割",
            "keywords": "feature distillation, segmentation, industrial defect",
            "summary": "示例卡片：以中间特征对齐提升轻量分割模型表现，不改变推理结构。",
            "method_type": "Feature KD",
            "industrial_value": "适合先作为工业分割蒸馏方向的最小验证样例。",
            "risk": "需要关注 teacher/student 特征尺度不一致和 loss 权重敏感问题。",
            "priority": "A",
            "status": "待精读",
        }
    )
    insert_method(
        {
            "name": "Feature Alignment KD",
            "domain_slug": "kd",
            "category": "Feature Distillation",
            "task": "语义分割",
            "summary": "通过中间层特征对齐，让 student 学习 teacher 的空间表征。",
            "applicable_scenarios": "teacher/student 同为 encoder-decoder，且推理结构不能增加额外开销。",
            "implementation_cost": "中等：需要注册 feature hook，增加训练 loss，不影响部署。",
            "validation_status": "待验证",
            "priority": "A",
            "evidence": "来自示例论文和历史经验，尚未完成本地验证。",
            "paper_ids": str(p1),
        }
    )
    insert_experiment(
        {
            "exp_id": "EXP-KD-SEG-0001",
            "title": "工业缺陷分割 Feature KD 最小验证",
            "domain_slug": "kd",
            "task": "语义分割",
            "scenario": "轻量分割模型边界和小缺陷召回不足",
            "method_name": "Feature Alignment KD",
            "dataset": "示例数据集",
            "teacher_model": "Teacher-Seg-Large",
            "student_model": "Student-Seg-Tiny",
            "baseline": "Student without KD",
            "metrics_json": {"mIoU": "待跑", "boundary_f1": "待跑", "fps": "待测"},
            "result_summary": "示例实验记录，等待替换为真实结果。",
            "status": "计划中",
            "conclusion": "未验证。",
            "recommendation": "先用小数据闭环验证训练流程和指标解析。",
        }
    )
    stamp = now()
    with connect() as conn:
        best_values = {
            "title": "工业语义分割蒸馏当前推荐方案",
            "domain_slug": "kd",
            "task": "语义分割",
            "scenario": "轻量模型部署",
            "method_name": "Feature Alignment KD",
            "result_summary": "当前为示例占位，等待真实实验刷新。",
            "evidence_exp_ids": "EXP-KD-SEG-0001",
            "applicable_conditions": "teacher/student 特征尺度可对齐，训练阶段允许增加 KD loss。",
            "limits": "异构差异过大时可能需要 adapter 或额外投影层。",
            "created_at": stamp,
            "updated_at": stamp,
        }
        doc_path = KB_DIR / "best_practices" / "kd_segmentation_current_best.md"
        best_values["doc_path"] = write_markdown(doc_path, "best_practice.md", best_values)
        conn.execute(
            """
            INSERT INTO best_practices (
                domain_slug, task, scenario, title, method_name, result_summary,
                evidence_exp_ids, applicable_conditions, limits, doc_path,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                best_values["domain_slug"],
                best_values["task"],
                best_values["scenario"],
                best_values["title"],
                best_values["method_name"],
                best_values["result_summary"],
                best_values["evidence_exp_ids"],
                best_values["applicable_conditions"],
                best_values["limits"],
                best_values["doc_path"],
                stamp,
                stamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO projects (
                project_id, name, domain_slug, scenario, problem, solution, status,
                doc_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "PRJ-DEMO-0001",
                "示例工业分割项目",
                "solution",
                "缺陷分割模型轻量化",
                "小模型推理快但边界质量下降。",
                "使用蒸馏候选方案进行训练阶段增强，保留 student 推理结构。",
                "沉淀中",
                "",
                stamp,
                stamp,
            ),
        )
        conn.execute(
            """
            INSERT INTO assets (
                name, type, domain_slug, path, description, related_method, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "Feature KD Loss 模板",
                "code_recipe",
                "kd",
                "kb/assets/feature_kd_loss_template.md",
                "记录 feature hook、loss 组合和权重调参建议的代码资产占位。",
                "Feature Alignment KD",
                stamp,
                stamp,
            ),
        )
        conn.commit()


def safe_slug(text: str) -> str:
    cleaned = "".join(ch.lower() if ch.isalnum() else "_" for ch in text)
    while "__" in cleaned:
        cleaned = cleaned.replace("__", "_")
    return cleaned.strip("_")[:80] or "item"
