from __future__ import annotations

import re
import threading
import time
from datetime import datetime, timezone
from ipaddress import IPv4Address, IPv4Interface, IPv6Address

from .network import list_adapters, open_http_socket, probe_http


DEFAULT_HOSTS = (IPv4Address("192.168.100.1"), IPv4Address("192.168.1.1"))
LINK_LOCAL_HOST = IPv6Address("fe80::1")
MODEL_PATTERNS = (
    re.compile(r"ProductName\s*=\s*['\"]([^'\"]+)", re.I),
    re.compile(r"\b(EG\d{4}[A-Z0-9-]*)\b", re.I),
    re.compile(r"\b(HG\d{4}[A-Z0-9-]*)\b", re.I),
    re.compile(r"\b(F6\d{2}[A-Z0-9-]*)\b", re.I),
    re.compile(r"\b(AN\d{3,5}[A-Z0-9-]*)\b", re.I),
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def infer_device(html: str, headers: dict[str, str] | None = None) -> dict:
    compact = html[:262_144]
    model = None
    for pattern in MODEL_PATTERNS:
        match = pattern.search(compact)
        if match:
            model = match.group(1).strip().upper()
            break

    lowered = compact.lower()
    server = (headers or {}).get("server") or ""
    vendor_text = f"{lowered} {server.lower()}"
    if "huawei" in vendor_text or model and model.startswith(("EG", "HG")):
        vendor = "Huawei / Novatech"
    elif "zte" in vendor_text or model and model.startswith("F6"):
        vendor = "ZTE"
    elif "fiberhome" in lowered or model and model.startswith("AN"):
        vendor = "FiberHome"
    else:
        vendor = "ONU compatible"

    title_match = re.search(r"<title[^>]*>(.*?)</title>", compact, re.I | re.S)
    title = re.sub(r"\s+", " ", title_match.group(1)).strip() if title_match else ""
    is_huawei = "txt_Username" in compact and "loginbutton" in compact
    is_zte = "Frm_Username" in compact and "Frm_Password" in compact
    return {
        "vendor": vendor,
        "model": model or title or "Modelo no identificado",
        "title": title,
        "server": server,
        "fingerprint": "huawei-webui" if is_huawei else "zte-webui" if is_zte else "http-management",
    }


def fetch_identity(
    host: IPv4Address | IPv6Address,
    timeout: float = 2.5,
    *,
    adapter_index: int | None = None,
    source_address: str | None = None,
) -> dict:
    with open_http_socket(
        host,
        timeout=timeout,
        adapter_index=adapter_index,
        source_address=source_address,
    ) as sock:
        host_header = str(host).split("%", 1)[0]
        request = (
            f"GET / HTTP/1.1\r\nHost: {host_header}\r\n"
            "User-Agent: ISP-Max-ONU-Discovery/1.1\r\n"
            "Accept: text/html,*/*;q=0.8\r\nConnection: close\r\n\r\n"
        )
        sock.sendall(request.encode("ascii"))
        chunks: list[bytes] = []
        size = 0
        while size < 524_288:
            chunk = sock.recv(min(65_536, 524_288 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
    raw = b"".join(chunks)
    header_raw, _, body_raw = raw.partition(b"\r\n\r\n")
    header_text = header_raw.decode("iso-8859-1", errors="replace")
    status_match = re.match(r"HTTP/\d(?:\.\d)?\s+(\d+)", header_text)
    headers = {}
    for line in header_text.split("\r\n")[1:]:
        name, separator, value = line.partition(":")
        if separator:
            headers[name.strip().lower()] = value.strip()
    body = body_raw.decode("utf-8", errors="replace")
    return {"http_status": int(status_match.group(1)) if status_match else None, **infer_device(body, headers)}


def adapter_for_host(adapters: list[dict], host: IPv4Address) -> dict | None:
    for adapter in adapters:
        if not adapter.get("supported") or adapter.get("status") != "Up":
            continue
        for address in adapter.get("addresses", []):
            try:
                if host in IPv4Interface(f"{address}/24").network:
                    return adapter
            except ValueError:
                continue
    return None


def scan_once(hosts: tuple[IPv4Address, ...] = DEFAULT_HOSTS) -> dict:
    adapters = list_adapters()
    wired_up = [row for row in adapters if row.get("supported") and row.get("status") == "Up"]
    candidates: list[dict] = []

    for host in hosts:
        adapter = adapter_for_host(adapters, host)
        if not adapter:
            continue
        source = next(
            (address for address in adapter.get("addresses", []) if host in IPv4Interface(f"{address}/24").network),
            None,
        )
        probe = probe_http(host, timeout=0.8, adapter_index=adapter.get("index"), source_address=source)
        candidate = {
            "host": str(host),
            "reachable": probe["reachable"],
            "latency_ms": probe.get("latency_ms"),
            "adapter_index": adapter.get("index"),
            "adapter_name": adapter.get("name"),
        }
        if probe["reachable"]:
            try:
                candidate.update(fetch_identity(
                    host,
                    adapter_index=adapter.get("index"),
                    source_address=source,
                ))
            except Exception as exc:
                candidate.update({
                    "vendor": "ONU compatible",
                    "model": "Panel HTTP detectado",
                    "fingerprint": "http-management",
                    "identity_error": str(exc),
                })
        candidates.append(candidate)

    for adapter in wired_up:
        ipv6_sources = adapter.get("ipv6_addresses", [])
        if not ipv6_sources:
            continue
        host = IPv6Address(f"fe80::1%{adapter['index']}")
        source = ipv6_sources[0]
        probe = probe_http(
            host,
            timeout=0.8,
            adapter_index=adapter.get("index"),
            source_address=source,
        )
        candidate = {
            "host": str(host),
            "reachable": probe["reachable"],
            "latency_ms": probe.get("latency_ms"),
            "adapter_index": adapter.get("index"),
            "adapter_name": adapter.get("name"),
            "transport": "ipv6_link_local",
        }
        if probe["reachable"]:
            try:
                candidate.update(fetch_identity(
                    host,
                    adapter_index=adapter.get("index"),
                    source_address=source,
                ))
            except Exception as exc:
                candidate.update({
                    "vendor": "ONU compatible",
                    "model": "Panel HTTP detectado",
                    "fingerprint": "http-management",
                    "identity_error": str(exc),
                })
        candidates.append(candidate)

    detected = next(
        (row for row in candidates if row["reachable"] and row.get("fingerprint") in {"huawei-webui", "zte-webui"}),
        next((row for row in candidates if row["reachable"]), None),
    )
    if detected:
        status = "detected"
        next_action = "La ONU esta lista para comprobar credenciales o aprovisionar."
    elif candidates:
        status = "not_detected"
        next_action = "Verifica el cable, la alimentacion y que la ONU use una IP de gestion compatible."
    elif wired_up:
        status = "network_setup_required"
        next_action = "Selecciona la tarjeta Ethernet y usa Preparar red y comprobar."
    else:
        status = "cable_disconnected"
        next_action = "Conecta la ONU por Ethernet y espera la deteccion automatica."

    return {
        "status": status,
        "detected": bool(detected),
        "device": detected,
        "candidates": candidates,
        "wired_adapters": wired_up,
        "last_scan_at": utc_now(),
        "next_action": next_action,
    }


class DiscoveryService:
    def __init__(self, interval_seconds: float = 5.0):
        self.interval_seconds = interval_seconds
        self._state = {
            "status": "scanning",
            "detected": False,
            "device": None,
            "candidates": [],
            "wired_adapters": [],
            "last_scan_at": None,
            "next_action": "Buscando una ONU conectada.",
        }
        self._lock = threading.Lock()
        self._scan_lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._run, name="onu-discovery", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def get(self) -> dict:
        with self._lock:
            return dict(self._state)

    def scan(self) -> dict:
        if not self._scan_lock.acquire(blocking=False):
            return self.get()
        try:
            state = scan_once()
        except Exception as exc:
            state = {
                **self.get(),
                "status": "error",
                "last_scan_at": utc_now(),
                "error": str(exc),
                "next_action": "No se pudo consultar la red local. Revisa los permisos del agente.",
            }
        finally:
            self._scan_lock.release()
        with self._lock:
            self._state = state
        return self.get()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.scan()
            self._stop.wait(self.interval_seconds)
