#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = os.environ.get("IND_KN_BASE_URL", "http://127.0.0.1:8000")


def post_json(base_url: str, path: str, payload: dict) -> dict:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(
        base_url.rstrip("/") + path,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise SystemExit(f"Could not reach knowledge-base server: {error}") from error


def get_json(base_url: str, path: str) -> dict:
    try:
        with urlopen(base_url.rstrip("/") + path, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise SystemExit(f"Could not reach knowledge-base server: {error}") from error


def upload_image(base_url: str, image_path: Path) -> dict:
    if not image_path.exists():
        raise SystemExit(f"Image file does not exist: {image_path}")
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/png"
    if not mime_type.startswith("image/"):
        raise SystemExit(f"Not an image file: {image_path}")
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_path.read_bytes()).decode('ascii')}"
    return post_json(base_url, "/api/assets/images", {"filename": image_path.name, "dataUrl": data_url})


def create_draft(base_url: str, payload_path: Path) -> dict:
    if not payload_path.exists():
        raise SystemExit(f"Payload file does not exist: {payload_path}")
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
    return post_json(base_url, "/api/drafts", payload)


def import_raw(base_url: str, source_type: str, raw_path: Path) -> dict:
    if not raw_path.exists():
        raise SystemExit(f"Raw content file does not exist: {raw_path}")
    return post_json(
        base_url,
        "/api/imports",
        {"sourceType": source_type, "rawContent": raw_path.read_text(encoding="utf-8")},
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Helper for the industrial knowledge-base intake API.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("health", help="Call GET /api/drafts to confirm the local app is reachable.")

    upload = subparsers.add_parser("upload-image", help="Upload a local image and print the knowledge-assets path.")
    upload.add_argument("image", type=Path)

    draft = subparsers.add_parser("create-draft", help="Create a structured draft from a JSON payload file.")
    draft.add_argument("payload", type=Path)

    raw = subparsers.add_parser("import-raw", help="Import a supported label-based raw text package.")
    raw.add_argument("source_type", choices=["paper_brief", "project_review", "dataset_note", "tech_template"])
    raw.add_argument("raw_content", type=Path)

    args = parser.parse_args()
    if args.command == "health":
        result = get_json(args.base_url, "/api/drafts")
    elif args.command == "upload-image":
        result = upload_image(args.base_url, args.image)
    elif args.command == "create-draft":
        result = create_draft(args.base_url, args.payload)
    else:
        result = import_raw(args.base_url, args.source_type, args.raw_content)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()

