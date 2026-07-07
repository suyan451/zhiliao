import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.db import insert_paper, seed_defaults


def main() -> None:
    seed_defaults()
    week = datetime.now().strftime("%Y-W%W")
    paper_id = insert_paper(
        {
            "title": f"Weekly Candidate Placeholder {week}",
            "year": datetime.now().year,
            "venue": "手动/自动刷新占位",
            "domain_slug": "kd",
            "task": "待归类",
            "keywords": "placeholder, weekly-refresh",
            "summary": "这是每周刷新脚本的占位记录。后续可在这里接入 arXiv、Semantic Scholar 和 AI 摘要。",
            "method_type": "待判断",
            "industrial_value": "等待人工确认。",
            "risk": "尚未精读。",
            "priority": "C",
            "status": "候选",
        }
    )
    print(f"Weekly refresh inserted placeholder paper: {paper_id}")


if __name__ == "__main__":
    main()
