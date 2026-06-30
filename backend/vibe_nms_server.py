from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn


def default_paths() -> None:
    root = Path.cwd()
    os.environ.setdefault("NMS_DATABASE_ENGINE", "sqlite")
    os.environ.setdefault("NMS_DATABASE_PATH", str(root / "data" / "nms.sqlite"))
    os.environ.setdefault("NMS_FRONTEND_DIST", str(root / "frontend" / "dist"))
    os.environ.setdefault("NMS_ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")
    os.environ.setdefault("NMS_BOOTSTRAP_ADMIN_USERNAME", "admin")
    os.environ.setdefault("NMS_BOOTSTRAP_ADMIN_PASSWORD", "admin")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Vibe NMS without Docker")
    parser.add_argument("--host", default=os.getenv("NMS_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.getenv("NMS_PORT", "8080")))
    args = parser.parse_args()

    default_paths()
    from app.main import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
