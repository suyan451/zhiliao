import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.db import table_df
from rd_kb.paths import KB_DIR, ensure_dirs


def main() -> None:
    ensure_dirs()
    out = KB_DIR / "weekly_reports" / "current_summary.md"
    papers = table_df("papers")
    methods = table_df("methods")
    experiments = table_df("experiments")
    best = table_df("best_practices")

    text = [
        "# 当前研发知识库摘要",
        "",
        f"- 论文数量：{len(papers)}",
        f"- 方法数量：{len(methods)}",
        f"- 实验数量：{len(experiments)}",
        f"- 最佳实践数量：{len(best)}",
        "",
        "## A 级论文",
        "",
    ]
    if not papers.empty:
        for _, row in papers[papers["priority"] == "A"].iterrows():
            text.append(f"- {row['title']} / {row['status']} / {row['task']}")

    out.write_text("\n".join(text), encoding="utf-8")
    print(f"Exported summary: {Path(out).resolve()}")


if __name__ == "__main__":
    main()
