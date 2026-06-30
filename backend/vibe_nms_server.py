from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

import uvicorn


def runtime_root() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent.parent
    return Path.cwd()


def first_existing_path(paths: list[Path]) -> Path:
    for path in paths:
        if path.exists():
            return path
    return paths[0]


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def default_paths() -> None:
    root = runtime_root()
    source_root = Path(__file__).resolve().parent.parent
    frontend_dist = first_existing_path(
        [
            root / "frontend" / "dist",
            Path.cwd() / "frontend" / "dist",
            source_root / "frontend" / "dist",
        ]
    )
    os.environ.setdefault("NMS_DATABASE_ENGINE", "sqlite")
    os.environ.setdefault("NMS_DATABASE_PATH", str(root / "data" / "nms.sqlite"))
    if not os.getenv("NMS_FRONTEND_DIST") or not Path(os.getenv("NMS_FRONTEND_DIST", "")).exists():
        os.environ["NMS_FRONTEND_DIST"] = str(frontend_dist)
    os.environ.setdefault("NMS_ALLOWED_ORIGINS", "http://localhost:8080,http://127.0.0.1:8080")
    os.environ.setdefault("NMS_BOOTSTRAP_ADMIN_USERNAME", "admin")
    os.environ.setdefault("NMS_BOOTSTRAP_ADMIN_PASSWORD", "admin")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Vibe NMS without Docker")
    parser.add_argument("--host", default=os.getenv("NMS_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=env_int("NMS_PORT", 8080))
    args = parser.parse_args()

    default_paths()
    from app.main import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
