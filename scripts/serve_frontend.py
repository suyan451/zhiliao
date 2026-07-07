from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from uuid import uuid4

try:
    from scripts.export_frontend_data import main as export_frontend_data
except ModuleNotFoundError:
    from export_frontend_data import main as export_frontend_data


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
WEB_DIR = ROOT / "web"
PUBLIC_DIR = WEB_DIR / "public"
DIST_DIR = WEB_DIR / "dist"

from rd_kb.custom_assets import (
    delete_dataset_card,
    upsert_dataset_card,
    upsert_direction,
    upsert_project_card,
    upsert_research_card,
    upsert_subtech_card,
)
from rd_kb.audit import build_knowledge_audit, create_knowledge_backup
from rd_kb.db import connect, init_db
from rd_kb.drafts import (
    approve_draft,
    archive_draft,
    create_draft,
    list_archive_records,
    list_drafts,
    publish_draft,
    restore_archived_draft,
    submit_draft,
    update_draft,
)
from rd_kb.imports import import_text_package


class SpaHandler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:
        api_path = urlparse(self.path).path
        if api_path.startswith("/knowledge-assets/"):
            self.send_knowledge_asset(api_path)
            return
        if api_path == "/api/drafts":
            self.send_json(200, {"ok": True, "drafts": list_api_drafts()})
            return
        if api_path == "/api/archive":
            self.send_json(200, {"ok": True, "archive": list_api_archive()})
            return
        if api_path == "/api/maintenance/audit":
            try:
                self.send_json(200, {"ok": True, "audit": get_api_maintenance_audit(ROOT)})
            except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
                self.send_json(500, {"ok": False, "error": str(error)})
            return
        path = self.translate_path(self.path)
        if not os.path.exists(path) and "." not in Path(self.path).name:
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self) -> None:
        api_path = urlparse(self.path).path
        if api_path == "/api/assets/images":
            try:
                payload = self.read_json_body()
                item = save_uploaded_image_asset(ROOT, payload)
            except ValueError as error:
                self.send_json(400, {"ok": False, "error": str(error)})
                return
            except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
                self.send_json(500, {"ok": False, "error": str(error)})
                return
            self.send_json(200, {"ok": True, "item": item})
            return

        if api_path == "/api/imports":
            try:
                payload = self.read_json_body()
                item = import_api_package(payload)
            except ValueError as error:
                self.send_json(400, {"ok": False, "error": str(error)})
                return
            except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
                self.send_json(500, {"ok": False, "error": str(error)})
                return
            self.send_json(200, {"ok": True, "item": item})
            return

        if api_path == "/api/maintenance/backup":
            try:
                item = create_api_maintenance_backup(ROOT, ROOT / "backups")
            except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
                self.send_json(500, {"ok": False, "error": str(error)})
                return
            self.send_json(200, {"ok": True, "item": item})
            return

        if api_path == "/api/drafts" or api_path.startswith("/api/drafts/") or api_path.startswith("/api/archive/"):
            try:
                payload = self.read_json_body()
                if api_path == "/api/drafts":
                    item = create_api_draft(payload)
                elif api_path.startswith("/api/archive/"):
                    item = restore_api_archive(api_path)
                else:
                    item = handle_draft_action(api_path, payload)
            except ValueError as error:
                self.send_json(400, {"ok": False, "error": str(error)})
                return
            except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
                self.send_json(500, {"ok": False, "error": str(error)})
                return
            self.send_json(200, {"ok": True, "item": item})
            return

        if api_path not in {"/api/directions", "/api/subtech", "/api/research", "/api/projects", "/api/datasets"}:
            self.send_json(404, {"ok": False, "error": "Unknown API endpoint"})
            return
        try:
            payload = self.read_json_body()
            item = save_api_asset(api_path, payload)
            export_frontend_data()
            copy_data_to_dist(ROOT)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
            self.send_json(500, {"ok": False, "error": str(error)})
            return
        self.send_json(200, {"ok": True, "item": item})

    def do_DELETE(self) -> None:
        api_path = urlparse(self.path).path
        if not api_path.startswith("/api/datasets/"):
            self.send_json(404, {"ok": False, "error": "Unknown API endpoint"})
            return
        try:
            item = delete_api_asset(api_path)
            export_frontend_data()
            copy_data_to_dist(ROOT)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
            self.send_json(500, {"ok": False, "error": str(error)})
            return
        self.send_json(200, {"ok": True, "item": item})

    def do_PATCH(self) -> None:
        api_path = urlparse(self.path).path
        if not api_path.startswith("/api/drafts/"):
            self.send_json(404, {"ok": False, "error": "Unknown API endpoint"})
            return
        try:
            payload = self.read_json_body()
            item = update_api_draft(api_path, payload)
        except ValueError as error:
            self.send_json(400, {"ok": False, "error": str(error)})
            return
        except Exception as error:  # noqa: BLE001 - surface local API errors to the UI.
            self.send_json(500, {"ok": False, "error": str(error)})
            return
        self.send_json(200, {"ok": True, "item": item})

    def read_json_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise ValueError("JSON object body is required")
        return data

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_knowledge_asset(self, api_path: str) -> None:
        asset_root = (ROOT / "knowledge" / "assets").resolve()
        relative = unquote(api_path.removeprefix("/knowledge-assets/")).lstrip("/")
        try:
            target = (asset_root / relative).resolve()
            target.relative_to(asset_root)
        except ValueError:
            self.send_error(404, "File not found")
            return
        if not target.is_file():
            self.send_error(404, "File not found")
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


IMAGE_EXTENSIONS = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def save_uploaded_image_asset(root: Path, payload: dict) -> dict:
    filename = str(payload.get("filename") or "knowledge-image").strip()
    data_url = str(payload.get("dataUrl") or payload.get("data_url") or "").strip()
    match = re.match(r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,(.+)$", data_url, re.IGNORECASE | re.DOTALL)
    if not match:
        raise ValueError("dataUrl must be a base64 image data URL")

    mime_type = match.group(1).lower().replace("image/jpg", "image/jpeg")
    extension = IMAGE_EXTENSIONS.get(mime_type)
    if not extension:
        raise ValueError(f"Unsupported image type: {mime_type}")
    try:
        body = base64.b64decode(match.group(2), validate=True)
    except Exception as error:  # noqa: BLE001 - convert decoding errors to API validation errors.
        raise ValueError("Invalid base64 image data") from error
    if not body:
        raise ValueError("Uploaded image is empty")

    safe_stem = Path(filename).stem
    safe_stem = re.sub(r"[^0-9A-Za-z._\-\u4e00-\u9fff]+", "-", safe_stem).strip(".-") or "knowledge-image"
    day = datetime.now(timezone.utc).astimezone().strftime("%Y%m%d")
    asset_dir = root / "knowledge" / "assets" / day
    asset_dir.mkdir(parents=True, exist_ok=True)
    asset_name = f"{safe_stem}-{uuid4().hex[:8]}{extension}"
    asset_path = asset_dir / asset_name
    asset_path.write_bytes(body)
    return {
        "filename": asset_name,
        "src": f"knowledge-assets/{day}/{asset_name}",
        "mime_type": mime_type,
        "size": len(body),
    }


def save_api_asset(path: str, payload: dict) -> dict:
    with connect() as conn:
        init_db(conn)
        if path == "/api/directions":
            return upsert_direction(conn, payload)
        if path == "/api/subtech":
            return upsert_subtech_card(conn, payload)
        if path == "/api/research":
            return upsert_research_card(conn, payload)
        if path == "/api/projects":
            return upsert_project_card(conn, payload)
        if path == "/api/datasets":
            return upsert_dataset_card(conn, payload)
    raise ValueError(f"Unsupported API path: {path}")


def create_api_draft(payload: dict) -> dict:
    draft_type = str(payload.get("draftType") or payload.get("draft_type") or "").strip()
    title = str(payload.get("title") or "").strip()
    body = payload.get("payload")
    if not draft_type:
        raise ValueError("draftType is required")
    if not title:
        raise ValueError("title is required")
    if not isinstance(body, dict):
        body = {}
    with connect() as conn:
        init_db(conn)
        return create_draft(
            conn,
            draft_type=draft_type,
            title=title,
            payload=body,
            draft_id=payload.get("draftId") or payload.get("draft_id"),
        )


def update_api_draft(path: str, payload: dict) -> dict:
    parts = path.strip("/").split("/")
    if len(parts) != 3 or parts[0] != "api" or parts[1] != "drafts":
        raise ValueError(f"Unsupported draft update path: {path}")
    draft_id = unquote(parts[2])
    body = payload.get("payload")
    if not isinstance(body, dict):
        body = {}
    with connect() as conn:
        init_db(conn)
        return update_draft(conn, draft_id, title=payload.get("title"), payload=body)


def list_api_drafts(status: str | None = None) -> list[dict]:
    with connect() as conn:
        init_db(conn)
        return list_drafts(conn, status=status, active_only=status is None)


def list_api_archive() -> list[dict]:
    with connect() as conn:
        init_db(conn)
        return list_archive_records(conn)


def get_api_maintenance_audit(repo_root: Path = ROOT) -> dict:
    with connect() as conn:
        init_db(conn)
        return build_knowledge_audit(conn, repo_root)


def create_api_maintenance_backup(repo_root: Path = ROOT, output_dir: Path | None = None) -> dict:
    backup_path = create_knowledge_backup(repo_root, output_dir or (repo_root / "backups"))
    return {
        "backup_path": str(backup_path),
        "created_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
    }


def import_api_package(payload: dict) -> dict:
    source_type = str(payload.get("sourceType") or payload.get("source_type") or "").strip()
    raw_content = str(payload.get("rawContent") or payload.get("raw_content") or "").strip()
    with connect() as conn:
        init_db(conn)
        return import_text_package(conn, source_type=source_type, raw_content=raw_content)


def restore_api_archive(path: str) -> dict:
    parts = path.strip("/").split("/")
    if len(parts) != 4 or parts[0] != "api" or parts[1] != "archive" or parts[3] != "restore":
        raise ValueError(f"Unsupported archive path: {path}")
    archive_id = unquote(parts[2])
    with connect() as conn:
        init_db(conn)
        return restore_archived_draft(conn, archive_id)


def handle_draft_action(path: str, payload: dict) -> dict:
    parts = path.strip("/").split("/")
    if len(parts) != 4 or parts[0] != "api" or parts[1] != "drafts":
        raise ValueError(f"Unsupported draft path: {path}")
    draft_id, action = unquote(parts[2]), parts[3]
    with connect() as conn:
        init_db(conn)
        if action == "submit":
            return submit_draft(conn, draft_id)
        if action == "approve":
            return approve_draft(conn, draft_id)
        if action == "archive":
            return archive_draft(conn, draft_id, reason=str(payload.get("reason") or ""))
        if action == "delete":
            return archive_draft(conn, draft_id, reason=str(payload.get("reason") or "前端删除草稿"))
        if action == "publish":
            result = publish_draft(conn, draft_id, ROOT, auto_approve=True, allow_dirty_worktree=True)
            export_frontend_data()
            copy_data_to_dist(ROOT)
            return {
                "draft_id": result.draft_id,
                "document_id": result.document_id,
                "document_path": result.document_path,
                "git_commit": result.git_commit,
                "target_module": result.target_module,
                "target_entity_type": result.target_entity_type,
                "published_entity_id": result.published_entity_id,
                "redirect_path": result.redirect_path,
            }
    raise ValueError(f"Unsupported draft action: {action}")


def delete_api_asset(path: str) -> dict:
    if not path.startswith("/api/datasets/"):
        raise ValueError(f"Unsupported API path: {path}")
    card_id = path.rsplit("/", 1)[-1]
    with connect() as conn:
        init_db(conn)
        return delete_dataset_card(conn, card_id)


def copy_data_to_dist(root: Path = ROOT) -> Path:
    public_data = root / "web" / "public" / "kb-data.json"
    dist_data = root / "web" / "dist" / "kb-data.json"
    if not public_data.exists():
        raise FileNotFoundError(f"Missing exported data: {public_data}")
    dist_data.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(public_data, dist_data)
    return dist_data


def run_checked(command: list[str], cwd: Path) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def build_frontend(root: Path = ROOT, *, install: bool = False) -> None:
    web_dir = root / "web"
    if install or not (web_dir / "node_modules").exists():
        run_checked(["npm", "install"], web_dir)
    run_checked(["npm", "run", "build"], web_dir)


def frontend_needs_build(root: Path = ROOT) -> bool:
    web_dir = root / "web"
    dist_index = web_dir / "dist" / "index.html"
    if not dist_index.exists():
        return True
    dist_mtime = dist_index.stat().st_mtime
    watched_files = [
        web_dir / "index.html",
        web_dir / "package.json",
        *list((web_dir / "src").glob("**/*")),
    ]
    return any(path.is_file() and path.stat().st_mtime > dist_mtime for path in watched_files)


def ensure_frontend_ready(root: Path = ROOT, *, build: bool = True, install: bool = False) -> Path:
    export_frontend_data()
    dist_index = root / "web" / "dist" / "index.html"
    if build and frontend_needs_build(root):
        build_frontend(root, install=install)
    if not dist_index.exists():
        raise FileNotFoundError(f"Missing frontend build: {dist_index}")
    copy_data_to_dist(root)
    return root / "web" / "dist"


def serve(directory: Path, host: str, port: int) -> None:
    handler = lambda *args, **kwargs: SpaHandler(*args, directory=str(directory), **kwargs)
    server = ThreadingHTTPServer((host, port), handler)
    print(f"Serving frontend at http://{host}:{port}/")
    print(f"Directory: {directory}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export data and serve the React knowledge-base frontend.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind. Default: 127.0.0.1")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind. Default: 8000")
    parser.add_argument("--no-build", action="store_true", help="Do not build if web/dist is missing.")
    parser.add_argument("--install", action="store_true", help="Run npm install before building.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    directory = ensure_frontend_ready(build=not args.no_build, install=args.install)
    serve(directory, args.host, args.port)


if __name__ == "__main__":
    main()
