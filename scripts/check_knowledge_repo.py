from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.git_store import format_git_status, inspect_git_repo


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check whether the knowledge base Git repository can publish Markdown.")
    parser.add_argument(
        "path",
        nargs="?",
        default=str(ROOT),
        help="Repository path to inspect. Defaults to the project root.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with a non-zero status unless the repository is publishable.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    status = inspect_git_repo(Path(args.path))
    print(format_git_status(status))
    if args.strict and not status.publishable:
        return 2
    if not status.is_repo:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
