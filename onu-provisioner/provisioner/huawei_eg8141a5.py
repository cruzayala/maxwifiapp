from __future__ import annotations

import re
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Frame, Page, TimeoutError as PlaywrightTimeout, sync_playwright

from .models import DeviceSettings, ProvisionRequest
from .identity import normalize_gpon_serial


class OnuProvisioningError(RuntimeError):
    def __init__(self, message: str, *, code: str = "ONU_PROVISIONING_ERROR", retryable: bool = True):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


ProgressCallback = Callable[[str, str, str], None]


class HuaweiEg8141A5:
    """Browser-driven controller for the Huawei/Novatech EG8141A5 firmware."""

    def __init__(self, device: DeviceSettings, backup_dir: Path, headless: bool = True):
        self.device = device
        self.base_url = f"http://{device.host}"
        self.backup_dir = backup_dir
        self.headless = headless
        self.dialogs: list[str] = []
        self._configured_wan_name: str | None = None
        self._configured_wan_service: str | None = None

    def check(self, emit: ProgressCallback) -> dict:
        emit("login", "running", "Abriendo la administracion de la ONU")
        with sync_playwright() as playwright:
            browser = self._launch(playwright)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            try:
                model = self._login(page)
                inventory = self._read_inventory(page, emit)
                identity = inventory["identity"]
                emit("login", "success", f"ONU detectada: {model}")
                emit("identity", "success", f"Serial GPON detectado: {identity['serial']}")
                return {
                    "model": model,
                    "host": str(self.device.host),
                    "authenticated": True,
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
        with sync_playwright() as playwright:
            browser = self._launch(playwright)
            context = browser.new_context(accept_downloads=True)
            page = context.new_page()
            page.on("dialog", self._dismiss_dialog)
            try:
                emit("login", "running", "Autenticando en 192.168.100.1")
                model = self._login(page)
                if model != request.device.model:
                    raise OnuProvisioningError(
                        f"Modelo no compatible: se esperaba {request.device.model} y se detecto {model}"
                    )
                emit("login", "success", f"Sesion tecnica iniciada en {model}")
                identity = self._read_identity(page)
                emit("identity", "success", f"Serial GPON confirmado: {identity['serial']}")

                backups: dict[str, str | None] = {"before": None, "after": None}
                if request.create_backups:
                    emit("backup_before", "running", "Creando respaldo antes de modificar")
                    backups["before"] = self._download_backup(page, "antes")
                    if backups["before"]:
                        emit("backup_before", "success", "Respaldo previo guardado")
                    else:
                        emit("backup_before", "warning", "El firmware no entrego el respaldo previo")

                layer3 = request.service_mode == "router"
                emit("lan_ports", "running", f"Preparando puertos LAN en modo {'Layer 3' if layer3 else 'Bridge'}")
                lan_ports_result = self._configure_lan_port_mode(page, request.wan.bind_lan_ports, layer3=layer3)
                emit(
                    "lan_ports",
                    "success",
                    f"Puertos LAN {'Layer 3' if layer3 else 'Bridge'} listos: {', '.join(lan_ports_result['requested'])}",
                )

                wan_stage = "wan" if layer3 else "bridge"
                emit(wan_stage, "running", "Configurando IPoE, VLAN e IP estatica" if layer3 else "Configurando bridge Ethernet y VLAN")
                wan_result = self._configure_wan(page, request)
                emit(wan_stage, "success", f"Servicio {wan_result['connection_name']} configurado")

                tr069_result = None
                if layer3 and request.tr069.enabled:
                    emit("tr069", "running", "Configurando ACS y autenticacion TR-069")
                    tr069_result = self._configure_tr069(page, request)
                    emit("tr069", "success", "ACS local y reporte periodico configurados")

                wifi_result = None
                if layer3:
                    emit("wifi", "running", "Configurando SSID y seguridad WPA2")
                    wifi_result = self._configure_wifi(page, request)
                    emit("wifi", "success", f"WiFi {wifi_result['ssid']} configurado")

                acl_result = None
                if layer3:
                    emit("remote", "running", "Aplicando control remoto HTTP restringido")
                    acl_result = self._configure_remote_access(page, request)
                    emit("remote", "success", f"HTTP permitido desde {acl_result['source']}")

                if request.save_configuration:
                    emit("save", "running", "Guardando configuracion en memoria permanente")
                    self._save_configuration(page)
                    emit("save", "success", "Configuracion guardada sin reiniciar")

                emit("verify", "running", "Verificando WAN, WiFi y acceso remoto" if layer3 else "Verificando bridge, VLAN y puertos LAN")
                verification = self._verify(page, request)
                emit("verify", "success", "Todos los valores coinciden con el perfil solicitado")

                inventory = self._read_inventory(page, emit)

                if request.create_backups:
                    emit("backup_after", "running", "Creando respaldo final")
                    backups["after"] = self._download_backup(page, "configurada")
                    if backups["after"]:
                        emit("backup_after", "success", "Respaldo final guardado")
                    else:
                        emit("backup_after", "warning", "El firmware no entrego el respaldo final")

                return {
                    "model": model,
                    "host": str(request.device.host),
                    **identity,
                    "lan_ports": lan_ports_result,
                    "wan": wan_result,
                    "tr069": tr069_result,
                    "wifi": wifi_result,
                    "remote_access": acl_result,
                    "verification": verification,
                    "inventory": inventory,
                    "backups": backups,
                }
            except Exception:
                self._capture_failure(page)
                raise
            finally:
                context.close()
                browser.close()

    def _launch(self, playwright):
        launch_options = {
            "headless": self.headless,
            "args": ["--no-first-run", "--disable-default-apps", "--disable-gpu"],
        }
        try:
            executable_path = os.getenv("ONU_BROWSER_EXECUTABLE")
            if executable_path:
                return playwright.chromium.launch(executable_path=executable_path, **launch_options)
            try:
                return playwright.chromium.launch(**launch_options)
            except Exception:
                try:
                    return playwright.chromium.launch(channel="msedge", **launch_options)
                except Exception:
                    return playwright.chromium.launch(channel="chrome", **launch_options)
        except Exception as exc:
            raise OnuProvisioningError(
                "No se pudo iniciar el navegador interno de automatizacion. Reinstala ONU Studio."
            ) from exc

    def _login(self, page: Page) -> str:
        password = self.device.password.get_secret_value() if self.device.password else ""
        if not password:
            raise OnuProvisioningError("Falta la contrasena tecnica de la ONU en el agente local")
        try:
            page.goto(self.base_url, wait_until="domcontentloaded", timeout=10_000)
            initial_status = self._login_status(page)
            if initial_status["lock_left"] > 0:
                raise OnuProvisioningError(
                    f"La ONU bloqueo temporalmente el acceso. Espera {initial_status['lock_left']} segundos."
                )
            page.locator("#txt_Username").fill(self.device.username)
            page.locator("#txt_Password").fill(password)
            page.locator("#loginbutton").click()
            self._wait_for_management_page(page)
        except PlaywrightTimeout as exc:
            body = page.locator("body").inner_text(timeout=2_000)
            if "Incorrect User Name/Password" in body:
                raise OnuProvisioningError("Usuario o contrasena incorrectos; la ONU puede bloquearse tras 3 intentos") from exc
            status = self._login_status(page)
            if status["lock_left"] > 0:
                raise OnuProvisioningError(
                    f"La ONU bloqueo temporalmente el acceso. Espera {status['lock_left']} segundos."
                ) from exc
            if status["login_times"] > 0 or status["failed"]:
                raise OnuProvisioningError(
                    f"Credenciales rechazadas por la ONU (intento {status['login_times']} de {status['limit']})."
                ) from exc
            raise OnuProvisioningError(
                "La ONU acepto la conexion, pero mostro una pantalla no compatible. Revisa la captura de diagnostico."
            ) from exc
        title = page.title().strip()
        return title or "EG8141A5"

    @staticmethod
    def _login_status(page: Page) -> dict:
        try:
            return page.evaluate(
                """() => ({
                    failed: String(globalThis.FailStat || '0') === '1',
                    login_times: Number(globalThis.LoginTimes || 0),
                    lock_left: Number(globalThis.LockLeftTime || 0),
                    limit: Number(globalThis.errloginlockNum || 3)
                })"""
            )
        except Exception:
            return {"failed": False, "login_times": 0, "lock_left": 0, "limit": 3}

    def _wait_for_management_page(self, page: Page) -> None:
        deadline = time.monotonic() + 12
        wizard_closed = False
        while time.monotonic() < deadline:
            try:
                advanced = page.get_by_text("Advanced Configuration", exact=True)
                if advanced.count() == 1 and advanced.is_visible():
                    return

                wizard = page.get_by_text("Service Provisioning Method", exact=True)
                if not wizard_closed and wizard.count() == 1 and wizard.is_visible():
                    exit_button = page.get_by_role("button", name="Exit", exact=True)
                    if exit_button.count() != 1 or not exit_button.is_visible():
                        raise OnuProvisioningError("La ONU mostro el asistente inicial, pero no permitio cerrarlo")
                    exit_button.click()
                    wizard_closed = True
                    time.sleep(0.8)
                    continue

                body = page.locator("body").inner_text(timeout=2_000)
                if "Incorrect User Name/Password" in body:
                    raise OnuProvisioningError("Usuario o contrasena incorrectos; la ONU puede bloquearse tras 3 intentos")
                status = self._login_status(page)
                if status["lock_left"] > 0:
                    raise OnuProvisioningError(
                        f"La ONU bloqueo temporalmente el acceso. Espera {status['lock_left']} segundos."
                    )
                time.sleep(0.2)
            except PlaywrightError as exc:
                if not self._is_transient_navigation_error(exc):
                    raise
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=1_000)
                except PlaywrightTimeout:
                    pass
                time.sleep(0.2)
        raise PlaywrightTimeout("El panel de administracion no aparecio despues del inicio de sesion")

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

    def _open_advanced(self, page: Page) -> None:
        advanced = page.get_by_text("Advanced Configuration", exact=True)
        if advanced.count() == 1 and advanced.is_visible():
            advanced.click()
            page.locator("#menuIframe").wait_for(state="attached", timeout=6_000)

    def _read_identity(self, page: Page) -> dict:
        self._open_advanced(page)
        frame = self._menu_frame(page)
        try:
            return self._read_authentication(frame)
        except (PlaywrightTimeout, ValueError) as exc:
            raise OnuProvisioningError("La ONU no expuso un serial GPON valido") from exc

    def _read_authentication(self, frame: Frame) -> dict:
        frame.goto(
            f"{self.base_url}/html/amp/ontauth/passwordcommon.asp",
            wait_until="domcontentloaded",
            timeout=8_000,
        )
        serial_field = frame.locator("#SNValue")
        serial_field.wait_for(state="attached", timeout=5_000)
        raw_serial = serial_field.input_value().strip().upper()
        method = frame.locator('input[name="rMethod"]:checked').get_attribute("value")
        return {
            "serial": normalize_gpon_serial(raw_serial),
            "serial_raw": raw_serial,
            "authentication_mode": "loid" if method == "1" else "sn_password",
        }

    def _read_inventory(self, page: Page, emit: ProgressCallback | None = None) -> dict:
        """Read operational data exposed by the ONU without returning any credentials."""
        self._open_advanced(page)
        frame = self._menu_frame(page)
        errors: dict[str, str] = {}

        def report(section: str, message: str) -> None:
            if emit:
                emit(f"inventory_{section}", "success", message)

        try:
            identity = self._read_authentication(frame)
        except (PlaywrightTimeout, ValueError) as exc:
            raise OnuProvisioningError("La ONU no expuso un serial GPON valido") from exc

        device: dict = {}
        try:
            frame.goto(
                f"{self.base_url}/html/ssmp/deviceinfo/deviceinfo.asp",
                wait_until="domcontentloaded",
                timeout=8_000,
            )
            frame.locator("#td3_2").wait_for(state="attached", timeout=5_000)
            device = frame.evaluate(
                """() => {
                    const info = globalThis.deviceInfo || {};
                    const text = (id) => document.getElementById(id)?.textContent?.trim() || null;
                    return {
                        model: info.ModelName || text('td1_2'),
                        description: info.Description || text('td2_2'),
                        hardware_version: info.HardwareVersion || text('td4_2'),
                        software_version: info.SoftwareVersion || text('td5_2'),
                        firmware_release: info.ReleaseTime?.trim() || null,
                        manufacturer_info: info.ManufactureInfo || text('td6_2'),
                        vendor_id: info.VendorID || null,
                        mac: info.Mac || null,
                        registration_status: text('td7_2'),
                        ont_id: text('td8_2'),
                        cpu_usage: text('td9_2'),
                        memory_usage: text('td10_2'),
                        runtime: text('ShowTime'),
                        system_time: text('td14_2')
                    };
                }"""
            )
            report("device", "Modelo, firmware y estado GPON leidos")
        except Exception:
            errors["device"] = "Informacion del dispositivo no disponible"

        optical: dict = {}
        try:
            frame.goto(
                f"{self.base_url}/html/amp/opticinfo/opticinfo.asp",
                wait_until="domcontentloaded",
                timeout=8_000,
            )
            frame.locator("body").wait_for(state="attached", timeout=5_000)
            optical = frame.evaluate(
                """() => {
                    const info = globalThis.opticInfo || {};
                    const value = (name) => {
                        const raw = info[name];
                        return raw === undefined || raw === null || raw === '' || raw === '--' ? null : String(raw).trim();
                    };
                    return {
                        tx_power_dbm: value('transOpticPower'),
                        rx_power_dbm: value('revOpticPower'),
                        voltage_mv: value('voltage'),
                        bias_ma: value('bias'),
                        temperature_c: value('temperature'),
                        los: String(info.LosStatus || '') === '1',
                        module_vendor: value('VendorName'),
                        module_serial: value('VendorSN'),
                        module_date_code: value('DateCode'),
                        tx_wavelength_nm: value('TxWaveLength'),
                        rx_wavelength_nm: value('RxWaveLength'),
                        max_distance_km: value('MaxTxDistance')
                    };
                }"""
            )
            optical["signal_available"] = bool(optical.get("rx_power_dbm") or optical.get("tx_power_dbm"))
            report("optical", "Telemetria optica leida")
        except Exception:
            errors["optical"] = "Telemetria optica no disponible"

        wan: list[dict] = []
        try:
            frame.goto(
                f"{self.base_url}/html/bbsp/waninfo/waninfo.asp",
                wait_until="domcontentloaded",
                timeout=8_000,
            )
            frame.locator("body").wait_for(state="attached", timeout=5_000)
            wan = frame.evaluate(
                """() => (globalThis.WanList || []).filter(Boolean).map((item) => ({
                    name: item.RealName || item.Name || null,
                    enabled: String(item.Enable) === '1',
                    status: item.Status || null,
                    mac: item.MACAddress || null,
                    encapsulation: item.EncapMode || null,
                    protocol: item.ProtocolType || null,
                    mode: item.Mode || null,
                    service: item.ServiceList || null,
                    vlan_enabled: String(item.EnableVlan) === '1',
                    vlan_id: item.VlanId || null,
                    priority: item.Priority || item.DefaultPriority || null,
                    address_mode: item.IPv4AddressMode || null,
                    ip_address: item.IPv4IPAddress || null,
                    subnet_mask: item.IPv4SubnetMask || null,
                    gateway: item.IPv4Gateway || null,
                    primary_dns: item.IPv4PrimaryDNS || null,
                    secondary_dns: item.IPv4SecondaryDNS || null,
                    nat_enabled: String(item.IPv4NATEnable) === '1',
                    mtu: item.IPv4MXU || null,
                    uptime_seconds: item.Uptime || null,
                    lan_bindings: Array.isArray(item.IPv4BindLanList) ? item.IPv4BindLanList : [],
                    ssid_bindings: Array.isArray(item.IPv4BindSsidList) ? item.IPv4BindSsidList : []
                }))"""
            )
            report("wan", f"{len(wan)} perfil WAN leido" if len(wan) == 1 else f"{len(wan)} perfiles WAN leidos")
        except Exception:
            errors["wan"] = "Configuracion WAN no disponible"

        ethernet: dict = {"mac": None, "ports": []}
        try:
            frame.goto(
                f"{self.base_url}/html/amp/ethinfo/ethinfo.asp",
                wait_until="domcontentloaded",
                timeout=8_000,
            )
            frame.locator("body").wait_for(state="attached", timeout=5_000)
            ethernet = frame.evaluate(
                """() => {
                    const rows = Array.from(document.querySelectorAll('tr')).map((row) =>
                        Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent.trim().replace(/\s+/g, ' '))
                    );
                    const ports = rows.filter((cells) => /^[1-4]$/.test(cells[0] || '') && cells.length >= 8).map((cells) => ({
                        port: Number(cells[0]), duplex: cells[1], speed: cells[2], link: cells[3],
                        rx_bytes: Number(cells[4]) || 0, rx_packets: Number(cells[5]) || 0,
                        tx_bytes: Number(cells[6]) || 0, tx_packets: Number(cells[7]) || 0
                    }));
                    const mac = globalThis.lanMac || globalThis.DeviceLanMACs?.[0]?.LanMac || null;
                    return {mac: mac ? String(mac).trim().toUpperCase() : null, ports};
                }"""
            )
            report("ethernet", "Estado de los puertos LAN leido")
        except Exception:
            errors["ethernet"] = "Estado Ethernet no disponible"

        wifi: dict = {"radios": [], "clients": []}
        try:
            frame.goto(
                f"{self.base_url}/html/amp/wlaninfo/wlaninfo.asp",
                wait_until="domcontentloaded",
                timeout=8_000,
            )
            frame.locator("body").wait_for(state="attached", timeout=5_000)
            wifi = frame.evaluate(
                """() => {
                    const radios = (globalThis.WlanInfo || []).filter(Boolean).map((item, index) => ({
                        index: index + 1, enabled: String(item.enable) === '1', ssid: item.ssid || null,
                        channel: item.Channel || null, standard: item.X_HW_Standard || null,
                        transmit_power_percent: item.TransmitPower || null,
                        authentication: item.IEEE11iAuth || item.WPAAuth || item.BeaconType || null,
                        encryption: item.IEEE11iEncrypt || item.WPAEncrypt || null,
                        hidden: item.SSIDAdvertisementEnabled !== undefined
                            ? String(item.SSIDAdvertisementEnabled) !== '1'
                            : String(item.wlHide) !== '1',
                        broadcast: item.SSIDAdvertisementEnabled !== undefined
                            ? String(item.SSIDAdvertisementEnabled) === '1'
                            : String(item.wlHide) === '1',
                        wmm_enabled: String(item.wmmEnable ?? item.WMMEnable) === '1',
                        max_clients: item.DeviceNum || null
                    }));
                    const clients = Array.from(document.querySelectorAll('#wlan_stainfo_table tr')).slice(1).map((row) =>
                        Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent.trim().replace(/\s+/g, ' '))
                    ).filter((cells) => cells.length >= 9).map((cells) => ({
                        mac: cells[0], ssid: cells[1], uptime_seconds: cells[2], tx_mbps: cells[3],
                        rx_mbps: cells[4], signal_dbm: cells[5], noise_dbm: cells[6], snr_db: cells[7], quality: cells[8]
                    }));
                    return {radios, clients};
                }"""
            )
            report("wifi", "WiFi y estaciones conectadas leidos")
        except Exception:
            errors["wifi"] = "Estado WiFi no disponible"

        remote_access: dict = {"rules": []}
        try:
            acl_frame = self._open_acl(page)
            rows = [re.sub(r"\s+", " ", row).strip() for row in acl_frame.locator("tr").all_inner_texts()]
            remote_access = {"rules": self._actual_acl_rows(rows)[:32]}
            report("remote", "Reglas de administracion remota leidas")
        except Exception:
            errors["remote_access"] = "Control de acceso remoto no disponible"

        return {
            "collected_at": datetime.now(timezone.utc).isoformat(),
            "source": "onu_local_read_only",
            "identity": identity,
            "device": device,
            "optical": optical,
            "wan": wan,
            "ethernet": ethernet,
            "wifi": wifi,
            "remote_access": remote_access,
            "errors": errors,
        }

    def _click_menu(self, page: Page, selectors: list[str], text: str) -> None:
        for selector in selectors:
            locator = page.locator(selector)
            if locator.count() == 1 and locator.is_visible():
                locator.click()
                time.sleep(0.25)
                return
        candidates = page.get_by_text(text, exact=True)
        visible = [candidate for candidate in candidates.all() if candidate.is_visible()]
        if len(visible) != 1:
            raise OnuProvisioningError(f"El firmware no mostro el menu {text}")
        visible[0].click()
        time.sleep(0.25)

    @staticmethod
    def _menu_frame(page: Page) -> Frame:
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            handle = page.locator("#menuIframe").element_handle()
            if handle:
                frame = handle.content_frame()
                if frame:
                    return frame
            time.sleep(0.15)
        raise OnuProvisioningError("No se pudo abrir el panel interno de configuracion")

    @staticmethod
    def _control_error(selector: str, current: object, desired: object) -> OnuProvisioningError:
        return OnuProvisioningError(
            f"El campo {selector} esta bloqueado por el firmware: valor actual {current!s}, solicitado {desired!s}",
            code="ONU_IMMUTABLE_FIELD_CONFLICT",
            retryable=False,
        )

    @classmethod
    def _set_checked(
        cls, frame: Frame, selector: str, checked: bool, *, required: bool = False
    ) -> bool:
        control = frame.locator(selector)
        if control.count() != 1:
            if required:
                raise OnuProvisioningError(
                    f"Campo requerido no encontrado: {selector}", code="ONU_REQUIRED_CONTROL_MISSING"
                )
            return False
        control.wait_for(state="attached", timeout=4_000)
        current = control.is_checked()
        if not control.is_visible() or not control.is_enabled():
            if current == checked:
                return False
            if required:
                raise cls._control_error(selector, current, checked)
            return False
        control.set_checked(checked, timeout=4_000)
        if control.is_checked() != checked:
            raise OnuProvisioningError(f"La ONU no conservo el valor de {selector}")
        return current != checked

    @classmethod
    def _fill(cls, frame: Frame, selector: str, value: str, *, required: bool = True) -> bool:
        control = frame.locator(selector)
        if control.count() != 1:
            if required:
                raise OnuProvisioningError(
                    f"Campo requerido no encontrado: {selector}", code="ONU_REQUIRED_CONTROL_MISSING"
                )
            return False
        control.wait_for(state="attached", timeout=4_000)
        current = control.input_value(timeout=2_000)
        read_only = bool(control.evaluate("element => Boolean(element.disabled || element.readOnly)"))
        if not control.is_visible() or not control.is_enabled() or read_only:
            if current == value:
                return False
            if required:
                raise cls._control_error(selector, current, value)
            return False
        if current == value:
            return False
        control.fill(value, timeout=4_000)
        if control.input_value(timeout=2_000) != value:
            raise OnuProvisioningError(f"La ONU no conservo el valor de {selector}")
        return True

    @classmethod
    def _select(cls, frame: Frame, selector: str, value: str, *, required: bool = False) -> bool:
        control = frame.locator(selector)
        if control.count() != 1:
            if required:
                raise OnuProvisioningError(
                    f"Campo requerido no encontrado: {selector}", code="ONU_REQUIRED_CONTROL_MISSING"
                )
            return False
        control.wait_for(state="attached", timeout=4_000)
        values = control.locator("option").evaluate_all("options => options.map(option => option.value)")
        if value not in values:
            if required:
                raise OnuProvisioningError(
                    f"La ONU no admite el valor {value} en {selector}",
                    code="ONU_UNSUPPORTED_CONTROL_VALUE",
                    retryable=False,
                )
            return False
        current = control.input_value(timeout=2_000)
        read_only = bool(control.evaluate("element => Boolean(element.disabled || element.readOnly)"))
        if not control.is_visible() or not control.is_enabled() or read_only:
            if current == value:
                return False
            if required:
                raise cls._control_error(selector, current, value)
            return False
        if current == value:
            return False
        control.select_option(value=value, timeout=4_000)
        if control.input_value(timeout=2_000) != value:
            raise OnuProvisioningError(f"La ONU no conservo el valor de {selector}")
        return True

    def _open_wan(self, page: Page) -> Frame:
        self._open_advanced(page)
        self._click_menu(page, ["#name_wanconfig", "#wanconfig"], "WAN Configuration")
        frame = self._menu_frame(page)
        frame.get_by_text("WAN Configuration", exact=True).wait_for(state="visible", timeout=6_000)
        return frame

    def _open_lan_port_mode(self, page: Page) -> Frame:
        self._open_advanced(page)
        frame = self._menu_frame(page)
        frame.goto(
            f"{self.base_url}/html/bbsp/layer3/layer3.asp",
            wait_until="domcontentloaded",
            timeout=8_000,
        )
        frame.locator("#cb_Lan1").wait_for(state="attached", timeout=5_000)
        return frame

    @staticmethod
    def _enabled_lan_ports(frame: Frame) -> list[int]:
        return [
            port
            for port in range(1, 5)
            if frame.locator(f"#cb_Lan{port}").count() == 1
            and frame.locator(f"#cb_Lan{port}").is_checked()
        ]

    def _configure_lan_port_mode(self, page: Page, requested_ports: list[int], *, layer3: bool = True) -> dict:
        requested = sorted(set(requested_ports))
        invalid = [port for port in requested if port not in range(1, 5)]
        if invalid:
            raise OnuProvisioningError(
                f"Puertos LAN no compatibles: {invalid}",
                code="ONU_UNSUPPORTED_LAN_PORT",
                retryable=False,
            )

        frame = self._open_lan_port_mode(page)
        changed: list[int] = []
        for port in requested:
            if self._set_checked(frame, f"#cb_Lan{port}", layer3, required=True):
                changed.append(port)

        if changed:
            apply_buttons = frame.locator("#Apply")
            apply_button = next(
                (button for button in apply_buttons.all() if button.is_visible() and button.is_enabled()),
                None,
            )
            if not apply_button:
                raise OnuProvisioningError(
                    "El firmware no mostro el boton para aplicar el modo de los puertos LAN",
                    code="ONU_LAN_PORT_MODE_UNAVAILABLE",
                    retryable=False,
                )
            self.dialogs.clear()
            apply_button.click(timeout=4_000)
            time.sleep(0.8)
            self._raise_for_dialog_error("modo de puertos LAN")
            frame = self._open_lan_port_mode(page)

        enabled = self._enabled_lan_ports(frame)
        missing = [port for port in requested if (port in enabled) != layer3]
        if missing:
            raise OnuProvisioningError(
                f"La ONU no conservo LAN{', LAN'.join(str(port) for port in missing)} en modo {'Layer 3' if layer3 else 'Bridge'}",
                code="ONU_LAN_PORT_MODE_NOT_APPLIED",
            )
        return {
            "requested": [f"LAN{port}" for port in requested],
            "enabled": [f"LAN{port}" for port in enabled], "mode": "router" if layer3 else "bridge",
            "changed": [f"LAN{port}" for port in changed],
        }

    @staticmethod
    def _wan_service(request: ProvisionRequest) -> str:
        return "TR069_INTERNET" if request.service_mode == "router" and request.tr069.enabled else "INTERNET"

    @classmethod
    def _wan_connection_name(cls, request: ProvisionRequest) -> str:
        mode = "R" if request.service_mode == "router" else "B"
        return f"1_{cls._wan_service(request)}_{mode}_VID_{request.wan.vlan_id}"

    @staticmethod
    def _click_visible_exact_text(frame: Frame, text: str) -> bool:
        for candidate in frame.get_by_text(text, exact=True).all():
            if candidate.is_visible() and candidate.is_enabled():
                candidate.click()
                return True
        return False

    @staticmethod
    def _select_wan_connection(frame: Frame, connection_name: str) -> bool:
        if HuaweiEg8141A5._click_visible_exact_text(frame, connection_name):
            return True
        rows = frame.locator("tr").filter(has_text=connection_name)
        for row in rows.all():
            if row.is_visible():
                cells = row.locator("td")
                if cells.count() > 1:
                    cells.nth(1).click()
                else:
                    row.click()
                return True
        return False

    @staticmethod
    def _wan_connections(frame: Frame) -> list[str]:
        names: list[str] = []
        pattern = re.compile(r"\b\d+_[A-Z0-9_]+_[RB]_VID_\d+\b", re.I)
        for row in frame.locator("tr").all_inner_texts():
            for match in pattern.findall(row):
                if match not in names:
                    names.append(match)
        return names

    @staticmethod
    def _compatible_wan_connection(request: ProvisionRequest, names: list[str]) -> str | None:
        suffix = f"_{'R' if request.service_mode == 'router' else 'B'}_VID_{request.wan.vlan_id}"
        candidates = [name for name in names if name.upper().endswith(suffix)]
        desired = HuaweiEg8141A5._wan_connection_name(request)
        if desired in candidates:
            return desired
        return next((name for name in candidates if "INTERNET" in name.upper()), None)

    def _delete_conflicting_wan(self, frame: Frame, name: str) -> None:
        if not self._select_wan_connection(frame, name):
            raise OnuProvisioningError("La WAN incompatible desaparecio antes de reemplazarla")
        delete_button = frame.get_by_role("button", name="Delete", exact=True)
        if delete_button.count() != 1 or not delete_button.is_visible() or not delete_button.is_enabled():
            raise OnuProvisioningError(
                "El firmware no permite eliminar la WAN incompatible",
                code="ONU_WAN_REPLACEMENT_UNAVAILABLE",
                retryable=False,
            )
        self.dialogs.clear()
        delete_button.click(timeout=4_000)
        time.sleep(0.8)
        self._raise_for_dialog_error("reemplazo WAN")

    def _configure_wan(self, page: Page, request: ProvisionRequest) -> dict:
        frame = self._open_wan(page)
        desired_name = self._wan_connection_name(request)
        connections = self._wan_connections(frame)
        name = self._compatible_wan_connection(request, connections) or desired_name
        editing_existing = self._select_wan_connection(frame, name)
        if not editing_existing:
            conflicts = [
                candidate for candidate in connections
                if candidate != name and candidate.upper().endswith(
                    f"_{'R' if request.service_mode == 'router' else 'B'}_VID_{request.wan.vlan_id}"
                )
            ]
            if conflicts and not request.replace_conflicting_wan:
                raise OnuProvisioningError(
                    f"La VLAN {request.wan.vlan_id} ya usa {conflicts[0]}. Confirma el reemplazo despues del respaldo.",
                    code="ONU_WAN_REPLACEMENT_CONFIRMATION_REQUIRED",
                    retryable=True,
                )
            for conflict in conflicts:
                self._delete_conflicting_wan(frame, conflict)
            new_button = frame.get_by_role("button", name="New", exact=True)
            new_button.wait_for(state="visible", timeout=4_000)
            new_button.click(timeout=4_000)

        frame.locator("#WanSwitch").wait_for(state="attached", timeout=5_000)
        self._set_checked(frame, "#WanSwitch", True, required=True)
        self._set_checked(frame, "#VlanSwitch", True, required=True)
        self._set_checked(frame, "#EncapMode1", True, required=True)
        self._select(frame, "#ProtocolType", "IPv4", required=True)
        self._select(frame, "#WanMode", "IP_Routed" if request.service_mode == "router" else "IP_Bridged", required=True)
        service = self._wan_service(request)
        if editing_existing:
            existing_service = frame.locator("#ServiceList").input_value(timeout=2_000)
            if existing_service in {"INTERNET", "TR069_INTERNET"}:
                service = existing_service
        self._select(frame, "#ServiceList", service, required=True)
        self._fill(frame, "#VlanId", str(request.wan.vlan_id))
        self._select(frame, "#PriorityPolicy", "Specified", required=True)
        self._select(frame, "#DefaultVlanPriority", str(request.wan.priority))
        self._select(frame, "#VlanPriority", str(request.wan.priority), required=True)
        self._fill(frame, "#IPv4MXU", str(request.wan.mtu))

        for port in range(1, 5):
            self._set_checked(frame, f"#IPv4BindLanList{port}", port in request.wan.bind_lan_ports)
        self._set_checked(frame, "#IPv4BindLanList9", request.wan.bind_ssid1)

        if request.service_mode == "router":
            self._set_checked(frame, "#IPv4AddressMode1", True)
            self._set_checked(frame, "#IPv4NatSwitch", request.wan.nat_enabled)
            self._fill(frame, "#IPv4IPAddress", str(request.wan.ip_address))
            self._fill(frame, "#IPv4SubnetMask", str(request.wan.subnet_mask))
            self._fill(frame, "#IPv4DefaultGateway", str(request.wan.gateway))
            self._set_checked(frame, "#IPv4DNSOverrideSwitch", True)
            self._fill(frame, "#IPv4PrimaryDNSServer", str(request.wan.primary_dns))
            self._fill(frame, "#IPv4SecondaryDNSServer", str(request.wan.secondary_dns or ""))
        else:
            self._set_checked(frame, "#IPv4NatSwitch", False)

        self.dialogs.clear()
        frame.locator("#ButtonApply").click(timeout=4_000)
        time.sleep(0.8)
        self._raise_for_dialog_error("WAN")
        self._configured_wan_name = name
        self._configured_wan_service = service
        return {
            "connection_name": name,
            "service_mode": request.service_mode,
            "service": service,
            "vlan_id": request.wan.vlan_id,
            "ip_address": str(request.wan.ip_address) if request.service_mode == "router" else None,
            "gateway": str(request.wan.gateway),
            "dns": [str(request.wan.primary_dns), str(request.wan.secondary_dns or "")],
            "nat": request.wan.nat_enabled,
            "bindings": [f"LAN{port}" for port in request.wan.bind_lan_ports] + (["SSID1"] if request.wan.bind_ssid1 else []),
            "operation": "updated" if editing_existing else "created",
        }

    def _open_tr069_page(self, page: Page) -> Page:
        tr069_page = page.context.new_page()
        tr069_page.on("dialog", self._dismiss_dialog)
        tr069_page.goto(
            f"{self.base_url}/html/ssmp/tr069/tr069.asp",
            wait_until="domcontentloaded",
            timeout=10_000,
        )
        tr069_page.locator("#EnableCWMP").wait_for(state="attached", timeout=6_000)
        return tr069_page

    def _configure_tr069(self, page: Page, request: ProvisionRequest) -> dict:
        desired = request.tr069
        password = desired.password.get_secret_value() if desired.password else ""
        connection_request_password = (
            desired.connection_request_password.get_secret_value()
            if desired.connection_request_password else ""
        )
        if not password or not connection_request_password:
            raise OnuProvisioningError("Faltan las credenciales protegidas TR-069")

        tr069_page = self._open_tr069_page(page)
        try:
            self._set_checked(tr069_page, "#EnableCWMP", True)
            self._set_checked(tr069_page, "#PeriodicInformEnable", True)
            self._fill(tr069_page, "#PeriodicInformInterval", str(desired.periodic_inform_interval))
            self._fill(tr069_page, "#URL", desired.acs_url)
            self._fill(tr069_page, "#Username", desired.username)
            self._fill(tr069_page, "#Password", password)
            self._fill(tr069_page, "#ConnectionRequestUsername", desired.connection_request_username)
            self._fill(tr069_page, "#ConnectionRequestPassword", connection_request_password)
            self._set_checked(tr069_page, "#CertificateEnable", False)

            self.dialogs.clear()
            tr069_page.locator("#ACSbtnApply").click()
            time.sleep(1)
            self._raise_for_dialog_error("TR-069")
        finally:
            tr069_page.close()
        return {
            "enabled": True,
            "acs_url": desired.acs_url,
            "username": desired.username,
            "connection_request_username": desired.connection_request_username,
            "periodic_inform_interval": desired.periodic_inform_interval,
            "authentication_configured": True,
        }

    def _configure_wifi(self, page: Page, request: ProvisionRequest) -> dict:
        self._click_menu(page, ["#name_wlanconfig", "#wlanconfig"], "WLAN")
        frame = self._menu_frame(page)
        frame.locator("#wlSsid").wait_for(state="attached", timeout=6_000)
        self._set_checked(frame, "#wlEnbl", request.wifi.enabled)
        self._set_checked(frame, "#wlEnable", request.wifi.enabled)
        self._fill(frame, "#wlSsid", request.wifi.ssid)
        self._fill(frame, "#X_HW_AssociateNum", str(request.wifi.max_clients))
        # This firmware labels the control as wlHide, but its submitted value
        # is SSIDAdvertisementEnabled: checked means the SSID is visible.
        self._set_checked(frame, "#wlHide", request.wifi.broadcast, required=True)
        self._set_checked(frame, "#enableWmm", request.wifi.wmm_enabled)
        self._select(frame, "#wlAuthMode", "wpa2-psk")
        self._select(frame, "#wlEncryption", "AESEncryption")
        self._set_checked(frame, "#hidewlWpaPsk", True)
        self._fill(frame, "#wlWpaPsk", request.wifi.password.get_secret_value())
        self._fill(frame, "#wlWpaGtkRekey", "3600")
        self._set_checked(frame, "#wlWPSEnable", request.wifi.wps_enabled)

        self.dialogs.clear()
        frame.locator("#btnApplySubmit").click()
        time.sleep(0.8)
        self._raise_for_dialog_error("WiFi")
        return {
            "ssid": request.wifi.ssid,
            "security": "WPA2-PSK/AES",
            "broadcast": request.wifi.broadcast,
            "wmm": request.wifi.wmm_enabled,
            "wps": request.wifi.wps_enabled,
        }

    def _open_acl(self, page: Page) -> Frame:
        self._open_advanced(page)
        self._click_menu(page, ["#name_securityconfig", "#securityconfig"], "Security Configuration")
        self._click_menu(page, ["#wanacl"], "WAN Access Control Configuration")
        frame = self._menu_frame(page)
        frame.get_by_text("WAN Access Control Configuration", exact=True).wait_for(state="visible", timeout=6_000)
        return frame

    @staticmethod
    def _actual_acl_rows(rows: list[str]) -> list[str]:
        return [
            row for row in rows
            if re.search(r"\b\d+_[A-Z0-9_]+_[RB]_VID_\d+\b", row, re.I)
            and "HTTP" in row.upper()
            and re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?\b", row)
        ]

    def _configure_remote_access(self, page: Page, request: ProvisionRequest) -> dict:
        frame = self._open_acl(page)
        name = self._configured_wan_name or self._wan_connection_name(request)
        desired = request.remote_access
        rows = self._actual_acl_rows(frame.locator("tr").all_inner_texts())
        exact_rule = any(name in row and "HTTP" in row and desired.source in row and "Enable" in row for row in rows)
        if exact_rule:
            return {"wan": name, "protocol": "HTTP", "source": desired.source, "enabled": True}

        if not self._click_visible_exact_text(frame, name):
            frame.get_by_role("button", name="New", exact=True).click(timeout=4_000)

        frame.locator("#WanAclEnable").wait_for(state="visible", timeout=5_000)
        self._set_checked(frame, "#WanAclEnable", desired.enabled, required=True)
        wan_select = frame.locator("#WanNameList")
        wan_select.wait_for(state="visible", timeout=4_000)
        options = wan_select.locator("option").evaluate_all(
            "options => options.map(option => ({ value: option.value, label: option.textContent.trim() }))"
        )
        match = next((option for option in options if option["label"] == name), None)
        if not match:
            raise OnuProvisioningError("La regla ACL no encontro la WAN configurada")
        self._select(frame, "#WanNameList", match["value"], required=True)
        self._set_checked(frame, "#cb_TELNET", False)
        self._set_checked(frame, "#cb_SSH", False)
        self._set_checked(frame, "#cb_HTTP", True)
        self._set_checked(frame, "#cb_FTP", False)
        self._set_checked(frame, "#cb_ICMP", False)
        if frame.locator("#ip_0").count() == 0:
            frame.get_by_role("button", name="Add", exact=True).click()
            frame.locator("#ip_0").wait_for(state="visible", timeout=4_000)
        self._fill(frame, "#ip_0", desired.source)

        self.dialogs.clear()
        frame.get_by_role("button", name="Apply", exact=True).click(timeout=4_000)
        time.sleep(0.8)
        self._raise_for_dialog_error("acceso remoto")
        refreshed = self._open_acl(page)
        applied_rows = self._actual_acl_rows(refreshed.locator("tr").all_inner_texts())
        if not any(name in row and "HTTP" in row.upper() and desired.source in row and "ENABLE" in row.upper() for row in applied_rows):
            raise OnuProvisioningError("La ONU no confirmo la regla HTTP restringida")
        return {"wan": name, "protocol": "HTTP", "source": desired.source, "enabled": desired.enabled}

    def _save_configuration(self, page: Page) -> None:
        self._open_advanced(page)
        self._click_menu(page, ["#name_maintaininfo"], "Maintenance Diagnosis")
        self._click_menu(page, ["#cfgconfig"], "Configuration File Management")
        frame = self._menu_frame(page)
        self.dialogs.clear()
        frame.get_by_role("button", name="Save", exact=True).click()
        time.sleep(0.8)
        self._raise_for_dialog_error("guardado")

    def _download_backup(self, page: Page, suffix: str) -> str | None:
        try:
            self._open_advanced(page)
            self._click_menu(page, ["#name_maintaininfo"], "Maintenance Diagnosis")
            self._click_menu(page, ["#cfgconfig"], "Configuration File Management")
            frame = self._menu_frame(page)
            with page.expect_download(timeout=8_000) as download_info:
                frame.get_by_role("button", name="Download Configuration File", exact=True).click()
            download = download_info.value
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            target = self.backup_dir / f"EG8141A5-{self.device.host}-{stamp}-{suffix}.xml"
            download.save_as(target)
            return str(target)
        except Exception:
            return None

    def _verify(self, page: Page, request: ProvisionRequest) -> dict:
        frame = self._open_wan(page)
        name = self._configured_wan_name or self._wan_connection_name(request)
        if not self._select_wan_connection(frame, name):
            raise OnuProvisioningError("La conexion WAN no aparece despues de aplicar")
        if request.service_mode == "bridge":
            actual = {
                "mode": frame.locator("#WanMode").input_value(),
                "service": frame.locator("#ServiceList").input_value(),
                "vlan": frame.locator("#VlanId").input_value(),
                "nat": frame.locator("#IPv4NatSwitch").is_checked(),
                "bindings": [port for port in range(1, 5) if frame.locator(f"#IPv4BindLanList{port}").is_checked()],
            }
            expected = {
                "mode": "IP_Bridged", "service": "INTERNET", "vlan": str(request.wan.vlan_id),
                "nat": False, "bindings": request.wan.bind_lan_ports,
            }
            if actual != expected:
                raise OnuProvisioningError(f"Verificacion Bridge fallo: {actual}")
            return {"bridge": True, "vlan": True, "lan_ports": True, "ip_host_absent": True}
        frame.locator("#IPv4IPAddress").wait_for(state="attached", timeout=5_000)
        wan_values = {
            "service": frame.locator("#ServiceList").input_value(),
            "vlan": frame.locator("#VlanId").input_value(),
            "ip": frame.locator("#IPv4IPAddress").input_value(),
            "mask": frame.locator("#IPv4SubnetMask").input_value(),
            "gateway": frame.locator("#IPv4DefaultGateway").input_value(),
            "dns": frame.locator("#IPv4PrimaryDNSServer").input_value(),
            "nat": frame.locator("#IPv4NatSwitch").is_checked(),
            "bindings": [
                port for port in range(1, 5)
                if frame.locator(f"#IPv4BindLanList{port}").count() == 1
                and frame.locator(f"#IPv4BindLanList{port}").is_checked()
            ],
            "ssid1": frame.locator("#IPv4BindLanList9").count() == 1
            and frame.locator("#IPv4BindLanList9").is_checked(),
        }
        expected_wan = {
            "service": self._configured_wan_service or self._wan_service(request),
            "vlan": str(request.wan.vlan_id),
            "ip": str(request.wan.ip_address),
            "mask": str(request.wan.subnet_mask),
            "gateway": str(request.wan.gateway),
            "dns": str(request.wan.primary_dns),
            "nat": request.wan.nat_enabled,
            "bindings": request.wan.bind_lan_ports,
            "ssid1": request.wan.bind_ssid1,
        }
        if wan_values != expected_wan:
            raise OnuProvisioningError(f"Verificacion WAN fallo: {wan_values}")

        tr069_ok = self._verify_tr069(page, request) if request.tr069.enabled else True

        self._click_menu(page, ["#name_wlanconfig", "#wlanconfig"], "WLAN")
        wifi_frame = self._menu_frame(page)
        wifi_frame.locator("#wlSsid").wait_for(state="attached", timeout=5_000)
        wifi_values = {
            "ssid": wifi_frame.locator("#wlSsid").input_value(),
            "enabled": (
                wifi_frame.locator("#wlEnbl").is_checked()
                if wifi_frame.locator("#wlEnbl").count() == 1
                else wifi_frame.locator("#wlEnable").is_checked()
            ),
            "max_clients": wifi_frame.locator("#X_HW_AssociateNum").input_value(),
            "broadcast": wifi_frame.locator("#wlHide").is_checked(),
            "wmm": wifi_frame.locator("#enableWmm").is_checked(),
            "authentication": wifi_frame.locator("#wlAuthMode").input_value(),
            "encryption": wifi_frame.locator("#wlEncryption").input_value(),
            "wps": wifi_frame.locator("#wlWPSEnable").is_checked(),
        }
        expected_wifi = {
            "ssid": request.wifi.ssid,
            "enabled": request.wifi.enabled,
            "max_clients": str(request.wifi.max_clients),
            "broadcast": request.wifi.broadcast,
            "wmm": request.wifi.wmm_enabled,
            "authentication": "wpa2-psk",
            "encryption": "AESEncryption",
            "wps": request.wifi.wps_enabled,
        }
        if wifi_values != expected_wifi:
            raise OnuProvisioningError(f"Verificacion WiFi fallo: {wifi_values}")

        acl_frame = self._open_acl(page)
        acl_rows = self._actual_acl_rows(acl_frame.locator("tr").all_inner_texts())
        acl_ok = any(
            name in row and "HTTP" in row and request.remote_access.source in row
            and (not request.remote_access.enabled or "Enable" in row)
            for row in acl_rows
        )
        if not acl_ok:
            raise OnuProvisioningError("La regla HTTP restringida no aparece en la tabla WAN ACL")
        return {"wan": True, "tr069": tr069_ok, "wifi": True, "remote_access": True}

    def _verify_tr069(self, page: Page, request: ProvisionRequest) -> bool:
        tr069_page = self._open_tr069_page(page)
        try:
            desired = request.tr069
            actual = {
                "enabled": tr069_page.locator("#EnableCWMP").is_checked(),
                "periodic": tr069_page.locator("#PeriodicInformEnable").is_checked(),
                "interval": tr069_page.locator("#PeriodicInformInterval").input_value(),
                "url": tr069_page.locator("#URL").input_value(),
                "username": tr069_page.locator("#Username").input_value(),
                "connection_request_username": tr069_page.locator("#ConnectionRequestUsername").input_value(),
                "certificate": tr069_page.locator("#CertificateEnable").is_checked(),
            }
            expected = {
                "enabled": True,
                "periodic": True,
                "interval": str(desired.periodic_inform_interval),
                "url": desired.acs_url,
                "username": desired.username,
                "connection_request_username": desired.connection_request_username,
                "certificate": False,
            }
            if actual != expected:
                raise OnuProvisioningError(f"Verificacion TR-069 fallo: {actual}")
            return True
        finally:
            tr069_page.close()

    def _dismiss_dialog(self, dialog) -> None:
        self.dialogs.append(dialog.message or "")
        dialog.dismiss()

    def _raise_for_dialog_error(self, step: str) -> None:
        errors = [message for message in self.dialogs if re.search(r"invalid|incorrect|error|fail|required|must", message, re.I)]
        if errors:
            raise OnuProvisioningError(f"El firmware rechazo {step}: {errors[-1]}")

    def _capture_failure(self, page: Page) -> None:
        try:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            page.screenshot(path=self.backup_dir / f"error-{stamp}.png", full_page=True)
            (self.backup_dir / f"error-{stamp}.html").write_text(page.content(), encoding="utf-8")
        except Exception:
            pass
