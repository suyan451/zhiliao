import argparse
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from rd_kb.db import insert_experiment


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a new experiment record.")
    parser.add_argument("--domain", default="kd")
    parser.add_argument("--task", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--method", required=True)
    parser.add_argument("--scenario", default="")
    parser.add_argument("--dataset", default="")
    args = parser.parse_args()

    exp_id = "EXP-" + args.domain.upper() + "-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    insert_experiment(
        {
            "exp_id": exp_id,
            "title": args.title,
            "domain_slug": args.domain,
            "task": args.task,
            "scenario": args.scenario,
            "method_name": args.method,
            "dataset": args.dataset,
        }
    )
    print(f"Created experiment: {exp_id}")


if __name__ == "__main__":
    main()
