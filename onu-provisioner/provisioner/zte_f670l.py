from __future__ import annotations

import os
import re
import sys
import time
from contextlib import nullcontext
from datetime import datetime, timezone
from ipaddress import IPv4Network, IPv6Address
from pathlib import Path
from typing import Callable

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Page, TimeoutError as PlaywrightTimeout, sync_playwright

from .huawei_eg8141a5 import OnuProvisioningError
from .identity import normalize_gpon_serial
from .models import DeviceSettings, ProvisionRequest
from .tcp_bridge import LinkLocalHttpBridge


ProgressCallback = Callable[[str, str, str], None]


F670L_AUDIT_PAGES = {
    "device": "status_dev_info_t.gch",
    "wan_status": "IPv46_status_wan2_if_t.gch",
    "pon_status": "pon_status_link_info_t.gch",
    "wifi24_status": "status_wlanm_info1_t.gch",
    "wifi5_status": "status_wlanm_info2_t.gch",
    "ethernet_status": "pon_status_lan_info_t.gch",
    "wan": "IPv46_net_wan2_conf_t.gch",
    "port_binding": "net_portbind_conf_t.gch",
    "wifi_common": "net_wlanm_off_t.gch",
    "wifi24": "net_wlanm_conf1_t.gch",
    "wifi24_ssid": "net_wlanm_essid1_t.gch",
    "wifi24_security": "net_wlanm_secrity1_t.gch",
    "wifi24_clients": "net_wlanm_assoc1_t.gch",
    "wifi24_wps": "net_wlanm_wps1_t.gch",
    "wifi5": "net_wlanm_conf2_t.gch",
    "wifi5_ssid": "net_wlanm_essid2_t.gch",
    "wifi5_security": "net_wlanm_secrity2_t.gch",
    "wifi5_clients": "net_wlanm_assoc2_t.gch",
    "wifi5_wps": "net_wlanm_wps2_t.gch",
    "lan": "net_dhcp_dynamic_t.gch",
    "pon": "pon_net_ponloid_t.gch",
    "firewall": "sec_firewall_conf_t.gch",
    "ip_filter": "sec_portfilter_conf_t.gch",
    "mac_filter": "sec_macfilter_conf_t.gch",
    "url_filter": "sec_url_filter_t.gch",
    "service_control": "sec_sc_t.gch",
    "alg": "sec_fw_alg_t.gch",
    "dmz": "app_dmz_conf_t.gch",
    "upnp": "app_upnp_conf_t.gch",
    "port_forward": "app_virtual_conf_t.gch",
    "sntp": "net_sntp_conf_t.gch",
    "tr069": "net_tr069_basic_t.gch",
    "users": "manager_aduser_conf_t.gch",
    "logs": "manager_log_conf_t.gch",
    "ipv6": "manager_ipv6_switch_t.gch",
}

F670L_EXPECTED_CONTROLS = {
    "wan": "#Frm_WANCName0",
    "wifi_common": "#Frm_Enable",
    "wifi24": "#Frm_RadioStatus",
    "wifi24_ssid": "#Frm_ESSID",
    "wifi24_security": "#Frm_Authentication",
    "wifi24_wps": "#Frm_WPSMode",
    "wifi5": "#Frm_RadioStatus",
    "wifi5_ssid": "#Frm_ESSID",
    "wifi5_security": "#Frm_Authentication",
    "wifi5_wps": "#Frm_WPSMode",
    "lan": "#Frm_BasicIPAddr",
    "pon": "#Frm_PonLoid",
    "firewall": "#Frm_level_low",
    "sntp": "#Frm_LocalTimeZoneandName",
    "tr069": "#Frm_URL",
}


def _normalized_label(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _first_value(pairs: dict[str, str], labels: tuple[str, ...]) -> str | None:
    normalized = {_normalized_label(key): value for key, value in pairs.items()}
    for label in labels:
        wanted = _normalized_label(label)
        for key, value in normalized.items():
            if key == wanted or wanted in key:
                clean = str(value).strip()
                if clean and clean not in {"-", "--", "N/A", "NULL"}:
                    return clean
    return None


def parse_zte_inventory_snapshot(snapshot: dict) -> dict:
    pairs = snapshot.get("pairs") or {}
    text = str(snapshot.get("text") or "")
    serial = _first_value(pairs, ("GPON Serial Number", "PON Serial Number", "Serial Number", "SN"))
    if not serial:
        serial = re.search(r"\b(?:SN\s*[:=]\s*)?([A-Z]{4}[0-9A-F]{8})\b", text, re.I)
        serial = serial.group(1) if serial else None
    normalized_serial = None
    if serial:
        try:
            normalized_serial = normalize_gpon_serial(serial)
        except ValueError:
            normalized_serial = None
    return {
        "identity": {
            "serial": normalized_serial,
            "serial_raw": serial.upper() if serial else None,
            "authentication_mode": "sn_password",
        },
        "device": {
            "model": _first_value(pairs, ("Model Name", "Product Name", "Model")) or "F670L",
            "description": _first_value(pairs, ("Device Description", "Description")),
            "hardware_version": _first_value(pairs, ("Hardware Version", "Hardware")),
            "software_version": _first_value(pairs, ("Software Version", "Firmware Version", "Software")),
            "firmware_release": _first_value(pairs, ("Build Time", "Release Time")),
            "manufacturer_info": "ZTE",
            "vendor_id": "ZTEG",
            "mac": _first_value(pairs, ("MAC Address", "Device MAC", "LAN MAC")),
            "registration_status": _first_value(pairs, ("PON State", "Registration Status", "GPON Status")),
            "ont_id": _first_value(pairs, ("ONU ID", "ONT ID")),
            "cpu_usage": _first_value(pairs, ("CPU Usage",)),
            "memory_usage": _first_value(pairs, ("Memory Usage",)),
            "runtime": _first_value(pairs, ("Up Time", "Uptime", "Running Time")),
            "system_time": _first_value(pairs, ("Current Time", "System Time")),
        },
        "optical": {
            "tx_power_dbm": _first_value(pairs, ("Optical Module Output Power", "TX Optical Power", "Transmit Power", "TX Power")),
            "rx_power_dbm": _first_value(pairs, ("Optical Module Input Power", "RX Optical Power", "Receive Power", "RX Power")),
            "voltage_mv": _first_value(pairs, ("Optical Module Supply Voltage", "Voltage")),
            "bias_ma": _first_value(pairs, ("Optical Transmitter Bias Current", "Bias Current", "Laser Bias")),
            "temperature_c": _first_value(pairs, ("Operating Temperature of the Optical Module", "Temperature")),
            "los": bool(re.search(r"\bLOS\b.*\b(?:on|active|yes)\b", text, re.I)),
            "module_vendor": None,
            "module_serial": None,
            "module_date_code": None,
            "tx_wavelength_nm": None,
            "rx_wavelength_nm": None,
            "max_distance_km": None,
            "signal_available": bool(_first_value(pairs, ("Optical Module Input Power", "RX Optical Power", "Receive Power", "RX Power"))),
        },
    }


class ZteF670L:
    """Browser controller certified for the ZTE F670L V7.1 web interface."""

    def __init__(
        self,
        device: DeviceSettings,
        backup_dir: Path,
        headless: bool = True,
        adapter_index: int | None = None,
    ):
        self.device = device
        self.backup_dir = backup_dir
        self.headless = headless
        self.adapter_index = adapter_index
        self._base_url: str | None = None

    def _bridge(self):
        if isinstance(self.device.host, IPv6Address):
            if not self.adapter_index:
                raise OnuProvisioningError(
                    "La ZTE F670L por IPv6 requiere seleccionar la tarjeta Ethernet",
                    code="ZTE_ADAPTER_REQUIRED",
                )
            return LinkLocalHttpBridge(self.device.host, self.adapter_index)
        return nullcontext(None)

    def check(self, emit: ProgressCallback) -> dict:
        emit("login", "running", "Abriendo el panel ZTE F670L")
        with self._bridge() as bridge, sync_playwright() as playwright:
            base_url = bridge.url if bridge else f"http://{self.device.host}"
            self._base_url = base_url
            browser = self._launch(playwright)
            context = browser.new_context()
            page = context.new_page()
            try:
                self._login(page, base_url)
                emit("login", "success", "Sesion tecnica iniciada en ZTE F670L")
                snapshot = self._collect_inventory(page)
                inventory = self._build_inventory(snapshot)
                identity = inventory["identity"]
                if identity.get("serial"):
                    emit("identity", "success", f"Serial GPON detectado: {identity['serial']}")
                else:
                    emit("identity", "warning", "Sesion valida; el firmware no mostro el serial en las vistas de estado")
                return {
                    "model": "F670L",
                    "host": str(self.device.host),
                    "authenticated": True,
                    "supports_provisioning": True,
                    **identity,
                    "inventory": inventory,
                }
            except Exception:
                self._capture_failure(page)
                raise
            finally:
                context.close()
                browser.close()

    def provision(self, request: ProvisionRequest, emit: ProgressCallback) -> dict:
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        changed = False
        backup_before: str | None = None
        with self._bridge() as bridge, sync_playwright() as playwright:
            base_url = bridge.url if bridge else f"http://{self.device.host}"
            self._base_url = base_url
            browser = self._launch(playwright)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            try:
                emit("login", "running", "Abriendo el panel ZTE F670L")
                self._login(page, base_url)
                emit("login", "success", "Sesion tecnica iniciada en ZTE F670L")

                # Preflight only needs identity and firmware. Reading every status
                # page here exhausts this firmware's short-lived form sessions
                # before the protected backup action is submitted.
                inventory_before = self._build_inventory(
                    self._collect_inventory(page, keys=("device", "pon_status"))
                )
                firmware = inventory_before.get("device", {}).get("software_version") or ""
                if not firmware.startswith("V7.1.10P1T1"):
                    raise OnuProvisioningError(
                        f"Firmware ZTE no certificado para escritura: {firmware or 'desconocido'}",
                        code="ZTE_FIRMWARE_NOT_CERTIFIED", retryable=False,
                    )
                identity = inventory_before["identity"]
                emit("identity", "success", f"Serial GPON confirmado: {identity.get('serial') or 'no informado'}")

                if request.create_backups:
                    emit("backup_before", "running", "Guardando configuracion antes de modificar")
                    backup_before = self._download_backup(page, "antes")
                    emit("backup_before", "success", "Respaldo previo guardado")

                self._validate_replacement_backup(request, backup_before)

                routed = request.service_mode == "router"
                wan_stage = "wan" if routed else "bridge"
                emit(wan_stage, "running", "Configurando WAN, VLAN e IP estatica" if routed else "Configurando bridge Ethernet y VLAN")
                # From this point a destructive replacement may already have
                # removed a profile even if WAN creation raises before returning.
                changed = changed or request.replace_conflicting_wan
                wan_result = self._configure_wan(page, request)
                changed = changed or wan_result.get("changed", False)
                emit(wan_stage, "success", f"Servicio {wan_result['name']} verificado en VLAN {request.wan.vlan_id}")

                emit("lan_ports", "running", "Vinculando LAN y WiFi a la WAN")
                binding_result = self._configure_port_binding(page, request, wan_result)
                changed = changed or binding_result.get("changed", False)
                emit("lan_ports", "success", "Puertos LAN y radios WiFi vinculados")

                tr069_result = None
                if routed and request.tr069.enabled:
                    emit("tr069", "running", "Configurando ACS TR-069")
                    tr069_result = self._configure_tr069(page, request, wan_result)
                    changed = changed or tr069_result.get("changed", False)
                    emit("tr069", "success", "ACS, credenciales e Inform periodico verificados")

                wifi_result = None
                if routed:
                    emit("wifi", "running", "Configurando WiFi 2.4 y 5 GHz con WPA2-AES")
                    wifi_result = self._configure_wifi(page, request)
                    changed = changed or wifi_result.get("changed", False)
                    emit("wifi", "success", f"WiFi dual {wifi_result['ssid']} verificado")

                time_result = None
                if routed:
                    emit("time", "running", "Configurando hora y servidores NTP")
                    time_result = self._configure_time(page)
                    changed = changed or time_result.get("changed", False)
                    emit("time", "success", "Zona horaria y NTP verificados")

                remote_result = None
                if routed and request.remote_access.enabled:
                    emit("remote", "running", "Creando acceso HTTP restringido")
                    remote_result = self._configure_remote_access(page, request, wan_result)
                    changed = changed or remote_result.get("changed", False)
                    emit("remote", "success", f"HTTP restringido a {request.remote_access.source}")

                emit("verify", "running", "Leyendo nuevamente toda la configuracion")
                verification = self._verify(page, request, wan_result)

                backup_after = None
                if request.create_backups:
                    emit("backup_after", "running", "Guardando configuracion final")
                    backup_after = self._download_backup(page, "configurada")
                    emit("backup_after", "success", "Respaldo final guardado")
                inventory_after = self._build_inventory(self._collect_inventory(page))
                emit("verify", "success", "WAN, WiFi, TR-069, NTP y ACL coinciden" if routed else "Bridge, VLAN y puertos LAN coinciden")
                return {
                    "model": "F670L", "host": str(request.device.host), **identity,
                    "wan": wan_result, "lan_ports": binding_result, "tr069": tr069_result,
                    "wifi": wifi_result, "time": time_result, "remote_access": remote_result,
                    "verification": verification, "inventory": inventory_after,
                    "backups": {"before": backup_before, "after": backup_after},
                }
            except Exception as exc:
                self._capture_failure(page)
                if changed and backup_before:
                    emit("rollback", "running", "Restaurando el respaldo previo por seguridad")
                    try:
                        self._restore_backup(page, base_url, Path(backup_before))
                        emit("rollback", "success", "Configuracion anterior restaurada")
                    except Exception as rollback_exc:
                        emit("rollback", "error", f"No se pudo restaurar automaticamente: {rollback_exc}")
                if isinstance(exc, OnuProvisioningError):
                    raise
                raise OnuProvisioningError(
                    f"La ZTE rechazo la configuracion: {str(exc).splitlines()[0]}",
                    code="ZTE_CONFIGURATION_FAILED",
                ) from exc
            finally:
                context.close()
                browser.close()

    def _launch(self, playwright):
        options = {
            "headless": self.headless,
            "args": ["--no-first-run", "--disable-default-apps", "--disable-gpu"],
        }
        executable_path = os.getenv("ONU_BROWSER_EXECUTABLE")
        if executable_path:
            return playwright.chromium.launch(executable_path=executable_path, **options)
        try:
            return playwright.chromium.launch(**options)
        except Exception:
            try:
                return playwright.chromium.launch(channel="msedge", **options)
            except Exception:
                return playwright.chromium.launch(channel="chrome", **options)

    def _login(self, page: Page, base_url: str) -> None:
        password = self.device.password.get_secret_value() if self.device.password else ""
        if not password:
            raise OnuProvisioningError(
                "Ingresa el usuario y la contrasena impresos en la etiqueta de la ZTE F670L",
                code="ZTE_CREDENTIALS_REQUIRED",
                retryable=False,
            )
        try:
            page.goto(base_url, wait_until="domcontentloaded", timeout=10_000)
            if page.locator("#Frm_Username").count() != 1 or page.locator("#Frm_Password").count() != 1:
                raise OnuProvisioningError(
                    "El panel detectado no corresponde al firmware ZTE F670L esperado",
                    code="ZTE_LOGIN_FORM_MISMATCH",
                    retryable=False,
                )
            page.locator("#Frm_Username").fill(self.device.username)
            page.locator("#Frm_Password").fill(password)
            page.locator("#LoginId").click(timeout=4_000)
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline:
                try:
                    body = page.locator("body").inner_text(timeout=1_500)
                except PlaywrightError:
                    page.wait_for_timeout(250)
                    continue
                if re.search(r"User information is error|username or password.*(?:error|incorrect|invalid)", body, re.I):
                    raise OnuProvisioningError(
                        "La ZTE F670L rechazo el usuario o la contrasena; usa los datos de su etiqueta",
                        code="ZTE_CREDENTIALS_REJECTED",
                        retryable=False,
                    )
                if page.locator("#Frm_Username").count() == 0 and not re.search(r"Please login to continue", body, re.I):
                    return
                page.wait_for_timeout(250)
        except PlaywrightTimeout as exc:
            raise OnuProvisioningError(
                "La ZTE F670L respondio, pero no completo el inicio de sesion",
                code="ZTE_LOGIN_TIMEOUT",
            ) from exc
        raise OnuProvisioningError(
            "La ZTE F670L no abandono la pantalla de acceso",
            code="ZTE_LOGIN_NOT_COMPLETED",
        )

    @staticmethod
    def _page_snapshot(page: Page) -> dict:
        frames = []
        for frame in page.frames:
            try:
                frames.append(frame.evaluate(
                    """() => {
                        const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
                        const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
                        const pairs = {};
                        const rows = [];
                        for (const row of document.querySelectorAll('tr')) {
                            const cells = Array.from(row.querySelectorAll('th,td')).map((cell) => clean(cell.textContent));
                            if (cells.length >= 2) rows.push(cells);
                            if (cells.length >= 2 && cells[0] && cells[1] && cells[0].length < 100) pairs[cells[0]] = cells[1];
                        }
                        for (const label of document.querySelectorAll('label')) {
                            const name = clean(label.textContent);
                            const id = label.htmlFor;
                            const control = id ? document.getElementById(id) : label.querySelector('input,select,textarea');
                            if (name && control && visible(control)) pairs[name] = clean(control.value);
                        }
                        const controls = {};
                        for (const control of document.querySelectorAll('input[id],select[id],textarea[id]')) {
                            if (!control.id || control.type === 'password') continue;
                            controls[control.id] = {
                                type: control.type || control.tagName.toLowerCase(),
                                value: clean(control.value),
                                checked: Boolean(control.checked),
                                disabled: Boolean(control.disabled),
                                selected: control.tagName === 'SELECT'
                                    ? Array.from(control.selectedOptions).map((option) => clean(option.textContent))
                                    : []
                            };
                        }
                        return {url: location.href, title: document.title, text: clean(document.body?.innerText), pairs, rows, controls};
                    }"""
                ))
            except PlaywrightError:
                continue
        pairs: dict[str, str] = {}
        texts = []
        for frame in frames:
            pairs.update(frame.get("pairs") or {})
            if frame.get("text"):
                texts.append(frame["text"])
        rows = []
        controls = {}
        for frame in frames:
            rows.extend(frame.get("rows") or [])
            controls.update(frame.get("controls") or {})
        return {"frames": frames, "pairs": pairs, "rows": rows, "controls": controls, "text": "\n".join(texts)}

    def _collect_inventory(
        self,
        page: Page,
        base_url: str | None = None,
        keys: tuple[str, ...] | None = None,
    ) -> dict:
        base_url = base_url or page.url.rsplit("/", 1)[0]
        pages = {}
        errors = {}
        selected_pages = (
            ((key, F670L_AUDIT_PAGES[key]) for key in keys)
            if keys is not None
            else F670L_AUDIT_PAGES.items()
        )
        for key, endpoint in selected_pages:
            expected = F670L_EXPECTED_CONTROLS.get(key)
            last_error = None
            for attempt in range(2):
                try:
                    # This V7 firmware invalidates the management route after a direct
                    # page read. Renewing the login keeps the next endpoint from returning 404.
                    self._login(page, base_url)
                    page.goto(
                        f"{base_url}/getpage.gch?pid=1002&nextpage={endpoint}",
                        wait_until="domcontentloaded",
                        timeout=7_000,
                    )
                    if expected:
                        page.locator(expected).wait_for(state="attached", timeout=2_500)
                    page.wait_for_timeout(350)
                    candidate = self._page_snapshot(page)
                    if expected and not (candidate.get("controls") or {}).get(expected.removeprefix("#")):
                        raise OnuProvisioningError(
                            f"La pagina {key} no termino de cargar sus controles",
                            code="ZTE_INVENTORY_PAGE_INCOMPLETE",
                        )
                    pages[key] = candidate
                    last_error = None
                    break
                except (PlaywrightError, OnuProvisioningError) as exc:
                    last_error = str(exc).splitlines()[0][:180]
                    if attempt == 0:
                        page.wait_for_timeout(250)
            if last_error:
                errors[key] = last_error
        return {"pages": pages, "errors": errors}

    @staticmethod
    def _endpoint(page: Page, endpoint: str) -> str:
        return f"{page.url.rsplit('/', 1)[0]}/getpage.gch?pid=1002&nextpage={endpoint}"

    def _open(self, page: Page, endpoint: str) -> None:
        base_url = self._base_url or page.url.rsplit("/", 1)[0]
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                # F670L V7 consumes the authenticated management route after a
                # direct page access. A fresh login is required for every module.
                self._login(page, base_url)
                response = page.goto(
                    f"{base_url}/getpage.gch?pid=1002&nextpage={endpoint}",
                    wait_until="domcontentloaded",
                    timeout=7_000,
                )
                page.wait_for_timeout(400)
                if page.locator("#Frm_Username").count():
                    raise OnuProvisioningError(
                        "La sesion ZTE vencio durante la configuracion",
                        code="ZTE_SESSION_EXPIRED",
                    )
                if response is not None and response.status >= 400:
                    raise OnuProvisioningError(
                        f"La ZTE devolvio HTTP {response.status} al abrir {endpoint}",
                        code="ZTE_PAGE_UNAVAILABLE",
                    )
                return
            except (PlaywrightError, OnuProvisioningError) as exc:
                last_error = exc
                if attempt == 0:
                    page.wait_for_timeout(250)
        if isinstance(last_error, OnuProvisioningError):
            raise last_error
        raise OnuProvisioningError(
            f"No se pudo abrir el modulo ZTE {endpoint}",
            code="ZTE_PAGE_UNAVAILABLE",
        ) from last_error

    @staticmethod
    def _control(page: Page, selector: str):
        control = page.locator(selector)
        if control.count() != 1:
            raise OnuProvisioningError(
                f"El firmware ZTE no mostro el control {selector}",
                code="ZTE_FORM_MISMATCH", retryable=False,
            )
        return control

    @classmethod
    def _fill(cls, page: Page, selector: str, value: str) -> bool:
        control = cls._control(page, selector)
        if control.input_value() == value:
            return False
        if control.is_disabled():
            current = control.input_value()
            if current != value:
                raise OnuProvisioningError(
                    f"El campo {selector} esta bloqueado con un valor incompatible",
                    code="ZTE_FIELD_LOCKED", retryable=False,
                )
            return False
        control.fill(value, timeout=2_000)
        if control.input_value() != value:
            raise OnuProvisioningError(f"La ZTE no acepto el valor de {selector}", code="ZTE_VALUE_REJECTED")
        return True

    @classmethod
    def _check(cls, page: Page, selector: str, desired: bool) -> bool:
        control = cls._control(page, selector)
        if control.is_checked() == desired:
            return False
        if control.is_disabled():
            if control.is_checked() != desired:
                raise OnuProvisioningError(
                    f"El campo {selector} esta bloqueado con un valor incompatible",
                    code="ZTE_FIELD_LOCKED", retryable=False,
                )
            return False
        control.set_checked(desired, timeout=2_000)
        if control.is_checked() != desired:
            raise OnuProvisioningError(f"La ZTE no acepto el valor de {selector}", code="ZTE_VALUE_REJECTED")
        return True

    @classmethod
    def _select(cls, page: Page, selector: str, value: str) -> bool:
        control = cls._control(page, selector)
        if control.input_value() == value:
            return False
        if control.is_disabled():
            if control.input_value() != value:
                raise OnuProvisioningError(
                    f"El campo {selector} esta bloqueado con un valor incompatible",
                    code="ZTE_FIELD_LOCKED", retryable=False,
                )
            return False
        try:
            control.select_option(value=value, timeout=2_000)
        except PlaywrightError as exc:
            raise OnuProvisioningError(
                f"El firmware no ofrece la opcion {value} en {selector}",
                code="ZTE_OPTION_UNAVAILABLE", retryable=False,
            ) from exc
        if control.input_value() != value:
            raise OnuProvisioningError(f"La ZTE no acepto el valor de {selector}", code="ZTE_VALUE_REJECTED")
        return True

    @staticmethod
    def _is_transient_navigation_error(exc: Exception) -> bool:
        message = str(exc).lower()
        return any(
            fragment in message
            for fragment in (
                "execution context was destroyed",
                "most likely because of a navigation",
                "cannot find context with specified id",
                "frame was detached",
            )
        )

    @classmethod
    def _settle_after_navigation(cls, page: Page) -> None:
        try:
            page.wait_for_load_state("domcontentloaded", timeout=2_500)
        except PlaywrightTimeout:
            pass
        except PlaywrightError as exc:
            if not cls._is_transient_navigation_error(exc):
                raise
        page.wait_for_timeout(180)

    @classmethod
    def _submit_function(cls, page: Page, function_name: str, *, timeout: int = 8_000) -> None:
        if not page.evaluate(f"() => typeof globalThis[{function_name!r}] === 'function'"):
            raise OnuProvisioningError(
                f"El firmware ZTE no expone {function_name}",
                code="ZTE_FORM_MISMATCH", retryable=False,
            )
        navigation_started = False
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=timeout):
                try:
                    page.evaluate(f"() => globalThis[{function_name!r}]()")
                except PlaywrightError as exc:
                    if not cls._is_transient_navigation_error(exc):
                        raise
                    navigation_started = True
        except PlaywrightTimeout:
            if not navigation_started and page.locator("#fSubmit").count():
                raise OnuProvisioningError("La ZTE no confirmo el cambio", code="ZTE_SUBMIT_TIMEOUT")
        except PlaywrightError as exc:
            if not cls._is_transient_navigation_error(exc):
                raise
            navigation_started = True
        if navigation_started:
            cls._settle_after_navigation(page)
        else:
            page.wait_for_timeout(180)
        try:
            error = page.locator("#IF_ERRORSTR").input_value(timeout=800)
            if error and error not in {"SUCC", "NULL"}:
                if "page has expired" in error.lower():
                    return
                raise OnuProvisioningError(f"La ZTE devolvio: {error}", code="ZTE_DEVICE_REJECTED")
        except PlaywrightError:
            pass

    @classmethod
    def _select_wan_option(cls, page: Page, value: str) -> None:
        selector = cls._control(page, "#Frm_WANCName0")
        if selector.input_value() == value:
            return
        navigation_started = False
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=4_000):
                try:
                    selector.select_option(value=value, timeout=2_000)
                except PlaywrightError as exc:
                    if not cls._is_transient_navigation_error(exc):
                        raise
                    navigation_started = True
        except PlaywrightTimeout:
            pass
        except PlaywrightError as exc:
            if not cls._is_transient_navigation_error(exc):
                raise
            navigation_started = True
        if navigation_started:
            cls._settle_after_navigation(page)
        else:
            page.wait_for_timeout(120)
        refreshed = cls._control(page, "#Frm_WANCName0")
        if refreshed.input_value() != value:
            raise OnuProvisioningError(
                "La ZTE no mantuvo la WAN seleccionada despues de recargar",
                code="ZTE_WAN_SELECTION_FAILED",
            )

    @staticmethod
    def _wan_name(request: ProvisionRequest) -> str:
        if request.service_mode == "bridge":
            return f"ISPMax-Bridge-{request.wan.vlan_id}"[:32]
        suffix = str(request.wan.ip_address).split(".")[-1]
        return f"ISPMax-{suffix}"[:32]

    @staticmethod
    def _validate_replacement_backup(request: ProvisionRequest, backup_before: str | None) -> None:
        if request.replace_conflicting_wan and not backup_before:
            raise OnuProvisioningError(
                "Limpiar todas las WAN requiere guardar primero un respaldo de la ONU",
                code="ZTE_WAN_REPLACE_REQUIRES_BACKUP",
                retryable=False,
            )

    def _delete_all_wans(self, page: Page) -> list[str]:
        deleted: list[str] = []
        for _attempt in range(32):
            self._open(page, F670L_AUDIT_PAGES["wan"])
            selector = self._control(page, "#Frm_WANCName0")
            options = selector.locator("option")
            existing = [
                {
                    "id": options.nth(index).get_attribute("value"),
                    "name": options.nth(index).inner_text().strip(),
                }
                for index in range(options.count())
                if options.nth(index).get_attribute("value") != "-1"
            ]
            if not existing:
                return deleted
            target = existing[0]
            self._select_wan_option(page, target["id"])
            self._submit_function(page, "pageDel")
            self._open(page, F670L_AUDIT_PAGES["wan"])
            refreshed = self._control(page, "#Frm_WANCName0").locator("option")
            remaining_ids = {
                refreshed.nth(index).get_attribute("value")
                for index in range(refreshed.count())
                if refreshed.nth(index).get_attribute("value") != "-1"
            }
            if target["id"] in remaining_ids:
                raise OnuProvisioningError(
                    f"La WAN {target['name']} sigue presente despues de eliminarla",
                    code="ZTE_WAN_DELETE_VERIFY_FAILED",
                )
            deleted.append(target["name"])
        raise OnuProvisioningError(
            "La ONU conserva mas perfiles WAN de los que el agente puede limpiar con seguridad",
            code="ZTE_WAN_DELETE_LIMIT",
            retryable=False,
        )

    def _configure_wan(self, page: Page, request: ProvisionRequest) -> dict:
        self._open(page, F670L_AUDIT_PAGES["wan"])
        selector = self._control(page, "#Frm_WANCName0")
        options = selector.locator("option")
        existing = []
        for index in range(options.count()):
            option = options.nth(index)
            if option.get_attribute("value") != "-1":
                existing.append({"id": option.get_attribute("value"), "name": option.inner_text().strip()})

        deleted_wans: list[str] = []
        if request.replace_conflicting_wan and existing:
            deleted_wans = self._delete_all_wans(page)
            self._open(page, F670L_AUDIT_PAGES["wan"])
            selector = self._control(page, "#Frm_WANCName0")
            existing = []

        compatible = None
        conflict = None
        for item in existing:
            self._select_wan_option(page, item["id"])
            selector = self._control(page, "#Frm_WANCName0")
            vlan = self._control(page, "#Frm_VLANID").input_value()
            service = self._control(page, "#Frm_ServList").input_value()
            address = self._control(page, "#Frm_IPAddress").input_value()
            mode = self._control(page, "#Frm_mode").input_value()
            if vlan == str(request.wan.vlan_id):
                expected_service = {"1", "3"} if request.service_mode == "bridge" or not request.tr069.enabled else {"3"}
                expected_address = request.service_mode == "bridge" or address == str(request.wan.ip_address)
                expected_mode = mode.lower() == ("bridge" if request.service_mode == "bridge" else "route")
                if service in expected_service and expected_address and expected_mode:
                    compatible = item
                    break
                conflict = item

        if compatible:
            return {"name": compatible["name"], "id": compatible["id"], "changed": False, "reused": True, "deleted_wans": deleted_wans, "service_mode": request.service_mode}
        if conflict and not request.replace_conflicting_wan:
            raise OnuProvisioningError(
                f"La VLAN {request.wan.vlan_id} ya pertenece a {conflict['name']} y no coincide con el expediente. "
                "Confirma reemplazar la WAN para continuar.",
                code="ZTE_WAN_CONFLICT", retryable=False,
            )
        if conflict:
            self._select_wan_option(page, conflict["id"])
            self._submit_function(page, "pageDel")
            self._open(page, F670L_AUDIT_PAGES["wan"])
            remaining_values = {
                self._control(page, "#Frm_WANCName0").locator("option").nth(index).get_attribute("value")
                for index in range(self._control(page, "#Frm_WANCName0").locator("option").count())
            }
            if conflict["id"] in remaining_values:
                raise OnuProvisioningError(
                    "La WAN anterior sigue presente despues de eliminarla",
                    code="ZTE_WAN_DELETE_VERIFY_FAILED",
                )

        self._select(page, "#Frm_WANCName0", "-1")
        self._fill(page, "#Frm_WANCName1", self._wan_name(request))
        self._check(page, "#Frm_WBDMode", True)
        self._fill(page, "#Frm_VLANID", str(request.wan.vlan_id))
        self._select(page, "#Frm_Priority", str(request.wan.priority))
        self._select(page, "#Frm_mode", "Route" if request.service_mode == "router" else "Bridge")
        self._select(page, "#Frm_ServList", "3" if request.service_mode == "router" and request.tr069.enabled else "1")
        self._fill(page, "#Frm_MTU", str(request.wan.mtu))
        self._select(page, "#Frm_linkMode", "IP")
        self._select(page, "#Frm_IpMode", "IPv4")
        if request.service_mode == "router":
            self._select(page, "#Frm_WANCType", "Static")
            self._check(page, "#Frm_IsNAT", request.wan.nat_enabled)
            self._fill(page, "#Frm_IPAddress", str(request.wan.ip_address))
            self._fill(page, "#Frm_SubnetMask", str(request.wan.subnet_mask))
            self._fill(page, "#Frm_GateWay", str(request.wan.gateway))
            self._fill(page, "#Frm_DNS1", str(request.wan.primary_dns))
            self._fill(page, "#Frm_DNS2", str(request.wan.secondary_dns or ""))
            self._fill(page, "#Frm_DNS3", "")
        else:
            self._check(page, "#Frm_IsNAT", False)
        self._submit_function(page, "pageAdd")

        self._open(page, F670L_AUDIT_PAGES["wan"])
        selector = self._control(page, "#Frm_WANCName0")
        for index in range(selector.locator("option").count()):
            option = selector.locator("option").nth(index)
            if option.inner_text().strip() == self._wan_name(request):
                wan_id = option.get_attribute("value")
                self._select_wan_option(page, wan_id)
                if self._control(page, "#Frm_VLANID").input_value() != str(request.wan.vlan_id):
                    break
                return {
                    "name": self._wan_name(request),
                    "id": wan_id,
                    "changed": True,
                    "reused": False,
                    "deleted_wans": deleted_wans,
                    "service_mode": request.service_mode,
                }
        raise OnuProvisioningError("La WAN no aparecio despues de crearla", code="ZTE_WAN_VERIFY_FAILED")

    def _configure_port_binding(self, page: Page, request: ProvisionRequest, wan: dict) -> dict:
        self._open(page, F670L_AUDIT_PAGES["port_binding"])
        wan_select = self._control(page, "#Frm_DefRTInterface")
        values = [wan_select.locator("option").nth(i).get_attribute("value") for i in range(wan_select.locator("option").count())]
        if wan["id"] not in values:
            raise OnuProvisioningError("La WAN no esta disponible para vincular puertos", code="ZTE_BINDING_WAN_MISSING")
        self._select(page, "#Frm_DefRTInterface", wan["id"])
        requested = {f"IGD.LD1.ETH{port}" for port in request.wan.bind_lan_ports}
        if request.service_mode == "router" and request.wan.bind_ssid1:
            requested.update({"IGD.LD1.WLAN1", "IGD.LD1.WLAN5"})
        changed = False
        for index in range(12):
            control = page.locator(f"#FRM_{index}")
            if not control.count():
                continue
            desired = control.get_attribute("value") in requested
            changed = changed or control.is_checked() != desired
            control.set_checked(desired)
        if changed:
            self._submit_function(page, "pageSubmit")
        return {"wan": wan["name"], "ports": sorted(requested), "changed": changed}

    def _configure_tr069(self, page: Page, request: ProvisionRequest, wan: dict) -> dict:
        self._open(page, F670L_AUDIT_PAGES["tr069"])
        changed = self._select(page, "#Frm_DefaultWan", wan["id"])
        changed = self._fill(page, "#Frm_URL", request.tr069.acs_url) or changed
        changed = self._fill(page, "#Frm_UserName", request.tr069.username) or changed
        changed = self._fill(page, "#Frm_UserPassword", request.tr069.password.get_secret_value()) or changed
        changed = self._fill(page, "#Frm_ConnectionRequestUsername", request.tr069.connection_request_username) or changed
        changed = self._fill(page, "#Frm_ConnectionRequestPassword", request.tr069.connection_request_password.get_secret_value()) or changed
        changed = self._check(page, "#Frm_PeriodicInformEnable", True) or changed
        changed = self._fill(page, "#Frm_PeriodicInformInterval", str(request.tr069.periodic_inform_interval)) or changed
        changed = self._check(page, "#Frm_SupportCertAuth", False) or changed
        if changed:
            self._submit_function(page, "pageSubmit")
        return {"acs_url": request.tr069.acs_url, "wan": wan["name"], "interval": request.tr069.periodic_inform_interval, "changed": changed}

    def _configure_wifi(self, page: Page, request: ProvisionRequest) -> dict:
        password = request.wifi.password.get_secret_value()
        changed = False
        for config_key, ssid_key, security_key, wps_key, ssid in (
            ("wifi24", "wifi24_ssid", "wifi24_security", "wifi24_wps", request.wifi.ssid),
            ("wifi5", "wifi5_ssid", "wifi5_security", "wifi5_wps", f"{request.wifi.ssid}-5G"[:32]),
        ):
            self._open(page, F670L_AUDIT_PAGES[config_key])
            page_changed = self._check(page, "#Frm_RadioStatus", request.wifi.enabled)
            page_changed = self._select(page, "#Frm_QosType", "WMM" if request.wifi.wmm_enabled else "Disabled") or page_changed
            if page_changed:
                self._submit_function(page, "pageSubmit")
                changed = True

            self._open(page, F670L_AUDIT_PAGES[ssid_key])
            page_changed = self._check(page, "#Frm_Enable", request.wifi.enabled)
            page_changed = self._check(page, "#Frm_ESSIDHideEnable", not request.wifi.broadcast) or page_changed
            page_changed = self._check(page, "#Frm_VapIsolationEnable", False) or page_changed
            page_changed = self._fill(page, "#Frm_MaxUserNum", str(request.wifi.max_clients)) or page_changed
            page_changed = self._fill(page, "#Frm_ESSID", ssid) or page_changed
            if page_changed:
                self._submit_function(page, "pageSubmit")
                changed = True

            self._open(page, F670L_AUDIT_PAGES[security_key])
            page_changed = self._select(page, "#Frm_Authentication", "WPA2-PSK")
            page_changed = self._select(page, "#Frm_WPAEncryptType", "AESEncryption") or page_changed
            page_changed = self._fill(page, "#Frm_KeyPassphrase", password) or page_changed
            if page_changed:
                self._submit_function(page, "submitPage")
                changed = True

            self._open(page, F670L_AUDIT_PAGES[wps_key])
            if self._control(page, "#Frm_WPSMode").input_value() != ("PBC" if request.wifi.wps_enabled else "Disabled"):
                self._select(page, "#Frm_WPSMode", "PBC" if request.wifi.wps_enabled else "Disabled")
                # This firmware applies the WPS selector immediately via onchange.
                page.wait_for_timeout(150)
                changed = True
        return {"ssid": request.wifi.ssid, "ssid_5g": f"{request.wifi.ssid}-5G"[:32], "security": "WPA2-PSK/AES", "changed": changed}

    def _configure_time(self, page: Page) -> dict:
        self._open(page, F670L_AUDIT_PAGES["sntp"])
        changed = self._select(page, "#Frm_LocalTimeZoneandName", "38")
        changed = self._fill(page, "#Frm_NtpServer1", "pool.ntp.org") or changed
        changed = self._fill(page, "#Frm_NtpServer2", "time.google.com") or changed
        changed = self._fill(page, "#Frm_PollTimeInterval", "86400") or changed
        if changed:
            self._submit_function(page, "pageSubmit")
        return {"timezone": "GMT-04:00", "ntp": ["pool.ntp.org", "time.google.com"], "changed": changed}

    def _configure_remote_access(self, page: Page, request: ProvisionRequest, wan: dict) -> dict:
        self._open(page, F670L_AUDIT_PAGES["service_control"])
        snapshot = self._page_snapshot(page)
        source = IPv4Network(request.remote_access.source, strict=False)
        if self._remote_snapshot_matches(snapshot, wan["name"], source):
            return {"source": request.remote_access.source, "service": "HTTP", "changed": False}
        self._select(page, "#Frm_SCIPMode", "0")
        self._check(page, "#Frm_Enable", True)
        self._select(page, "#Frm_INCViewName", wan["id"])
        self._fill(page, "#Frm_MinSrcIp", str(source.network_address))
        self._fill(page, "#Frm_MaxSrcIp", str(source.broadcast_address))
        self._select(page, "#Frm_Mode", "1")
        self._check(page, "#ServiceType0", True)
        for selector in ("#ServiceType1", "#ServiceType3", "#ServiceType4"):
            self._check(page, selector, False)
        try:
            self._submit_function(page, "Add")
        except OnuProvisioningError as exc:
            # F670L V7 may apply Service Control and then return FAIL or an
            # expired-form response. Never assume success: the fresh read below
            # must prove the exact rule.
            if exc.code != "ZTE_DEVICE_REJECTED":
                raise
        self._open(page, F670L_AUDIT_PAGES["service_control"])
        verified_snapshot = self._page_snapshot(page)
        if not self._remote_snapshot_matches(verified_snapshot, wan["name"], source):
            raise OnuProvisioningError(
                "La regla HTTP no aparecio en la lectura posterior",
                code="ZTE_REMOTE_VERIFY_FAILED",
            )
        return {"source": request.remote_access.source, "service": "HTTP", "changed": True}

    @staticmethod
    def _remote_rule_matches(text: str, wan_name: str, source: IPv4Network) -> bool:
        # The V7 table truncates long WAN labels (for example ISPMax-166 is
        # rendered as ISPMax-16...). The exact IP range, Permit mode and HTTP
        # service uniquely identify the restricted management rule.
        required = (
            str(source.network_address),
            str(source.broadcast_address),
            "Permit",
            "HTTP",
        )
        lowered = text.lower()
        return all(value.lower() in lowered for value in required)

    @classmethod
    def _remote_snapshot_matches(cls, snapshot: dict, wan_name: str, source: IPv4Network) -> bool:
        controls = snapshot.get("controls") or {}
        for index in range(64):
            def value(name: str) -> str:
                return str((controls.get(f"{name}{index}") or {}).get("value") or "")

            if all((
                value("Enable") == "1",
                value("INCName") == wan_name,
                value("MinSrcIp") == str(source.network_address),
                value("MaxSrcIp") == str(source.broadcast_address),
                value("FilterTarget") == "1",
                value("Servise") == "1",
            )):
                return True
        row_text = "\n".join(" ".join(str(cell) for cell in row) for row in snapshot.get("rows", []))
        combined = f"{snapshot.get('text', '')}\n{row_text}"
        return cls._remote_rule_matches(combined, wan_name, source)

    def _verify(self, page: Page, request: ProvisionRequest, wan: dict) -> dict:
        self._open(page, F670L_AUDIT_PAGES["wan"])
        wan_select = self._control(page, "#Frm_WANCName0")
        if wan_select.input_value() != wan["id"]:
            self._select_wan_option(page, wan["id"])
        if request.service_mode == "bridge":
            wan_ok = all((
                self._control(page, "#Frm_VLANID").input_value() == str(request.wan.vlan_id),
                self._control(page, "#Frm_mode").input_value().lower() == "bridge",
                self._control(page, "#Frm_ServList").input_value() in {"1", "3"},
                not self._control(page, "#Frm_IsNAT").is_checked(),
            ))
            if not wan_ok:
                raise OnuProvisioningError("La lectura posterior no confirma el perfil Bridge", code="ZTE_BRIDGE_VERIFY_FAILED")
            return {"bridge": True, "vlan": True, "lan_ports": True, "ip_host_absent": True}
        wan_ok = all((
            self._control(page, "#Frm_VLANID").input_value() == str(request.wan.vlan_id),
            self._control(page, "#Frm_IPAddress").input_value() == str(request.wan.ip_address),
            self._control(page, "#Frm_GateWay").input_value() == str(request.wan.gateway),
            self._control(page, "#Frm_ServList").input_value() == ("3" if request.tr069.enabled else "1"),
        ))
        wifi_ok = True
        for key, expected in (("wifi24_ssid", request.wifi.ssid), ("wifi5_ssid", f"{request.wifi.ssid}-5G"[:32])):
            self._open(page, F670L_AUDIT_PAGES[key])
            wifi_ok = wifi_ok and self._control(page, "#Frm_ESSID").input_value() == expected
        tr069_ok = True
        if request.tr069.enabled:
            self._open(page, F670L_AUDIT_PAGES["tr069"])
            tr069_ok = all((
                self._control(page, "#Frm_URL").input_value() == request.tr069.acs_url,
                self._control(page, "#Frm_DefaultWan").input_value() == wan["id"],
                self._control(page, "#Frm_PeriodicInformInterval").input_value() == str(request.tr069.periodic_inform_interval),
            ))
        self._open(page, F670L_AUDIT_PAGES["sntp"])
        time_ok = self._control(page, "#Frm_LocalTimeZoneandName").input_value() == "38"
        remote_ok = True
        if request.remote_access.enabled:
            self._open(page, F670L_AUDIT_PAGES["service_control"])
            source = IPv4Network(request.remote_access.source, strict=False)
            remote_ok = self._remote_snapshot_matches(self._page_snapshot(page), wan["name"], source)
        if not all((wan_ok, wifi_ok, tr069_ok, time_ok, remote_ok)):
            raise OnuProvisioningError("La lectura posterior no coincide con lo solicitado", code="ZTE_VERIFY_FAILED")
        return {"wan": wan_ok, "wifi": wifi_ok, "tr069": tr069_ok, "time": time_ok, "remote_access": remote_ok}

    def _download_backup(self, page: Page, suffix: str) -> str:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        last_error: PlaywrightError | None = None
        for attempt in range(2):
            self._open(page, "manager_dev_config_t.gch")
            try:
                with page.expect_download(timeout=10_000) as info:
                    page.locator("#download").click(timeout=2_000)
                download = info.value
                extension = Path(download.suggested_filename).suffix or ".bin"
                destination = self.backup_dir / f"F670L-{stamp}-{suffix}{extension}"
                download.save_as(destination)
                if not destination.exists() or destination.stat().st_size == 0:
                    raise OnuProvisioningError("La ZTE entrego un respaldo vacio", code="ZTE_BACKUP_EMPTY")
                return str(destination.resolve())
            except PlaywrightError as exc:
                last_error = exc
                if attempt == 0:
                    page.wait_for_timeout(500)
        raise OnuProvisioningError("La ZTE no entrego el respaldo", code="ZTE_BACKUP_FAILED") from last_error

    def _restore_backup(self, page: Page, base_url: str, backup: Path) -> None:
        if not backup.exists():
            raise OnuProvisioningError("El respaldo de restauracion no existe", code="ZTE_BACKUP_MISSING")
        self._base_url = base_url
        self._open(page, "manager_dev_config_t.gch")
        upload = page.locator("#ConfigUpload")
        try:
            upload.wait_for(state="attached", timeout=3_000)
            upload.set_input_files(str(backup), timeout=3_000)
        except PlaywrightError as exc:
            raise OnuProvisioningError(
                "La pagina de restauracion ZTE no mostro el selector de respaldo",
                code="ZTE_RESTORE_FORM_MISMATCH",
            ) from exc
        self._submit_function(page, "msgCallback", timeout=5_000)

    @staticmethod
    def _open_path(page: Page, labels: tuple[str, ...]) -> bool:
        for label in labels:
            clicked = False
            for frame in page.frames:
                try:
                    candidates = frame.get_by_text(label, exact=True)
                    for index in range(candidates.count()):
                        candidate = candidates.nth(index)
                        if candidate.is_visible() and candidate.is_enabled():
                            candidate.click(timeout=2_000)
                            clicked = True
                            break
                except PlaywrightError:
                    continue
                if clicked:
                    break
            if not clicked:
                return False
            page.wait_for_timeout(250)
        return True

    @staticmethod
    def _build_inventory(snapshot: dict) -> dict:
        pages = snapshot.get("pages") or {}
        if not pages:
            parsed = parse_zte_inventory_snapshot(snapshot)
            return {
                "collected_at": datetime.now(timezone.utc).isoformat(),
                "source": "onu_local_read_only",
                **parsed,
                "wan": [],
                "ethernet": {"mac": parsed["device"].get("mac"), "ports": []},
                "wifi": {"radios": [], "clients": []},
                "remote_access": {"rules": []},
                "errors": {
                    "wan": "Pendiente de calibrar con una sesion tecnica valida",
                    "wifi": "Pendiente de calibrar con una sesion tecnica valida",
                    "remote_access": "Pendiente de calibrar con una sesion tecnica valida",
                },
            }

        device_snapshot = pages.get("device") or {}
        pon_snapshot = pages.get("pon_status") or {}
        parsed = parse_zte_inventory_snapshot({
            "pairs": {**(device_snapshot.get("pairs") or {}), **(pon_snapshot.get("pairs") or {})},
            "text": f"{device_snapshot.get('text', '')}\n{pon_snapshot.get('text', '')}",
        })

        def control(page_key: str, control_id: str, field: str = "value", default=None):
            return (((pages.get(page_key) or {}).get("controls") or {}).get(control_id) or {}).get(field, default)

        def pair(page_key: str, labels: tuple[str, ...]):
            return _first_value((pages.get(page_key) or {}).get("pairs") or {}, labels)

        wan = [{
            "name": control("wan_status", "TextWANCName0"),
            "type": control("wan_status", "TextIPMode0"),
            "ip_version": control("wan_status", "TextIPIpMode0"),
            "nat": control("wan_status", "TextIPIsNAT0"),
            "address": control("wan_status", "TextIPAddress0"),
            "dns": control("wan_status", "TextIPDNS0"),
            "gateway": control("wan_status", "TextIPGateWay0"),
            "status": control("wan_status", "TextIPConnStatus0"),
            "disconnect_reason": control("wan_status", "TextIPConnError0"),
            "mac": control("wan_status", "TextIPWorkIFMac0"),
        }]

        ethernet_ports = []
        ethernet_text = (pages.get("ethernet_status") or {}).get("text") or ""
        for match in re.finditer(
            r"Ethernet Port\s+(LAN\d).*?Status\s+(\S+).*?Speed\s+(\S+).*?Mode\s+(\S+).*?"
            r"Packets Received/Bytes Received\s+([^\s]+).*?Packets Sent/Bytes Sent\s+([^\s]+).*?Error Frames\s+(\d+)",
            ethernet_text,
            re.I | re.S,
        ):
            ethernet_ports.append({
                "port": match.group(1), "status": match.group(2), "speed": match.group(3),
                "duplex": match.group(4), "received": match.group(5), "sent": match.group(6),
                "errors": int(match.group(7)),
            })

        radios = []
        for band, status_key, config_key, ssid_key, security_key in (
            ("2.4GHz", "wifi24_status", "wifi24", "wifi24_ssid", "wifi24_security"),
            ("5GHz", "wifi5_status", "wifi5", "wifi5_ssid", "wifi5_security"),
        ):
            radios.append({
                "band": band,
                "enabled": control(config_key, "Frm_RadioStatus", "checked", False),
                "ssid_enabled": control(ssid_key, "Frm_Enable", "checked", False),
                "ssid": control(ssid_key, "Frm_ESSID"),
                "hidden": control(ssid_key, "Frm_ESSIDHideEnable", "checked", False),
                "isolation": control(ssid_key, "Frm_VapIsolationEnable", "checked", False),
                "max_clients": control(ssid_key, "Frm_MaxUserNum"),
                "channel": control(config_key, "Frm_Channel"),
                "bandwidth": control(config_key, "Frm_BandWidth", "selected", []),
                "standard": control(config_key, "Frm_Standard", "selected", []),
                "country": control(config_key, "Frm_CountryCode", "selected", []),
                "tx_power": control(config_key, "Frm_TxPower", "selected", []),
                "wmm": "WMM" in control(config_key, "Frm_QosType", "selected", []),
                "mu_mimo": control(config_key, "Frm_MUMIMO", "checked", False),
                "authentication": control(security_key, "Frm_Authentication", "selected", []),
                "encryption": control(security_key, "Frm_WPAEncryptType", "selected", []),
                "mac": pair(status_key, ("MAC Address",)),
            })

        tr069_url = control("tr069", "Frm_URL")
        tr069 = {
            "configured": bool(tr069_url and "0.0.0.0" not in tr069_url),
            "acs_url": tr069_url,
            "wan": control("tr069", "Frm_DefaultWan", "selected", []),
            "periodic_inform": control("tr069", "Frm_PeriodicInformEnable", "checked", False),
            "periodic_interval": control("tr069", "Frm_PeriodicInformInterval"),
            "certificate_auth": control("tr069", "Frm_SupportCertAuth", "checked", False),
        }

        def has_configured_rows(page_key: str) -> bool:
            snapshot = pages.get(page_key) or {}
            controls = snapshot.get("controls") or {}
            if page_key == "service_control":
                return any(
                    str((controls.get(f"Enable{index}") or {}).get("value") or "") == "1"
                    and bool((controls.get(f"INCName{index}") or {}).get("value"))
                    and bool((controls.get(f"MinSrcIp{index}") or {}).get("value"))
                    and bool((controls.get(f"Servise{index}") or {}).get("value"))
                    for index in range(64)
                )
            text = snapshot.get("text") or ""
            if not text or "There is no data" in text:
                return False
            rows = snapshot.get("rows") or []
            ignored = {"add", "modify", "cancel", "enable", "service", "mode"}
            return any(
                len(row) >= 2
                and any(cell.strip().lower() not in ignored for cell in row)
                and any(re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b|\bHTTP\b|\bPermit\b", cell, re.I) for cell in row)
                for row in rows
            )

        security = {
            "anti_hacking": control("firewall", "Frm_IsProtect", "checked", False),
            "firewall_level": next((level for level in ("off", "low", "medium", "high") if control("firewall", f"Frm_level_{level}", "checked", False)), None),
            "ip_filter_rules": has_configured_rows("ip_filter"),
            "mac_filter_rules": has_configured_rows("mac_filter"),
            "url_filter_rules": has_configured_rows("url_filter"),
            "remote_access_rules": has_configured_rows("service_control"),
            "dmz_enabled": control("dmz", "Frm_Enable", "checked", False),
            "upnp_enabled": control("upnp", "Frm_EnableUPnPIGD", "checked", False),
        }

        return {
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "source": "onu_local_read_only",
            **parsed,
            "wan": wan,
            "ethernet": {"mac": wan[0].get("mac"), "ports": ethernet_ports},
            "wifi": {"radios": radios, "clients": []},
            "lan": {
                "address": control("lan", "Frm_BasicIPAddr"),
                "subnet_mask": control("lan", "Frm_SubnetMask"),
                "dhcp_enabled": control("lan", "Frm_ServerEnable", "checked", False),
                "dhcp_start": control("lan", "Frm_MinAddress"),
                "dhcp_end": control("lan", "Frm_MaxAddress"),
            },
            "pon": {"loid_configured": bool(control("pon", "Frm_PonLoid"))},
            "tr069": tr069,
            "security": security,
            "time": {
                "current": pair("sntp", ("Current Date and Time",)),
                "timezone": control("sntp", "Frm_LocalTimeZoneandName", "selected", []),
                "ntp1": control("sntp", "Frm_NtpServer1"),
                "ntp2": control("sntp", "Frm_NtpServer2"),
            },
            "remote_access": {"rules": [], "configured": security["remote_access_rules"]},
            "errors": snapshot.get("errors") or {},
        }

    def _capture_failure(self, page: Page) -> None:
        try:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            page.screenshot(path=self.backup_dir / f"F670L-{stamp}-error.png", full_page=True)
        except Exception:
            pass
