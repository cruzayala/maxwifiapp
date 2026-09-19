from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))


def resource_dir() -> Path:
    configured = os.getenv("ONU_RESOURCE_DIR")
    if configured:
        return Path(configured).resolve()
    if is_frozen():
        return Path(sys._MEIPASS).resolve()  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[1]


def data_dir() -> Path:
    configured = os.getenv("ONU_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()
    if is_frozen():
        local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home()))
        return local_app_data / "ISP Max" / "ONU Studio"
    return Path(__file__).resolve().parents[1] / "data"


RESOURCE_DIR = resource_dir()
DATA_DIR = data_dir()
STATIC_DIR = RESOURCE_DIR / "static"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"
DATABASE_PATH = DATA_DIR / "provisioner.db"
CLOUD_SESSION_PATH = DATA_DIR / "cloud-session.dat"
ENV_PATH = DATA_DIR / ".env" if is_frozen() else RESOURCE_DIR / ".env"


def ensure_runtime_directories() -> None:
    for directory in (DATA_DIR, BACKUP_DIR, LOG_DIR):
        directory.mkdir(parents=True, exist_ok=True)
