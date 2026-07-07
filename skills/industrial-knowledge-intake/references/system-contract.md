# 知了工坊 System Contract

## Local App

Default repo:

```text
/Users/shihuyi/Downloads/AI/AICoding/ind_kn
```

Prefer `IND_KN_REPO` when set, or use the current workspace if it contains `web/public/kb-data.json`.

Typical server:

```bash
python scripts/serve_frontend.py
```

Default URL:

```text
http://127.0.0.1:8000
```

Key endpoints:

- `GET /api/drafts`
- `POST /api/drafts`
- `PATCH /api/drafts/{draft_id}`
- `POST /api/drafts/{draft_id}/submit`
- `POST /api/drafts/{draft_id}/approve`
- `POST /api/drafts/{draft_id}/publish`
- `POST /api/imports`
- `POST /api/assets/images`
- `GET /knowledge-assets/{date}/{file}`

## Draft Flow

1. Agent summarizes source material into one or more 工作台 drafts.
2. Human edits/reviews the drafts.
3. Human uses submit/approve/publish, or the UI action “确认并收录”.
4. Backend materializes formal cards and Markdown documents.
5. UI refreshes `kb-data.json`, so formal cards appear in their destination modules.

Do not skip 工作台 unless the user explicitly asks to publish.

## Draft Types

| User intent | draftType | Import sourceType | Formal destination |
| --- | --- | --- | --- |
| Paper, paper list, frontier method | `research_paper` | `paper_brief` | 前沿研究 |
| Project review, delivery replay | `project_case` | `project_review` | 项目应用 |
| Dataset card, data note | `dataset_card` | `dataset_note` | 数据积累 |
| Mature technical best practice | `tech_card` | `tech_template` | 技术积累 |

## Lifecycle Values

Use conservative values.

| Area | Values |
| --- | --- |
| Draft workflow | `draft`, `submitted`, `approved`, `published`, `archived` |
| Research lifecycle | `待读`, `粗读`, `精读`, `已实验`, `已结论`, `已归档` |
| Project status | `计划中`, `沉淀中`, `已交付`, `已归档` |

Do not mark research as `已实验` or `已结论` unless the source contains experiment evidence or the user provides it.

## Research Paper Payload

```json
{
  "title": "",
  "direction": "",
  "status": "待读",
  "paperUrl": "",
  "officialGithub": "",
  "summary": "",
  "directionKeywords": "",
  "industrialValue": "",
  "experimentObservation": "",
  "failureReason": "",
  "verificationConclusion": "",
  "experimentExperience": "",
  "body": ""
}
```

Use `body` as a complete Markdown brief:

```md
# 论文标题

## 基本信息
- 技术方向：
- 原文链接：
- 官方仓库：

## 方法概要

## 对工业场景的价值

## 待验证问题

## 实验计划或已有结论
```

## Project Case Payload

```json
{
  "title": "",
  "direction": "",
  "status": "沉淀中",
  "projectStage": "",
  "acceptanceMetrics": "",
  "requirements": "",
  "metricSpec": "",
  "keyTech": "",
  "relatedDatasets": [],
  "relatedPapers": [],
  "relatedTechCards": [],
  "flow": "",
  "experience": "",
  "retrospectiveConclusion": "",
  "docPath": "",
  "body": ""
}
```

Use `flow` for Markdown images when the source contains a pipeline or process diagram. Use `acceptanceMetrics`, `metricSpec`, and `experience` for Markdown tables when project results are tabular.

## Dataset Card Payload

```json
{
  "title": "",
  "direction": "",
  "path": "",
  "dataVersion": "",
  "annotationVersion": "",
  "characteristics": "",
  "taskFit": "",
  "processingNotes": "",
  "processingScript": "",
  "quality": "",
  "labelQuality": "",
  "categories": "",
  "sampleImages": [],
  "relatedProjects": [],
  "relatedTechValidations": [],
  "body": ""
}
```

If images are involved, prefer Markdown image links inside `characteristics`, `processingNotes`, or `body`.

## Tech Card Payload

```json
{
  "techName": "",
  "title": "",
  "direction": "",
  "officialPaperLink": "",
  "codeRepo": "",
  "lineage": "",
  "principle": "",
  "applicationEffect": "",
  "strengths": "",
  "limitations": "",
  "projectUsage": "",
  "relatedProjects": [],
  "relatedDatasets": [],
  "relatedPapers": [],
  "relatedTechCards": [],
  "customFields": [],
  "body": ""
}
```

Use `tech_card` only for methods that are already valuable enough to become reusable capability assets.

Relationship compatibility:

- Prefer first-class `relatedProjects`, `relatedDatasets`, `relatedPapers`, and `relatedTechCards` fields.
- If the target app version does not support these first-class fields, add fallback custom fields like `关联项目：...`, `关联数据集：...`, `关联论文：...`, and `关联技术卡：...`.

Use `lineage`, `principle`, `applicationEffect`, `strengths`, `limitations`, `projectUsage`, relation fields, or `body` for inline Markdown images/tables. Avoid dumping all evidence into `blocks`.

## List Thumbnail Rules

The frontend auto-detects Markdown images or image-like paths from important fields and shows thumbnails in list rows.

Good sources for thumbnail extraction:

- Draft/body fields: `body`, `summary`, `industrialValue`, `experience`, `characteristics`
- Project fields: `acceptanceMetrics`, `flow`
- Dataset fields: `path`, `characteristics`, `processingNotes`, `sampleImages`
- Tech fields: `lineage`, `principle`
- `blocks` with image content

Prefer the first meaningful figure in the relevant section. Do not add decorative images only to create thumbnails.

## Markdown Rules

Long text fields support Markdown. Use:

```md
![caption](knowledge-assets/YYYYMMDD/file.png)

| 指标 | Baseline | Ours |
| --- | --- | --- |
| F1 | 91.2 | 94.8 |
```

Avoid absolute paths such as `/Users/.../image.png` in Markdown. Upload local images first and use `knowledge-assets/...`.

## API Examples

Create a structured draft:

```bash
python scripts/kb_intake_api.py create-draft /path/to/payload.json
```

Import raw text:

```bash
python scripts/kb_intake_api.py import-raw paper_brief /path/to/raw.txt
```

Upload an image:

```bash
python scripts/kb_intake_api.py upload-image /path/to/figure.png
```

