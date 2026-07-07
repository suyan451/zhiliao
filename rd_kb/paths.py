from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
KB_DIR = ROOT / "kb"
TEMPLATE_DIR = ROOT / "templates"
DB_PATH = DATA_DIR / "rd_knowledge.db"


def ensure_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for subdir in [
        "domains",
        "papers",
        "methods",
        "experiments",
        "projects",
        "best_practices",
        "assets",
        "weekly_reports",
    ]:
        (KB_DIR / subdir).mkdir(parents=True, exist_ok=True)
