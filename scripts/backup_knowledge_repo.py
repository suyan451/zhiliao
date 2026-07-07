from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.audit import create_knowledge_backup


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export Markdown knowledge, database and config into a backup zip.")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(ROOT),
        help="Repository path to back up. Defaults to the project root.",
    )
    parser.add_argument(
        "--out",
        default=str(ROOT / "backups"),
        help="Output directory for the zip backup.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    backup_path = create_knowledge_backup(Path(args.path), Path(args.out))
    print(backup_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
