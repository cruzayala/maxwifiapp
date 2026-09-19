from __future__ import annotations

import ctypes
import json
import platform
import socket
import subprocess
import time
from ipaddress import IPv4Address, IPv6Address


class NetworkError(RuntimeError):
    pass


def is_wired_adapter(adapter: dict) -> bool:
    label = f"{adapter.get('name', '')} {adapter.get('description', '')}".lower()
    blocked = ("wi-fi", "wifi", "wireless", "bluetooth", "vpn", "tunnel", "hyper-v", "vethernet", "tap-")
    return not any(term in label for term in blocked)


def is_windows_admin() -> bool:
    if platform.system() != "Windows":
        return False
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _powershell(script: str, timeout: int = 15) -> str:
    creation_flags = subprocess.CREATE_NO_WINDOW if platform.system() == "Windows" else 0
    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
    )
    if result.returncode:
        message = (result.stderr or result.stdout or "PowerShell devolvio un error").strip()
        raise NetworkError(message)
    return result.stdout.strip()


def list_adapters() -> list[dict]:
    if platform.system() != "Windows":
        return []
    script = """
    $items = Get-NetAdapter | Where-Object { $_.Status -ne 'Disabled' } | ForEach-Object {
      $adapter = $_
      $ips = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '169.254.*' } |
        Select-Object -ExpandProperty IPAddress)
      $ipv6 = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv6 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like 'fe80:*' } |
        Select-Object -ExpandProperty IPAddress)
      [pscustomobject]@{
        name = $adapter.Name
        description = $adapter.InterfaceDescription
        index = $adapter.ifIndex
        status = $adapter.Status.ToString()
        link_speed = $adapter.LinkSpeed
        mac = $adapter.MacAddress
        addresses = $ips
        ipv6_addresses = $ipv6
      }
    }
    @($items) | ConvertTo-Json -Compress
    """
    raw = _powershell(script)
    if not raw:
        return []
    parsed = json.loads(raw)
    rows = parsed if isinstance(parsed, list) else [parsed]
    for row in rows:
        row["supported"] = is_wired_adapter(row)
    return sorted(rows, key=lambda row: (not row["supported"], row.get("status") != "Up", row.get("name", "")))


def ensure_ipv4_address(adapter_index: int, address: IPv4Address, prefix_length: int) -> dict:
    if platform.system() != "Windows":
        raise NetworkError("La preparacion automatica de la tarjeta esta disponible en Windows")

    adapters = list_adapters()
    adapter = next((item for item in adapters if int(item["index"]) == adapter_index), None)
    if not adapter:
        raise NetworkError("La tarjeta de red seleccionada ya no esta disponible")
    if not is_wired_adapter(adapter):
        raise NetworkError("Selecciona una tarjeta Ethernet fisica; WiFi, VPN y adaptadores virtuales estan bloqueados")

    target = str(address)
    for item in adapters:
        if target in item.get("addresses", []):
            if int(item["index"]) != adapter_index:
                raise NetworkError(f"La IP {target} ya esta asignada a {item['name']}")
            return {"changed": False, "adapter": adapter, "address": target, "prefix_length": prefix_length}

    if not is_windows_admin():
        raise NetworkError("Ejecuta el agente como administrador para agregar la IP local a Ethernet")

    script = (
        f"New-NetIPAddress -InterfaceIndex {int(adapter_index)} -IPAddress '{target}' "
        f"-PrefixLength {int(prefix_length)} -AddressFamily IPv4 -Type Unicast "
        "-SkipAsSource $true -ErrorAction Stop | Out-Null"
    )
    _powershell(script)
    return {"changed": True, "adapter": adapter, "address": target, "prefix_length": prefix_length}


def _scope_index(host: IPv6Address, adapter_index: int | None = None) -> int:
    if adapter_index:
        return int(adapter_index)
    scope = getattr(host, "scope_id", None)
    if scope and str(scope).isdigit():
        return int(scope)
    if scope:
        return socket.if_nametoindex(str(scope))
    raise NetworkError("La direccion IPv6 local requiere el indice de la tarjeta Ethernet")


def host_for_url(host: IPv4Address | IPv6Address, adapter_index: int | None = None) -> str:
    if isinstance(host, IPv6Address):
        scope = _scope_index(host, adapter_index)
        address = str(host).split("%", 1)[0]
        return f"[{address}%25{scope}]"
    return str(host)


def open_http_socket(
    host: IPv4Address | IPv6Address,
    *,
    timeout: float = 2.5,
    adapter_index: int | None = None,
    source_address: str | None = None,
) -> socket.socket:
    if isinstance(host, IPv6Address):
        scope = _scope_index(host, adapter_index)
        address = str(host).split("%", 1)[0]
        sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        if source_address:
            source = source_address.split("%", 1)[0]
            sock.bind((source, 0, 0, scope))
        sock.connect((address, 80, 0, scope))
        return sock

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    if source_address:
        sock.bind((source_address, 0))
    sock.connect((str(host), 80))
    return sock


def probe_http(
    host: IPv4Address | IPv6Address,
    timeout: float = 2.5,
    *,
    adapter_index: int | None = None,
    source_address: str | None = None,
) -> dict:
    started = time.perf_counter()
    try:
        with open_http_socket(
            host,
            timeout=timeout,
            adapter_index=adapter_index,
            source_address=source_address,
        ):
            latency_ms = round((time.perf_counter() - started) * 1000)
            return {"reachable": True, "latency_ms": latency_ms, "port": 80}
    except OSError as exc:
        return {"reachable": False, "latency_ms": None, "port": 80, "error": str(exc)}
