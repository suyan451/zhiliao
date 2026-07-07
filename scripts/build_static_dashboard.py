from __future__ import annotations

import html
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.db import DB_PATH, seed_defaults


OUT = ROOT / "dist" / "dashboard.html"

DOMAIN_LABELS = {
    "kd": "知识蒸馏",
    "sam": "SAM",
    "pretrain": "预训练",
    "model_arch": "模型结构",
    "solution": "解决方案",
}


def fetch_rows(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    return conn.execute(f"SELECT * FROM {table}").fetchall()


def esc(value: object) -> str:
    return html.escape("" if value is None else str(value))


def label_domain(value: object) -> str:
    return DOMAIN_LABELS.get(str(value), str(value))


def tone(value: object) -> str:
    text = str(value)
    if text in {"最佳实践", "已完成", "已复现", "已入库", "有效", "已归档", "沉淀中"}:
        return "green"
    if text in {"待精读", "待复现", "待验证", "复现中", "计划中", "运行中", "候选"}:
        return "amber"
    if text in {"失败", "无效", "已淘汰", "A"}:
        return "red"
    if text == "B":
        return "blue"
    return "gray"


def cell_html(col: str, value: object) -> str:
    if col == "domain_slug":
        return f'<span class="badge teal">{esc(label_domain(value))}</span>'
    if col in {"status", "validation_status", "priority"}:
        return f'<span class="badge {tone(value)}">{esc(value)}</span>'
    return esc(value)


def table_html(rows: list[sqlite3.Row], columns: list[str]) -> str:
    if not rows:
        return '<p class="empty">暂无数据</p>'
    head = "".join(f"<th>{esc(col)}</th>" for col in columns)
    body_rows = []
    for row in rows:
        cells = "".join(f"<td>{cell_html(col, row[col])}</td>" for col in columns)
        body_rows.append(f"<tr>{cells}</tr>")
    return f"<table><thead><tr>{head}</tr></thead><tbody>{''.join(body_rows)}</tbody></table>"


def section(title: str, rows: list[sqlite3.Row], columns: list[str]) -> str:
    return f"""
    <section>
      <h2>{esc(title)}</h2>
      {table_html(rows, columns)}
    </section>
    """


def main() -> None:
    seed_defaults()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    papers = fetch_rows(conn, "papers")
    methods = fetch_rows(conn, "methods")
    experiments = fetch_rows(conn, "experiments")
    best = fetch_rows(conn, "best_practices")
    projects = fetch_rows(conn, "projects")
    assets = fetch_rows(conn, "assets")

    cards = [
        ("论文卡片", len(papers), "候选池与精读队列"),
        ("方法盘点", len(methods), "可验证方法资产"),
        ("实验记录", len(experiments), "验证过程与结论"),
        ("最佳实践", len(best), "当前复用方案"),
        ("项目沉淀", len(projects), "场景与交付经验"),
        ("资产索引", len(assets), "代码与模板入口"),
    ]
    card_html = "".join(
        f'<div class="metric"><strong>{value}</strong><span>{label}</span><small>{hint}</small></div>'
        for label, value, hint in cards
    )
    workflow = "".join(
        f'<div class="step"><b>{idx:02d}</b><span>{esc(name)}</span></div>'
        for idx, name in enumerate(["论文候选池", "方法拆解", "实验验证", "最佳实践", "项目沉淀"], 1)
    )

    content = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>工业算法研发知识库</title>
  <style>
    :root {{
      --bg: #f7f8fa;
      --text: #111827;
      --muted: #68707d;
      --line: #e4e7ec;
      --panel: #ffffff;
      --accent: #0f766e;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }}
    header {{
      padding: 30px 36px 24px;
      background: linear-gradient(135deg, #111827, #0f766e);
      color: #fff;
    }}
    header h1 {{
      margin: 0 0 8px;
      font-size: 28px;
      letter-spacing: 0;
    }}
    header p {{
      margin: 0;
      color: #d9e2ec;
      font-size: 14px;
    }}
    main {{
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px 28px 40px;
    }}
    .workflow {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 18px;
    }}
    .step {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }}
    .step b {{
      display: block;
      color: var(--accent);
      font-size: 12px;
      margin-bottom: 4px;
    }}
    .step span {{
      font-weight: 700;
      font-size: 14px;
    }}
    .metrics {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 22px;
    }}
    .metric {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      border-top: 3px solid var(--accent);
      box-shadow: 0 1px 2px rgba(16, 24, 40, .04);
    }}
    .metric strong {{
      display: block;
      font-size: 30px;
      color: var(--accent);
      margin-bottom: 4px;
    }}
    .metric span {{
      color: var(--muted);
      font-size: 14px;
    }}
    .metric small {{
      display: block;
      color: #98a2b3;
      font-size: 12px;
      margin-top: 6px;
    }}
    section {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      margin: 16px 0;
      overflow: hidden;
    }}
    h2 {{
      margin: 0;
      padding: 14px 16px;
      font-size: 18px;
      border-bottom: 1px solid var(--line);
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }}
    th, td {{
      padding: 10px 12px;
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }}
    th {{
      background: #f0f4f8;
      color: #334e68;
      font-weight: 600;
    }}
    tr:last-child td {{ border-bottom: 0; }}
    .empty {{
      margin: 0;
      padding: 16px;
      color: var(--muted);
    }}
    .badge {{
      display: inline-block;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 650;
      border: 1px solid #e4e7ec;
      white-space: nowrap;
    }}
    .teal {{ color: #0f766e; background: #ecfdf5; border-color: #a7f3d0; }}
    .blue {{ color: #2563eb; background: #eff6ff; border-color: #bfdbfe; }}
    .amber {{ color: #b45309; background: #fffbeb; border-color: #fde68a; }}
    .red {{ color: #b42318; background: #fef3f2; border-color: #fecaca; }}
    .green {{ color: #15803d; background: #f0fdf4; border-color: #bbf7d0; }}
    .gray {{ color: #475467; background: #f2f4f7; border-color: #e4e7ec; }}
    footer {{
      color: var(--muted);
      font-size: 12px;
      padding: 8px 2px;
    }}
  </style>
</head>
<body>
  <header>
    <h1>工业算法研发知识库</h1>
    <p>Python + SQLite + Markdown 的研发记录系统静态看板</p>
  </header>
  <main>
    <div class="workflow">{workflow}</div>
    <div class="metrics">{card_html}</div>
    {section("论文雷达", papers, ["id", "title", "year", "domain_slug", "task", "priority", "status", "card_path"])}
    {section("方法盘点", methods, ["id", "name", "domain_slug", "category", "task", "priority", "validation_status", "evidence"])}
    {section("实验记录", experiments, ["exp_id", "title", "domain_slug", "task", "method_name", "status", "conclusion", "record_path"])}
    {section("最佳实践", best, ["title", "domain_slug", "task", "scenario", "method_name", "evidence_exp_ids", "doc_path"])}
    {section("项目沉淀", projects, ["project_id", "name", "domain_slug", "scenario", "problem", "solution", "status"])}
    {section("资产索引", assets, ["name", "type", "domain_slug", "path", "description", "related_method"])}
    <footer>由 scripts/build_static_dashboard.py 生成。</footer>
  </main>
</body>
</html>
"""
    OUT.write_text(content, encoding="utf-8")
    conn.close()
    print(f"Built static dashboard: {OUT.resolve()}")


if __name__ == "__main__":
    main()
