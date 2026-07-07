---
name: industrial-knowledge-intake
description: Convert papers, project documents, dataset notes, technical notes, or web research into one or more reviewable 工作台 drafts for a 知了工坊-style industrial knowledge system. Use when an agent needs to classify source material into research_paper, project_case, dataset_card, or tech_card drafts; extract AI summaries, metrics, tables, images, and relationship fields; upload local image assets; and import structured drafts through the local app API.
---

# Industrial Knowledge Intake

## Core Rule

Route knowledge through 工作台 first. Create reviewable drafts unless the user explicitly asks to publish; the human uses “确认并收录” to move drafts into 前沿研究、项目应用、数据积累, or 技术积累.

This skill is portable across Codex and Claude Code. Use the instructions in this `SKILL.md`; use bundled scripts and references by resolving paths relative to this skill folder.

## Local App Assumptions

Default repo:

```text
/Users/shihuyi/Downloads/AI/AICoding/ind_kn
```

Override the repo when needed by user instruction or by setting:

```bash
export IND_KN_REPO=/path/to/ind_kn
```

Default API base URL:

```text
http://127.0.0.1:8000
```

Typical server command from the repo:

```bash
python scripts/serve_frontend.py
```

Use `references/system-contract.md` for exact field names, endpoint examples, and formal destination mapping. Use `scripts/kb_intake_api.py` for API health checks, image uploads, raw imports, and structured draft creation.

## System Model

知了工坊 uses one intake pipeline and four formal knowledge areas:

| Source material | Draft type | Formal destination |
| --- | --- | --- |
| Paper, paper list, frontier method | `research_paper` | 前沿研究 |
| Project document, delivery replay | `project_case` | 项目应用 |
| Dataset note, data processing guide | `dataset_card` | 数据积累 |
| Mature reusable method or best practice | `tech_card` | 技术积累 |

Use 技术积累 only for reusable capability assets. Use 前沿研究 for papers still being read, verified, or evaluated for industrial value.

## Default Workflow

1. Locate the repo. Prefer `IND_KN_REPO`; otherwise use the default repo path above or the current workspace if it contains `web/public/kb-data.json`.
2. Inspect existing directions in `web/public/kb-data.json`; reuse `directions[]` names when possible.
3. Identify every independently reusable knowledge asset in the source, not just the document's top-level category.
4. Classify each asset into one draft type from the table above.
5. Extract structured fields for filtering and indexing.
6. Write a complete `body` Markdown document for Git-backed knowledge export.
7. Put images and tables inline in the relevant Markdown field or `body`, not only in `blocks`.
8. Import through `/api/drafts` when the local server is running; use `/api/imports` only when raw text already follows a supported label template.
9. Verify intake by checking the API response and `/api/drafts`. Run tests/build only when changing code.

## Multi-Asset Extraction

A single source can produce multiple drafts. Do not collapse a rich project document into only one `project_case` when it also contains reusable methods, datasets, benchmarks, or research evaluations.

Use this split:

- Keep a `project_case` for delivery context, requirements, acceptance metrics, architecture, and project retrospective.
- Create separate `tech_card` drafts for mature reusable techniques, algorithms, model variants, post-processing methods, training recipes, evaluation scripts, or best practices.
- Create separate `dataset_card` drafts when the source contains reusable dataset definitions, paths, versions, cleaning rules, annotation rules, or quality notes.
- Create separate `research_paper` drafts only when the source includes a paper/frontier method being evaluated, not merely a citation.

Before importing, list the planned drafts mentally and prefer 2-5 focused drafts over one oversized draft when the source supports multiple angles. Each draft should be useful on its own and cross-reference the source document or related drafts in its payload/body.

Direction handling:

- Reuse an existing direction whenever it fits, even if the source's main direction is different. Example: a project case can be `实例分割`, while an internal distillation method from the same document belongs under `知识蒸馏`.
- If no existing direction fits, propose a new direction explicitly and use it consistently in the draft. Do not invent near-duplicate directions when a suitable one already exists.
- A project document can seed cards in multiple directions, such as `项目应用` context plus `知识蒸馏`, `实例分割`, or `预训练` technical assets.

## Relationship Mapping

Every draft should make its relationship to the other extracted assets visible. Users should be able to open a card and see what project, dataset, paper, or technique it is connected to.

Use the strongest supported fields:

- `project_case`: fill `relatedDatasets`, `relatedPapers`, and `relatedTechCards`.
- `dataset_card`: fill `relatedProjects` and `relatedTechValidations`.
- `tech_card`: fill `relatedProjects`, `relatedDatasets`, `relatedPapers`, and `relatedTechCards` when the target system supports first-class tech-card relationship fields. Also fill `projectUsage` with concrete project usage.
- `tech_card` compatibility fallback: if the target system lacks first-class relationship fields, add `customFields` entries such as `关联项目：...`, `关联数据集：...`, `关联论文：...`, and `关联技术卡：...`.
- `research_paper`: mention related projects, datasets, and tech cards in `industrialValue`, `experimentExperience`, or `body` when no first-class relation field exists.

When creating multiple drafts from one source, cross-reference them by stable human-readable titles even before formal IDs exist. If a relation is inferred rather than explicit in the source, mark it as “待人工确认”.

## Intake Paths

### Preferred: Structured Draft API

Create structured JSON and call `/api/drafts`:

```json
{
  "draftType": "research_paper",
  "title": "Paper title",
  "payload": {
    "title": "Paper title",
    "direction": "语义分割",
    "status": "待读",
    "paperUrl": "https://arxiv.org/abs/...",
    "officialGithub": "https://github.com/...",
    "summary": "Markdown summary with inline tables/images.",
    "industrialValue": "Industrial relevance and risks.",
    "directionKeywords": "segmentation, defect inspection",
    "verificationConclusion": "",
    "experimentExperience": "",
    "body": "# Paper title\n\n完整 Markdown 简报..."
  }
}
```

Run:

```bash
python scripts/kb_intake_api.py create-draft /path/to/payload.json
```

### Raw Text Import API

Use `/api/imports` only for label-based templates:

```json
{
  "sourceType": "paper_brief",
  "rawContent": "论文标题：...\n技术方向：...\n论文概要：..."
}
```

Supported `sourceType`: `paper_brief`, `project_review`, `dataset_note`, `tech_template`.

### Image Assets

Upload local images before referencing them in Markdown:

```bash
python scripts/kb_intake_api.py upload-image /path/to/figure.png
```

Use the returned `item.src`:

```md
![caption](knowledge-assets/YYYYMMDD/file-ab12cd34.png)
```

Never use absolute local image paths in generated Markdown. Put images near the explanation that uses them.

## Output Standards

For every draft:

- Keep claims traceable to supplied documents or cited web sources.
- Use conservative statuses; do not mark research as verified without source evidence or user-provided experiments.
- Fill structured fields first, then mirror coherent long-form explanation in `body`.
- Use Markdown tables for metrics, comparisons, dataset statistics, and experiment results.
- Use inline Markdown images for diagrams, sample data, workflows, screenshots, and result plots.
- Mark uncertain content as “待人工确认” instead of inventing evidence.

## Quality Gate

Before importing:

- Confirm the direction exists, or explicitly say a new direction is proposed.
- Ensure each draft type maps to the right formal destination.
- Include original paper/document links or local paths when available.
- Prefer `/api/drafts` over raw import for AI-generated structured output.
- After import, confirm the draft appears in 工作台 via `/api/drafts`.
- Do not bypass 工作台 unless the user explicitly asks for publish/confirm-and-collect.

