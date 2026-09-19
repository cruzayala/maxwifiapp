from pathlib import Path
import os

from PyInstaller.utils.hooks import collect_all


ROOT = Path.cwd()
BROWSER_DIR = Path(os.environ.get("ONU_BUILD_BROWSERS", ROOT / "build-browsers"))
EMBED_BROWSERS = os.environ.get("ONU_BUILD_EMBED_BROWSERS", "1") == "1"
TEST_BUILD = os.environ.get("ONU_BUILD_NO_UAC") == "1"
BUILD_NAME = os.environ.get("ONU_BUILD_NAME", "ONU-Studio-ISP-Max")

browser_executables = list(BROWSER_DIR.glob("**/chrome.exe")) if EMBED_BROWSERS else []
if EMBED_BROWSERS and (not BROWSER_DIR.exists() or not browser_executables):
    raise SystemExit(
        f"No se encontro una instalacion completa de Chromium en {BROWSER_DIR}. Ejecuta build-onu-studio.ps1."
    )

playwright_datas, playwright_binaries, playwright_hidden = collect_all("playwright")
webview_datas, webview_binaries, webview_hidden = collect_all("webview")
pystray_datas, pystray_binaries, pystray_hidden = collect_all("pystray")

datas = playwright_datas + webview_datas + pystray_datas + [
    (str(ROOT / "static"), "static"),
]
if EMBED_BROWSERS:
    datas.append((str(BROWSER_DIR), "ms-playwright"))
binaries = playwright_binaries + webview_binaries + pystray_binaries
hiddenimports = playwright_hidden + webview_hidden + pystray_hidden + [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan.on",
]

a = Analysis(
    [str(ROOT / "launcher.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "unittest"],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="ONU-Studio-ISP-Max-Test" if TEST_BUILD else BUILD_NAME,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT.parent / "public" / "favicon.ico"),
    version=str(ROOT / "version_info.txt"),
    uac_admin=not TEST_BUILD,
)
