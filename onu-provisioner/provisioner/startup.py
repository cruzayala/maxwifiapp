from __future__ import annotations

import platform
import subprocess
import sys
from pathlib import Path


TASK_NAME = "ISP Max ONU Studio Agent"


def _run_schtasks(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    creation_flags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
    return subprocess.run(
        ["schtasks", *arguments],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
        check=False,
    )


def startup_status() -> dict:
    supported = platform.system() == "Windows" and bool(getattr(sys, "frozen", False))
    if platform.system() != "Windows":
        return {"supported": False, "enabled": False, "reason": "Disponible solo en Windows"}
    result = _run_schtasks(["/Query", "/TN", TASK_NAME, "/FO", "LIST"])
    return {
        "supported": supported,
        "enabled": result.returncode == 0,
        "reason": None if supported else "Disponible al ejecutar el instalador EXE",
    }


def set_startup(enabled: bool) -> dict:
    status = startup_status()
    if not status["supported"]:
        raise RuntimeError(status["reason"])

    if enabled:
        executable = str(Path(sys.executable).resolve())
        command = f'"{executable}" --background'
        result = _run_schtasks([
            "/Create", "/TN", TASK_NAME, "/TR", command,
            "/SC", "ONLOGON", "/RL", "HIGHEST", "/F",
        ])
    else:
        result = _run_schtasks(["/Delete", "/TN", TASK_NAME, "/F"])
        if result.returncode != 0 and not status["enabled"]:
            return startup_status()

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Windows rechazo la operacion").strip()
        raise RuntimeError(detail)
    return startup_status()
