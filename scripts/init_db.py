import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.db import DB_PATH, seed_defaults


def main() -> None:
    seed_defaults()
    print(f"Initialized knowledge base database: {DB_PATH}")


if __name__ == "__main__":
    main()
