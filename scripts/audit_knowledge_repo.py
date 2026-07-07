from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.audit import build_knowledge_audit
from rd_kb.db import connect, init_db


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit DB, publish jobs and Markdown files for the knowledge base.")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(ROOT),
        help="Repository path to audit. Defaults to the project root.",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Print indented JSON.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    repo_root = Path(args.path)
    with connect() as conn:
        init_db(conn)
        report = build_knowledge_audit(conn, repo_root)
    indent = 2 if args.pretty else None
    print(json.dumps(report, ensure_ascii=False, indent=indent))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
