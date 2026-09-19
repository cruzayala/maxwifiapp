from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Callable


SECRET_PATH = re.compile(r"password|passphrase|secret|credential|key", re.I)


class GenieAcsError(RuntimeError):
    def __init__(self, message: str, code: str = "TR069_ERROR", *, rollback=None, verification=None):
        super().__init__(message)
        self.code = code
        self.rollback = rollback
        self.verification = verification


def _leaf_node(node: dict, path: str) -> dict | None:
    current = node
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current if isinstance(current, dict) and "_value" in current else None


def _object_node(node: dict, path: str) -> dict:
    current = node
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return {}
        current = current[part]
    return current if isinstance(current, dict) else {}


def _leaf_value(node: dict, path: str, default=None):
    leaf = _leaf_node(node, path)
    return leaf.get("_value", default) if leaf else default


def _parse_timestamp(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def serial_candidates(value: str) -> set[str]:
    serial = re.sub(r"[^A-Z0-9]", "", str(value or "").upper())
    result = {serial} if serial else set()
    if re.fullmatch(r"[A-Z]{4}[A-F0-9]+", serial):
        result.add(serial[:4].encode("ascii").hex().upper() + serial[4:])
    if re.fullmatch(r"[A-F0-9]{8}[A-F0-9]+", serial):
        try:
            vendor = bytes.fromhex(serial[:8]).decode("ascii")
            if re.fullmatch(r"[A-Z0-9]{4}", vendor):
                result.add(vendor + serial[8:])
        except (UnicodeDecodeError, ValueError):
            pass
    return result


class GenieAcsClient:
    ROOT = "InternetGatewayDevice"
    DEVICE_INFO = f"{ROOT}.DeviceInfo"
    WIFI_ROOT = f"{ROOT}.LANDevice.1.WLANConfiguration.1"
    LAN_ROOT = f"{ROOT}.LANDevice.1"
    DHCP_ROOT = f"{LAN_ROOT}.LANHostConfigManagement"
    WAN_ROOT = f"{ROOT}.WANDevice.1.WANConnectionDevice.1.WANIPConnection"
    FIBER_ROOT = f"{ROOT}.WANDevice.1.X_GponInterafceConfig"
    TIME_ROOT = f"{ROOT}.Time"
    MANAGEMENT_ROOT = f"{ROOT}.ManagementServer"

    PROJECTION = ",".join([
        "_id", "_deviceId", "_lastInform", DEVICE_INFO, WIFI_ROOT,
        f"{LAN_ROOT}.LANEthernetInterfaceConfig", DHCP_ROOT, f"{LAN_ROOT}.Hosts",
        f"{ROOT}.WANDevice", f"{ROOT}.IPPingDiagnostics", f"{ROOT}.TraceRouteDiagnostics",
        f"{ROOT}.DownloadDiagnostics", f"{ROOT}.UploadDiagnostics", TIME_ROOT,
        MANAGEMENT_ROOT, f"{ROOT}.Layer3Forwarding", f"{ROOT}.QueueManagement",
        f"{ROOT}.Services", f"{ROOT}.X_HW_Security", f"{ROOT}.UserInterface",
    ])

    ACTION_STATUS = {
        "refresh": "verified", "set_wifi": "detected", "reboot": "verified",
        "set_lan_port": "detected", "set_dhcp": "detected", "set_time": "detected",
        "run_ping": "detected", "run_traceroute": "detected",
        "run_download_diagnostic": "detected", "run_upload_diagnostic": "detected",
        "upsert_dhcp_reservation": "blocked", "delete_dhcp_reservation": "blocked",
        "set_wan": "blocked", "upsert_port_mapping": "blocked", "delete_port_mapping": "blocked",
        "set_security": "blocked", "set_acs": "blocked", "factory_reset": "blocked",
        "firmware_download": "blocked",
    }

    def __init__(self, base_url: str = "http://127.0.0.1:7557", timeout: float = 20.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.refresh_confirm_timeout = 45.0
        self._identity_hints: dict[str, dict] = {}

    def set_identity_hints(self, serial: str, hints: dict | None) -> None:
        key = re.sub(r"[^A-Z0-9]", "", str(serial or "").upper())
        if not key:
            return
        clean = {}
        if isinstance(hints, dict):
            for field in ("acsDeviceId", "ip", "mac", "model"):
                value = str(hints.get(field) or "").strip()
                if value:
                    clean[field] = value
        if clean:
            self._identity_hints[key] = clean

    @staticmethod
    def _leaf_values(node) -> list[str]:
        values: list[str] = []

        def walk(current):
            if not isinstance(current, dict):
                return
            if "_value" in current and current.get("_value") is not None:
                values.append(str(current["_value"]).strip())
                return
            for key, value in current.items():
                if not str(key).startswith("_"):
                    walk(value)

        walk(node)
        return values

    def _matches_identity_hints(self, device: dict, hints: dict) -> bool:
        if hints.get("acsDeviceId") and device.get("_id") == hints["acsDeviceId"]:
            return True
        values = self._leaf_values(device)
        expected_ip = hints.get("ip")
        if expected_ip:
            return expected_ip in values
        expected_mac = re.sub(r"[^A-F0-9]", "", hints.get("mac", "").upper())
        if expected_mac:
            mac_values = {re.sub(r"[^A-F0-9]", "", value.upper()) for value in values}
            return expected_mac in mac_values
        # Model alone is not unique enough for a safe binding.
        return False

    def _request(self, path: str, method: str = "GET", body: dict | None = None):
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                result = json.loads(raw) if raw else {}
                if isinstance(result, dict):
                    result.setdefault("_httpStatus", response.status)
                return result
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:800]
            code = "CWMP_FAULT" if any(item in detail for item in ("9002", "9003", "9005", "9007", "9010")) else "GENIEACS_HTTP"
            raise GenieAcsError(f"GenieACS respondio HTTP {exc.code}: {detail}", code) from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise GenieAcsError(f"GenieACS local no responde: {exc}", "GENIEACS_UNAVAILABLE") from exc

    def find_device(self, serial: str) -> dict:
        devices = self._request(f"/devices/?projection={urllib.parse.quote(self.PROJECTION)}")
        candidates = serial_candidates(serial)
        rows = devices if isinstance(devices, list) else []
        for device in rows:
            identity = json.dumps({"id": device.get("_id"), "device": device.get("_deviceId")}, sort_keys=True).upper()
            compact = re.sub(r"[^A-Z0-9]", "", identity)
            if any(candidate and candidate in compact for candidate in candidates):
                return device
        key = re.sub(r"[^A-Z0-9]", "", str(serial or "").upper())
        hints = self._identity_hints.get(key, {})
        matches = [device for device in rows if self._matches_identity_hints(device, hints)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise GenieAcsError(
                f"La ONU {serial} coincide con varios dispositivos CWMP; no se enlazo automaticamente",
                "DEVICE_IDENTITY_AMBIGUOUS",
            )
        raise GenieAcsError(f"La ONU {serial} no aparece en GenieACS", "DEVICE_NOT_FOUND")

    def _task(self, device_id: str, body: dict):
        quoted = urllib.parse.quote(device_id, safe="")
        return self._request(f"/devices/{quoted}/tasks?connection_request", method="POST", body=body)

    @staticmethod
    def _rows(node: dict, path: str) -> list[tuple[int, dict]]:
        current = node
        for part in path.split("."):
            current = current.get(part, {}) if isinstance(current, dict) else {}
        return sorted(
            ((int(key), value) for key, value in current.items() if str(key).isdigit() and isinstance(value, dict)),
            key=lambda item: item[0],
        ) if isinstance(current, dict) else []

    def _safe_parameters(self, device: dict, maximum: int = 2000) -> list[dict]:
        result: list[dict] = []

        def walk(node, path=""):
            if len(result) >= maximum or not isinstance(node, dict):
                return
            if "_value" in node:
                if SECRET_PATH.search(path):
                    return
                value = node.get("_value")
                if isinstance(value, (dict, list)):
                    value = json.dumps(value, ensure_ascii=True)[:256]
                elif isinstance(value, str):
                    value = value[:256]
                result.append({"path": path, "value": value, "type": node.get("_type"), "writable": node.get("_writable") is True})
                return
            for key, value in node.items():
                if not str(key).startswith("_"):
                    walk(value, f"{path}.{key}" if path else str(key))

        walk(device.get(self.ROOT, {}), self.ROOT)
        return result

    def capabilities(self, device: dict) -> dict:
        manufacturer = str(_leaf_value(device, f"{self.DEVICE_INFO}.Manufacturer") or device.get("_deviceId", {}).get("_Manufacturer") or "").lower()
        model = str(_leaf_value(device, f"{self.DEVICE_INFO}.ModelName") or _leaf_value(device, f"{self.DEVICE_INFO}.ProductClass") or device.get("_deviceId", {}).get("_ProductClass") or "").lower()
        required = {
            "set_lan_port": f"{self.LAN_ROOT}.LANEthernetInterfaceConfig.1.Enable",
            "set_dhcp": f"{self.DHCP_ROOT}.DHCPServerEnable",
            "set_time": f"{self.TIME_ROOT}.Enable",
            "run_ping": f"{self.ROOT}.IPPingDiagnostics.DiagnosticsState",
            "run_traceroute": f"{self.ROOT}.TraceRouteDiagnostics.DiagnosticsState",
            "run_download_diagnostic": f"{self.ROOT}.DownloadDiagnostics.DiagnosticsState",
            "run_upload_diagnostic": f"{self.ROOT}.UploadDiagnostics.DiagnosticsState",
        }
        actions = {}
        for name, default_status in self.ACTION_STATUS.items():
            status = default_status
            if name == "set_wifi" and "huawei" in manufacturer and "eg8141a5" in model:
                status = "verified"
            path = required.get(name)
            if path and not _leaf_node(device, path):
                status = "blocked"
            actions[name] = {"status": status, "verifiedAt": None, "lastError": None}
        return {"actions": actions, "parameterCount": len(self._safe_parameters(device)), "collectedAt": datetime.now(timezone.utc).isoformat()}

    def snapshot(self, serial: str, include_parameters: bool = True) -> dict:
        device = self.find_device(serial)
        wifi = _object_node(device, self.WIFI_ROOT)
        wan_rows = self._rows(device, self.WAN_ROOT)
        active_wan = next((row for _, row in wan_rows if _leaf_value(row, "ConnectionStatus") == "Connected"), wan_rows[0][1] if wan_rows else {})
        associated = wifi.get("AssociatedDevice", {}) if isinstance(wifi, dict) else {}
        clients = []
        for key, row in associated.items() if isinstance(associated, dict) else []:
            if str(key).isdigit() and isinstance(row, dict):
                clients.append({
                    "source": "wifi", "index": int(key),
                    "mac": _leaf_value(row, "AssociatedDeviceMACAddress"),
                    "ip": _leaf_value(row, "AssociatedDeviceIPAddress"),
                    "signal": _leaf_value(row, "X_HW_RSSI"),
                })
        for index, row in self._rows(device, f"{self.LAN_ROOT}.Hosts.Host"):
            clients.append({
                "source": "dhcp", "index": index, "mac": _leaf_value(row, "MACAddress"),
                "ip": _leaf_value(row, "IPAddress"), "hostName": _leaf_value(row, "HostName"),
                "interface": _leaf_value(row, "InterfaceType"), "active": _leaf_value(row, "Active"),
            })
        lan_ports = []
        for index, row in self._rows(device, f"{self.LAN_ROOT}.LANEthernetInterfaceConfig"):
            lan_ports.append({
                "port": index, "enabled": bool(_leaf_value(row, "Enable", False)),
                "status": _leaf_value(row, "Status"), "speed": _leaf_value(row, "MaxBitRate"),
                "duplex": _leaf_value(row, "DuplexMode"), "flowControl": bool(_leaf_value(row, "X_HW_FlowCtrlEnable", False)),
                "l3Enabled": bool(_leaf_value(row, "X_HW_L3Enable", False)),
                "bytesReceived": _leaf_value(row, "Stats.BytesReceived"), "bytesSent": _leaf_value(row, "Stats.BytesSent"),
                "errorsReceived": _leaf_value(row, "Stats.ErrorsReceived"), "errorsSent": _leaf_value(row, "Stats.ErrorsSent"),
            })
        mappings = []
        for index, row in self._rows(active_wan, "PortMapping"):
            mappings.append({
                "instance": index, "enabled": bool(_leaf_value(row, "PortMappingEnabled", False)),
                "protocol": _leaf_value(row, "PortMappingProtocol"), "externalPort": _leaf_value(row, "ExternalPort"),
                "internalPort": _leaf_value(row, "InternalPort"), "internalClient": _leaf_value(row, "InternalClient"),
                "description": _leaf_value(row, "PortMappingDescription"),
            })
        last_inform = device.get("_lastInform")
        last_inform_dt = _parse_timestamp(last_inform)
        age_seconds = (datetime.now(timezone.utc) - last_inform_dt).total_seconds() if last_inform_dt else None
        advertisement_enabled = bool(_leaf_value(wifi, "SSIDAdvertisementEnabled", True))
        beacon_enabled = bool(_leaf_value(wifi, "BeaconAdvertisementEnabled", True))
        snapshot = {
            "deviceId": device.get("_id"),
            "manufacturer": _leaf_value(device, f"{self.DEVICE_INFO}.Manufacturer") or device.get("_deviceId", {}).get("_Manufacturer"),
            "model": _leaf_value(device, f"{self.DEVICE_INFO}.ModelName") or _leaf_value(device, f"{self.DEVICE_INFO}.ProductClass") or device.get("_deviceId", {}).get("_ProductClass"),
            "softwareVersion": _leaf_value(device, f"{self.DEVICE_INFO}.SoftwareVersion"),
            "lastInformAt": last_inform, "online": age_seconds is not None and age_seconds < 3600,
            "overview": {
                "uptime": _leaf_value(device, f"{self.DEVICE_INFO}.UpTime"),
                "cpuUsage": _leaf_value(device, f"{self.DEVICE_INFO}.ProcessStatus.CPUUsage", _leaf_value(device, f"{self.DEVICE_INFO}.X_HW_CpuUsed")),
                "memoryFree": _leaf_value(device, f"{self.DEVICE_INFO}.MemoryStatus.Free"),
                "memoryTotal": _leaf_value(device, f"{self.DEVICE_INFO}.MemoryStatus.Total"),
            },
            "fiber": {
                "status": _leaf_value(device, f"{self.FIBER_ROOT}.Status"),
                "rxPower": _leaf_value(device, f"{self.FIBER_ROOT}.RXPower"),
                "txPower": _leaf_value(device, f"{self.FIBER_ROOT}.TXPower"),
                "temperature": _leaf_value(device, f"{self.FIBER_ROOT}.TransceiverTemperature"),
                "voltage": _leaf_value(device, f"{self.FIBER_ROOT}.SupplyVoltage"),
                "biasCurrent": _leaf_value(device, f"{self.FIBER_ROOT}.BiasCurrent"),
                "fecErrors": _leaf_value(device, f"{self.FIBER_ROOT}.Stats.FECError"),
                "hecErrors": _leaf_value(device, f"{self.FIBER_ROOT}.Stats.HECError"),
                "dropPackets": _leaf_value(device, f"{self.FIBER_ROOT}.Stats.DropPackets"),
                "bytesReceived": _leaf_value(device, f"{self.FIBER_ROOT}.Stats.BytesReceived"),
                "bytesSent": _leaf_value(device, f"{self.FIBER_ROOT}.Stats.BytesSent"),
            },
            "wifi": {
                "enabled": bool(_leaf_value(wifi, "Enable", False)), "ssid": _leaf_value(wifi, "SSID"),
                "channel": _leaf_value(wifi, "Channel"), "broadcast": advertisement_enabled and beacon_enabled,
                "clients": len([row for row in clients if row.get("source") == "wifi"]),
                "transmitPower": _leaf_value(wifi, "TransmitPower"), "standard": _leaf_value(wifi, "X_HW_Standard", _leaf_value(wifi, "Standard")),
                "maxClients": _leaf_value(wifi, "X_HW_AssociateNum", _leaf_value(wifi, "X_ZTE-COM_MaxUserNum")), "wmm": bool(_leaf_value(wifi, "WMMEnable", False)),
                "wps": bool(_leaf_value(wifi, "WPS.Enable", False)),
            },
            "wan": {
                "ip": _leaf_value(active_wan, "ExternalIPAddress"), "status": _leaf_value(active_wan, "ConnectionStatus"),
                "vlan": _leaf_value(active_wan, "X_HW_VLAN", _leaf_value(active_wan, "X_ZTE-COM_VLANID")), "addressingType": _leaf_value(active_wan, "AddressingType"),
                "gateway": _leaf_value(active_wan, "DefaultGateway"), "dnsServers": _leaf_value(active_wan, "DNSServers"),
                "natEnabled": bool(_leaf_value(active_wan, "NATEnabled", False)), "mtu": _leaf_value(active_wan, "MaxMTUSize"),
                "serviceList": _leaf_value(active_wan, "X_HW_SERVICELIST", _leaf_value(active_wan, "X_ZTE-COM_ServiceList")),
            },
            "dhcp": {
                "enabled": bool(_leaf_value(device, f"{self.DHCP_ROOT}.DHCPServerEnable", False)),
                "minAddress": _leaf_value(device, f"{self.DHCP_ROOT}.MinAddress"),
                "maxAddress": _leaf_value(device, f"{self.DHCP_ROOT}.MaxAddress"),
                "subnetMask": _leaf_value(device, f"{self.DHCP_ROOT}.SubnetMask"),
                "router": _leaf_value(device, f"{self.DHCP_ROOT}.IPRouters"),
                "dnsServers": _leaf_value(device, f"{self.DHCP_ROOT}.DNSServers"),
                "leaseTime": _leaf_value(device, f"{self.DHCP_ROOT}.DHCPLeaseTime"),
            },
            "system": {
                "timeEnabled": bool(_leaf_value(device, f"{self.TIME_ROOT}.Enable", False)),
                "timeStatus": _leaf_value(device, f"{self.TIME_ROOT}.Status"),
                "timeZone": _leaf_value(device, f"{self.TIME_ROOT}.LocalTimeZone"),
                "timeZoneName": _leaf_value(device, f"{self.TIME_ROOT}.LocalTimeZoneName"),
                "periodicInformEnabled": bool(_leaf_value(device, f"{self.MANAGEMENT_ROOT}.PeriodicInformEnable", False)),
                "periodicInformInterval": _leaf_value(device, f"{self.MANAGEMENT_ROOT}.PeriodicInformInterval"),
            },
            "lanPorts": lan_ports, "clients": clients, "portMappings": mappings,
            "diagnostics": self._diagnostic_snapshot(device),
            "collectedAt": datetime.now(timezone.utc).isoformat(),
        }
        if include_parameters:
            snapshot["parameters"] = self._safe_parameters(device)
        return snapshot

    def _diagnostic_snapshot(self, device: dict) -> dict:
        result = {}
        definitions = {
            "ping": (f"{self.ROOT}.IPPingDiagnostics", ["DiagnosticsState", "Host", "SuccessCount", "FailureCount", "AverageResponseTime", "MinimumResponseTime", "MaximumResponseTime"]),
            "traceroute": (f"{self.ROOT}.TraceRouteDiagnostics", ["DiagnosticsState", "Host", "ResponseTime", "RouteHopsNumberOfEntries"]),
            "download": (f"{self.ROOT}.DownloadDiagnostics", ["DiagnosticsState", "ROMTime", "BOMTime", "EOMTime", "TestBytesReceived", "TotalBytesReceived"]),
            "upload": (f"{self.ROOT}.UploadDiagnostics", ["DiagnosticsState", "ROMTime", "BOMTime", "EOMTime", "TotalBytesSent"]),
        }
        for name, (root, fields) in definitions.items():
            result[name] = {field: _leaf_value(device, f"{root}.{field}") for field in fields}
        return result

    def refresh(self, serial: str, progress: Callable | None = None) -> dict:
        device = self.find_device(serial)
        previous_inform = device.get("_lastInform")
        if progress:
            progress("refreshing", 20)
        request_timed_out = False
        try:
            self._task(device["_id"], {"name": "refreshObject", "objectName": ""})
        except GenieAcsError as exc:
            if "timed out" not in str(exc).lower():
                raise
            request_timed_out = True
        snapshot = self.snapshot(serial)
        deadline = time.monotonic() + (self.refresh_confirm_timeout if request_timed_out else 1.0)
        while request_timed_out and snapshot.get("lastInformAt") == previous_inform and time.monotonic() < deadline:
            if progress:
                progress("waiting_for_inform", 70)
            time.sleep(min(1.0, max(0.01, deadline - time.monotonic())))
            snapshot = self.snapshot(serial)
        if request_timed_out and snapshot.get("lastInformAt") == previous_inform:
            raise GenieAcsError("La ONU no confirmo el refresco antes del tiempo limite", "REFRESH_TIMEOUT")
        if progress:
            progress("verified", 95)
        return snapshot

    def _assert_writable(self, device: dict, values: list[list]) -> dict:
        originals = {}
        for path, _value, _type in values:
            leaf = _leaf_node(device, path)
            if not leaf:
                raise GenieAcsError(f"El firmware no expone {path}", "PARAMETER_NOT_FOUND")
            if leaf.get("_writable") is not True:
                raise GenieAcsError(f"El firmware no permite modificar {path}", "PARAMETER_READ_ONLY")
            originals[path] = leaf.get("_value")
        return originals

    def _wait_for_values(self, serial: str, expected: dict, timeout: float = 20.0, progress: Callable | None = None) -> tuple[dict, dict]:
        deadline = time.monotonic() + timeout
        actual = {}
        snapshot = {}
        while time.monotonic() < deadline:
            device = self.find_device(serial)
            actual = {path: _leaf_value(device, path) for path in expected}
            if all(actual[path] == value for path, value in expected.items()):
                snapshot = self.snapshot(serial)
                return snapshot, {"expected": expected, "actual": actual, "verified": True}
            if progress:
                progress("verifying", 75)
            time.sleep(1.0)
        return snapshot, {"expected": expected, "actual": actual, "verified": False}

    def _apply_parameters(self, serial: str, values: list[list], *, reversible: bool = True, progress: Callable | None = None) -> tuple[dict, dict, dict]:
        device = self.find_device(serial)
        originals = self._assert_writable(device, values)
        if progress:
            progress("backup", 15)
            progress("applying", 45)
        task = self._task(device["_id"], {"name": "setParameterValues", "parameterValues": values})
        expected = {path: value for path, value, _type in values}
        snapshot, verification = self._wait_for_values(serial, expected, progress=progress)
        safe_originals = {path: ("[protected]" if SECRET_PATH.search(path) else value) for path, value in originals.items()}
        safe_verification = {
            **verification,
            "expected": {path: ("[protected]" if SECRET_PATH.search(path) else value) for path, value in verification.get("expected", {}).items()},
            "actual": {path: ("[protected]" if SECRET_PATH.search(path) else value) for path, value in verification.get("actual", {}).items()},
        }
        rollback = {"attempted": False, "succeeded": None, "originalValues": safe_originals}
        if verification["verified"]:
            safe_verification["genieAcsHttpStatus"] = task.get("_httpStatus") if isinstance(task, dict) else None
            return snapshot, safe_verification, rollback
        if reversible:
            rollback["attempted"] = True
            types = {path: value_type for path, _value, value_type in values}
            rollback_values = [[path, original, types[path]] for path, original in originals.items()]
            try:
                self._task(device["_id"], {"name": "setParameterValues", "parameterValues": rollback_values})
                _, rollback_check = self._wait_for_values(serial, originals, timeout=12.0)
                rollback["succeeded"] = rollback_check["verified"]
            except Exception as exc:
                rollback["succeeded"] = False
                rollback["error"] = str(exc)[:300]
        raise GenieAcsError("La ONU no confirmo los valores solicitados", "READBACK_MISMATCH", rollback=rollback, verification=safe_verification)

    def set_wifi(self, serial: str, payload: dict, progress=None) -> dict:
        device = self.find_device(serial)
        values = []
        mapping = {
            "ssid": ("SSID", "xsd:string"), "transmitPower": ("TransmitPower", "xsd:unsignedInt"),
            "wmm": ("WMMEnable", "xsd:boolean"), "wps": ("WPS.Enable", "xsd:boolean"),
        }
        for key, (parameter, value_type) in mapping.items():
            if key in payload and payload[key] is not None:
                values.append([f"{self.WIFI_ROOT}.{parameter}", payload[key], value_type])
        vendor_fields = {
            "standard": [("X_HW_Standard", "xsd:string"), ("Standard", "xsd:string")],
            "maxClients": [("X_HW_AssociateNum", "xsd:unsignedInt"), ("X_ZTE-COM_MaxUserNum", "xsd:unsignedInt")],
        }
        for key, candidates in vendor_fields.items():
            if key not in payload or payload[key] is None:
                continue
            selected = None
            current = None
            for parameter, value_type in candidates:
                leaf = _leaf_node(device, f"{self.WIFI_ROOT}.{parameter}")
                if leaf:
                    current = leaf.get("_value")
                    if leaf.get("_writable") is True:
                        selected = (parameter, value_type)
                        break
            if selected:
                values.append([f"{self.WIFI_ROOT}.{selected[0]}", payload[key], selected[1]])
            elif current != payload[key]:
                raise GenieAcsError(f"Este firmware no permite modificar {key} por TR-069", "PARAMETER_READ_ONLY")
        if payload.get("channel") is not None:
            channel = int(payload["channel"])
            values.append([f"{self.WIFI_ROOT}.AutoChannelEnable", channel == 0, "xsd:boolean"])
            if channel:
                values.append([f"{self.WIFI_ROOT}.Channel", channel, "xsd:unsignedInt"])
        if payload.get("enabled") is not None:
            enabled = bool(payload["enabled"])
            values.extend([[f"{self.WIFI_ROOT}.Enable", enabled, "xsd:boolean"], [f"{self.WIFI_ROOT}.RadioEnabled", enabled, "xsd:boolean"]])
        if payload.get("broadcast") is not None:
            values.append([f"{self.WIFI_ROOT}.SSIDAdvertisementEnabled", bool(payload["broadcast"]), "xsd:boolean"])
            beacon = _leaf_node(device, f"{self.WIFI_ROOT}.BeaconAdvertisementEnabled")
            if beacon and beacon.get("_writable") is True:
                values.append([f"{self.WIFI_ROOT}.BeaconAdvertisementEnabled", True, "xsd:boolean"])
        if payload.get("password") is not None:
            pre_shared_key = _leaf_node(device, f"{self.WIFI_ROOT}.PreSharedKey.1.KeyPassphrase")
            root_key = _leaf_node(device, f"{self.WIFI_ROOT}.KeyPassphrase")
            if pre_shared_key and pre_shared_key.get("_writable") is True:
                password_parameter = "PreSharedKey.1.KeyPassphrase"
            elif root_key and root_key.get("_writable") is True:
                password_parameter = "KeyPassphrase"
            else:
                raise GenieAcsError("Este firmware no expone una clave WiFi editable por TR-069", "PARAMETER_READ_ONLY")
            values.append([f"{self.WIFI_ROOT}.{password_parameter}", payload["password"], "xsd:string"])
        if not values:
            raise GenieAcsError("La tarea WiFi no contiene cambios", "EMPTY_TASK")
        snapshot, verification, rollback = self._apply_parameters(serial, values, progress=progress)
        return {"message": "Configuracion WiFi aplicada y verificada", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def set_lan_port(self, serial: str, payload: dict, progress=None) -> dict:
        root = f"{self.LAN_ROOT}.LANEthernetInterfaceConfig.{payload['port']}"
        mapping = {"enabled": ("Enable", "xsd:boolean"), "speed": ("MaxBitRate", "xsd:string"), "duplex": ("DuplexMode", "xsd:string"), "flowControl": ("X_HW_FlowCtrlEnable", "xsd:boolean"), "l3Enabled": ("X_HW_L3Enable", "xsd:boolean")}
        values = [[f"{root}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
        snapshot, verification, rollback = self._apply_parameters(serial, values, progress=progress)
        return {"message": "Puerto LAN aplicado y verificado", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def set_dhcp(self, serial: str, payload: dict, progress=None) -> dict:
        mapping = {"enabled": ("DHCPServerEnable", "xsd:boolean"), "minAddress": ("MinAddress", "xsd:string"), "maxAddress": ("MaxAddress", "xsd:string"), "subnetMask": ("SubnetMask", "xsd:string"), "router": ("IPRouters", "xsd:string"), "dnsServers": ("DNSServers", "xsd:string"), "leaseTime": ("DHCPLeaseTime", "xsd:int")}
        values = [[f"{self.DHCP_ROOT}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
        snapshot, verification, rollback = self._apply_parameters(serial, values, progress=progress)
        return {"message": "LAN y DHCP aplicados y verificados", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def set_time(self, serial: str, payload: dict, progress=None) -> dict:
        mapping = {"enabled": (f"{self.TIME_ROOT}.Enable", "xsd:boolean"), "ntpServer1": (f"{self.TIME_ROOT}.NTPServer1", "xsd:string"), "ntpServer2": (f"{self.TIME_ROOT}.NTPServer2", "xsd:string"), "timeZone": (f"{self.TIME_ROOT}.LocalTimeZone", "xsd:string"), "timeZoneName": (f"{self.TIME_ROOT}.LocalTimeZoneName", "xsd:string"), "informInterval": (f"{self.MANAGEMENT_ROOT}.PeriodicInformInterval", "xsd:unsignedInt")}
        values = [[path, payload[key], value_type] for key, (path, value_type) in mapping.items() if key in payload]
        if "informInterval" in payload:
            values.append([f"{self.MANAGEMENT_ROOT}.PeriodicInformEnable", True, "xsd:boolean"])
        snapshot, verification, rollback = self._apply_parameters(serial, values, progress=progress)
        return {"message": "Hora e intervalo TR-069 aplicados", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def _run_diagnostic(self, serial: str, kind: str, payload: dict, progress=None) -> dict:
        definitions = {
            "run_ping": (f"{self.ROOT}.IPPingDiagnostics", {"host": ("Host", "xsd:string"), "interface": ("Interface", "xsd:string"), "repetitions": ("NumberOfRepetitions", "xsd:unsignedInt"), "timeout": ("Timeout", "xsd:unsignedInt"), "blockSize": ("DataBlockSize", "xsd:unsignedInt")}, "ping"),
            "run_traceroute": (f"{self.ROOT}.TraceRouteDiagnostics", {"host": ("Host", "xsd:string"), "interface": ("Interface", "xsd:string"), "maxHops": ("MaxHopCount", "xsd:unsignedInt"), "timeout": ("Timeout", "xsd:unsignedInt")}, "traceroute"),
            "run_download_diagnostic": (f"{self.ROOT}.DownloadDiagnostics", {"url": ("DownloadURL", "xsd:string"), "interface": ("Interface", "xsd:string")}, "download"),
            "run_upload_diagnostic": (f"{self.ROOT}.UploadDiagnostics", {"url": ("UploadURL", "xsd:string"), "interface": ("Interface", "xsd:string"), "testFileLength": ("TestFileLength", "xsd:unsignedInt")}, "upload"),
        }
        root, mapping, result_key = definitions[kind]
        values = [[f"{root}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload and payload[key] not in (None, "")]
        values.append([f"{root}.DiagnosticsState", "Requested", "xsd:string"])
        device = self.find_device(serial)
        self._assert_writable(device, values)
        if progress:
            progress("diagnostic_requested", 35)
        self._task(device["_id"], {"name": "setParameterValues", "parameterValues": values})
        deadline = time.monotonic() + 90
        last = {}
        while time.monotonic() < deadline:
            current = self.find_device(serial)
            state = str(_leaf_value(current, f"{root}.DiagnosticsState", ""))
            last = self._diagnostic_snapshot(current).get(result_key, {})
            if state not in {"", "None", "Requested"}:
                if state != "Complete" and not state.startswith("Completed"):
                    raise GenieAcsError(f"El diagnostico termino con estado {state}", "DIAGNOSTIC_FAILED", verification=last)
                snapshot = self.snapshot(serial)
                return {"message": "Diagnostico completado", "snapshot": snapshot, "diagnostic": last, "verification": {"state": state, "verified": True}, "rollback": None}
            if progress:
                progress("diagnostic_running", 60)
            time.sleep(2)
        raise GenieAcsError("La ONU no reporto el resultado del diagnostico", "DIAGNOSTIC_TIMEOUT", verification=last)

    def set_wan(self, serial: str, payload: dict, progress=None) -> dict:
        root = f"{self.WAN_ROOT}.{payload.get('connection', 1)}"
        mapping = {"enabled": ("Enable", "xsd:boolean"), "addressingType": ("AddressingType", "xsd:string"), "ipAddress": ("ExternalIPAddress", "xsd:string"), "subnetMask": ("SubnetMask", "xsd:string"), "gateway": ("DefaultGateway", "xsd:string"), "dnsServers": ("DNSServers", "xsd:string"), "vlan": ("X_HW_VLAN", "xsd:unsignedInt"), "mtu": ("MaxMTUSize", "xsd:unsignedInt"), "natEnabled": ("NATEnabled", "xsd:boolean"), "serviceList": ("X_HW_SERVICELIST", "xsd:string")}
        values = [[f"{root}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
        snapshot, verification, rollback = self._apply_parameters(serial, values, reversible=True, progress=progress)
        return {"message": "WAN aplicada y verificada", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def set_security(self, serial: str, payload: dict, progress=None) -> dict:
        root = f"{self.WAN_ROOT}.{payload.get('connection', 1)}.X_HW_DMZ"
        mapping = {"dmzEnabled": ("DMZEnable", "xsd:boolean"), "dmzHost": ("DMZHostAddress", "xsd:string")}
        values = [[f"{root}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
        snapshot, verification, rollback = self._apply_parameters(serial, values, progress=progress)
        return {"message": "Seguridad aplicada y verificada", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def set_acs(self, serial: str, payload: dict, progress=None) -> dict:
        mapping = {"enabled": ("X_HW_EnableCWMP", "xsd:boolean"), "acsUrl": ("URL", "xsd:string"), "username": ("Username", "xsd:string"), "password": ("Password", "xsd:string"), "connectionRequestUsername": ("ConnectionRequestUsername", "xsd:string"), "connectionRequestPassword": ("ConnectionRequestPassword", "xsd:string"), "informInterval": ("PeriodicInformInterval", "xsd:unsignedInt")}
        values = [[f"{self.MANAGEMENT_ROOT}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
        if "informInterval" in payload:
            values.append([f"{self.MANAGEMENT_ROOT}.PeriodicInformEnable", True, "xsd:boolean"])
        snapshot, verification, rollback = self._apply_parameters(serial, values, reversible=True, progress=progress)
        return {"message": "ACS aplicado y verificado", "snapshot": snapshot, "verification": verification, "rollback": rollback}

    def _table_action(self, serial: str, action: str, payload: dict, progress=None) -> dict:
        is_dhcp = "dhcp" in action
        parent = f"{self.DHCP_ROOT}.DHCPStaticAddress" if is_dhcp else f"{self.WAN_ROOT}.{payload.get('connection', 1)}.PortMapping"
        instance = payload.get("instance")
        device = self.find_device(serial)
        if action.startswith("delete_"):
            if not instance:
                raise GenieAcsError("Falta la instancia que se eliminara", "INSTANCE_REQUIRED")
            self._task(device["_id"], {"name": "deleteObject", "objectName": f"{parent}.{instance}"})
            message = "Objeto eliminado"
        else:
            if not instance:
                before = {index for index, _row in self._rows(device, parent)}
                self._task(device["_id"], {"name": "addObject", "objectName": parent})
                time.sleep(1)
                refreshed = self.find_device(serial)
                after = {index for index, _row in self._rows(refreshed, parent)}
                created = sorted(after - before)
                if not created:
                    raise GenieAcsError("La ONU no confirmo la nueva instancia", "ADD_OBJECT_FAILED")
                instance = created[-1]
            root = f"{parent}.{instance}"
            if is_dhcp:
                mapping = {"enabled": ("Enable", "xsd:boolean"), "macAddress": ("Chaddr", "xsd:string"), "ipAddress": ("Yiaddr", "xsd:string")}
            else:
                mapping = {"enabled": ("PortMappingEnabled", "xsd:boolean"), "protocol": ("PortMappingProtocol", "xsd:string"), "externalPort": ("ExternalPort", "xsd:unsignedInt"), "internalPort": ("InternalPort", "xsd:unsignedInt"), "internalClient": ("InternalClient", "xsd:string"), "description": ("PortMappingDescription", "xsd:string")}
            values = [[f"{root}.{field}", payload[key], value_type] for key, (field, value_type) in mapping.items() if key in payload]
            self._apply_parameters(serial, values, progress=progress)
            message = "Objeto creado o actualizado"
        snapshot = self.snapshot(serial)
        return {"message": message, "snapshot": snapshot, "verification": {"verified": True, "instance": instance}, "rollback": None}

    def reboot(self, serial: str, progress=None) -> dict:
        device = self.find_device(serial)
        previous_inform = device.get("_lastInform")
        previous_uptime = _leaf_value(device, f"{self.DEVICE_INFO}.UpTime")
        if progress:
            progress("rebooting", 50)
        response = self._task(device["_id"], {"name": "reboot"})
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            current = self.find_device(serial)
            current_inform = current.get("_lastInform")
            current_uptime = _leaf_value(current, f"{self.DEVICE_INFO}.UpTime")
            inform_changed = bool(current_inform and current_inform != previous_inform)
            uptime_restarted = previous_uptime is None or current_uptime is None
            try:
                if previous_uptime is not None and current_uptime is not None:
                    uptime_restarted = int(current_uptime) < int(previous_uptime)
            except (TypeError, ValueError):
                uptime_restarted = False
            if inform_changed and uptime_restarted:
                snapshot = self.snapshot(serial)
                return {
                    "message": "ONU reiniciada y reconectada a GenieACS",
                    "snapshot": snapshot,
                    "verification": {
                        "verified": True, "informChanged": True, "uptimeRestarted": True,
                        "previousUptime": previous_uptime, "currentUptime": current_uptime,
                        "genieAcsHttpStatus": response.get("_httpStatus"),
                    },
                    "rollback": None,
                }
            if progress:
                progress("waiting_for_inform", 75)
            time.sleep(2)
        raise GenieAcsError(
            "GenieACS acepto el reinicio, pero la ONU no confirmo su regreso",
            "REBOOT_NOT_CONFIRMED",
            verification={"verified": False, "previousInform": previous_inform, "previousUptime": previous_uptime},
        )

    def execute(self, serial: str, action: str, payload: dict, progress: Callable | None = None) -> dict:
        if self.ACTION_STATUS.get(action) == "blocked":
            raise GenieAcsError("Operacion bloqueada hasta certificar este firmware", "ACTION_BLOCKED")
        handlers = {
            "set_wifi": self.set_wifi, "set_lan_port": self.set_lan_port, "set_dhcp": self.set_dhcp,
            "set_time": self.set_time, "set_wan": self.set_wan, "set_security": self.set_security,
            "set_acs": self.set_acs, "reboot": self.reboot,
        }
        if action == "refresh":
            snapshot = self.refresh(serial, progress)
            return {"message": "Inventario TR-069 actualizado", "snapshot": snapshot, "verification": {"verified": True}, "rollback": None}
        if action in handlers:
            return handlers[action](serial, payload, progress)
        if action.startswith("run_"):
            return self._run_diagnostic(serial, action, payload, progress)
        if action in {"upsert_dhcp_reservation", "delete_dhcp_reservation", "upsert_port_mapping", "delete_port_mapping"}:
            return self._table_action(serial, action, payload, progress)
        if action == "factory_reset":
            device = self.find_device(serial)
            response = self._task(device["_id"], {"name": "factoryReset"})
            return {"message": "Restauracion de fabrica aceptada", "snapshot": self.snapshot(serial), "verification": {"accepted": True, "genieAcsHttpStatus": response.get("_httpStatus")}, "rollback": None}
        if action == "firmware_download":
            device = self.find_device(serial)
            response = self._task(device["_id"], {"name": "download", "file": payload["fileName"]})
            return {"message": "Transferencia de firmware aceptada", "snapshot": self.snapshot(serial), "verification": {"accepted": True, "sha256": payload["sha256"], "genieAcsHttpStatus": response.get("_httpStatus")}, "rollback": None}
        raise GenieAcsError("Operacion TR-069 no permitida", "ACTION_NOT_ALLOWED")
