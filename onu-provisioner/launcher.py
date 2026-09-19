from __future__ import annotations

import ctypes
import argparse
import logging
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path


PRODUCT_NAME = "ONU Studio | ISP Max"
DEFAULT_PORT = 8765


def frozen_resource_dir() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parent


def configure_environment() -> Path:
    resource_dir = frozen_resource_dir()
    local_app_data = Path(os.getenv("LOCALAPPDATA", Path.home()))
    data_dir = local_app_data / "ISP Max" / "ONU Studio"
    (data_dir / "logs").mkdir(parents=True, exist_ok=True)
    (data_dir / "backups").mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("ONU_RESOURCE_DIR", str(resource_dir))
    os.environ.setdefault("ONU_DATA_DIR", str(data_dir))
    bundled_browsers = resource_dir / "ms-playwright"
    if bundled_browsers.exists():
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(bundled_browsers)
        browser_executable = next(bundled_browsers.glob("chromium-*/chrome-win/chrome.exe"), None)
        if browser_executable:
            os.environ["ONU_BROWSER_EXECUTABLE"] = str(browser_executable)
    return data_dir


def configure_logging(data_dir: Path) -> None:
    logging.basicConfig(
        filename=data_dir / "logs" / "onu-studio.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        encoding="utf-8",
    )


def port_is_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def agent_is_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
            return response.status == 200 and b'"ok":true' in response.read(1024)
    except Exception:
        return False


def wait_for_server(port: int, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                return
        except OSError:
            time.sleep(0.12)
    raise RuntimeError("El servidor interno no pudo iniciar")


def show_error(message: str) -> None:
    ctypes.windll.user32.MessageBoxW(0, message, PRODUCT_NAME, 0x10)


def tray_image():
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (64, 64), "#172331")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((9, 9, 55, 55), radius=9, fill="#0a8f66")
    draw.ellipse((22, 19, 42, 39), outline="white", width=4)
    draw.line((32, 39, 32, 49), fill="white", width=4)
    return image


def run_tray(url: str, server, server_thread: threading.Thread) -> None:
    import pystray

    def open_dashboard(_icon=None, _item=None):
        webbrowser.open(url, new=1)

    def stop_agent(icon, _item=None):
        server.should_exit = True
        icon.stop()

    icon = pystray.Icon(
        "isp-max-onu-studio",
        tray_image(),
        PRODUCT_NAME,
        menu=pystray.Menu(
            pystray.MenuItem("Abrir ONU Studio", open_dashboard, default=True),
            pystray.MenuItem("Agente activo en 127.0.0.1:8765", lambda _icon, _item: None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Salir del agente", stop_agent),
        ),
    )
    try:
        icon.notify("El agente seguira detectando ONUs en segundo plano.", PRODUCT_NAME)
    except Exception:
        pass
    icon.run()
    server.should_exit = True
    server_thread.join(timeout=8)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--background", action="store_true")
    parser.add_argument("--replace-pid", type=int, default=0)
    return parser.parse_args()


def wait_for_replaced_process(pid: int, timeout: float = 20.0) -> None:
    if pid <= 0 or pid == os.getpid():
        return
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except OSError:
            return
        time.sleep(0.2)
    raise RuntimeError("La instancia anterior no finalizo durante la actualizacion")


def run() -> int:
    args = parse_args()
    if args.replace_pid:
        wait_for_replaced_process(args.replace_pid)
    if getattr(sys, "frozen", False):
        try:
            from provisioner.installation import install_current_executable

            installed = install_current_executable(background=args.background)
            if installed:
                return 0
        except Exception as exc:
            show_error(f"ONU Studio no pudo completar la instalacion.\n\n{exc}")
            return 1
    data_dir = configure_environment()
    configure_logging(data_dir)
    port = int(os.getenv("ONU_PORT", str(DEFAULT_PORT)))
    os.environ["ONU_PORT"] = str(port)
    os.environ["ONU_LAUNCH_MODE"] = "background" if args.background else "desktop"

    if not port_is_available(port):
        if agent_is_running(port):
            if not args.background:
                webbrowser.open(f"http://127.0.0.1:{port}/", new=1)
            return 0
        show_error(f"El puerto local {port} esta ocupado por otra aplicacion.\n\nCierra esa aplicacion e inicia ONU Studio otra vez.")
        return 1

    try:
        import uvicorn
        from app import app

        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
            log_config=None,
        )
        server = uvicorn.Server(config)
        server.install_signal_handlers = lambda: None
        server_thread = threading.Thread(target=server.run, name="onu-studio-server", daemon=True)
        server_thread.start()
        wait_for_server(port)

        url = f"http://127.0.0.1:{port}/"
        if not args.background:
            try:
                import webview

                webview.create_window(
                    PRODUCT_NAME,
                    url=url,
                    width=1460,
                    height=940,
                    min_size=(980, 700),
                    background_color="#f4f6f8",
                    text_select=True,
                )
                webview.start(
                    gui="edgechromium",
                    debug=False,
                    private_mode=True,
                    storage_path=str(data_dir / "webview"),
                )
            except Exception:
                logging.exception("No se pudo abrir la ventana integrada; usando el navegador predeterminado")
                webbrowser.open(url, new=1)
        run_tray(url, server, server_thread)
        return 0
    except Exception as exc:
        logging.exception("Fallo al iniciar ONU Studio")
        show_error(f"ONU Studio no pudo iniciar.\n\n{exc}\n\nRevisa el registro en:\n{data_dir / 'logs'}")
        return 1


if __name__ == "__main__":
    raise SystemExit(run())
