from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

from provisioner import __version__


TASK_NAME = "ISP Max ONU Studio Agent"


def install_root() -> Path:
    local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home()))
    return local_app_data / "ISP Max" / "ONU Studio" / "bin"


def installed_executable() -> Path:
    return install_root() / f"ONU-Studio-ISP-Max-v{__version__}.exe"


def _schtasks(arguments: list[str]) -> subprocess.CompletedProcess[str]:
    flags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
    return subprocess.run(
        ["schtasks", *arguments], capture_output=True, text=True,
        encoding="utf-8", errors="replace", creationflags=flags, check=False,
    )


def register_startup(executable: Path) -> None:
    command = f'"{executable}" --background'
    result = _schtasks([
        "/Create", "/TN", TASK_NAME, "/TR", command,
        "/SC", "ONLOGON", "/RL", "HIGHEST", "/F",
    ])
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Windows rechazo la instalacion").strip()
        raise RuntimeError(detail)


def installation_status() -> dict:
    supported = platform.system() == "Windows" and bool(getattr(sys, "frozen", False))
    current = Path(sys.executable).resolve() if supported else None
    expected = installed_executable().resolve() if supported else None
    task = _schtasks(["/Query", "/TN", TASK_NAME, "/FO", "LIST"]) if platform.system() == "Windows" else None
    return {
        "supported": supported,
        "installed": bool(current and expected and current == expected and expected.exists()),
        "startupEnabled": bool(task and task.returncode == 0),
        "installPath": str(expected) if expected else None,
        "version": __version__,
        "credentialProtection": "Windows DPAPI CurrentUser" if platform.system() == "Windows" else "Development only",
    }


def install_current_executable(*, background: bool = False) -> Path | None:
    if platform.system() != "Windows" or not getattr(sys, "frozen", False):
        return None
    source = Path(sys.executable).resolve()
    target = installed_executable().resolve()
    if source == target:
        register_startup(target)
        return None

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".installing")
    shutil.copy2(source, temporary)
    os.replace(temporary, target)
    register_startup(target)

    if not background:
        _schtasks(["/End", "/TN", TASK_NAME])
        time.sleep(0.4)
    for previous in target.parent.glob("ONU-Studio-ISP-Max-v*.exe"):
        if previous.resolve() == target:
            continue
        try:
            previous.unlink()
        except OSError:
            pass
    creation_flags = (
        subprocess.CREATE_NO_WINDOW
        | subprocess.DETACHED_PROCESS
        | subprocess.CREATE_NEW_PROCESS_GROUP
    )
    arguments = [str(target)]
    if background:
        arguments.extend(["--background", "--replace-pid", str(os.getpid())])
    subprocess.Popen(
        arguments, cwd=str(target.parent), close_fds=True,
        creationflags=creation_flags,
    )
    return target
