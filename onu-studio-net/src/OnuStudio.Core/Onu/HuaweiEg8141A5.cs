using System.Diagnostics;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using OnuStudio.Core.Models;

namespace OnuStudio.Core.Onu;

/// <summary>
/// Controlador de la Huawei / Novatech EG8141A5. Trabaja sobre el panel web de la ONU
/// con el mismo recorrido que el agente anterior: respaldo, cambio, verificacion.
/// </summary>
public sealed class HuaweiEg8141A5 : IOnuController
{
    private readonly DeviceSettings _device;
    private readonly string _backupDir;
    private readonly string _baseUrl;
    private readonly List<string> _dialogs = new();

    private string? _configuredWanName;
    private string? _configuredWanService;

    public HuaweiEg8141A5(DeviceSettings device, string backupDir)
    {
        _device = device;
        _backupDir = backupDir;
        _baseUrl = $"http://{device.Host}";
    }

    // ─────────────────────────── Operaciones publicas ───────────────────────────

    public async Task<JsonObject> CheckAsync(ProgressCallback emit, CancellationToken cancellationToken = default)
    {
        emit("login", "running", "Abriendo la administracion de la ONU");
        await BrowserLauncher.EnsureInstalledAsync(message => emit("login", "running", message), cancellationToken).ConfigureAwait(false);

        using var playwright = await Playwright.CreateAsync().ConfigureAwait(false);
        var browser = await BrowserLauncher.LaunchAsync(playwright).ConfigureAwait(false);
        var context = await browser.NewContextAsync(new BrowserNewContextOptions { AcceptDownloads = true }).ConfigureAwait(false);
        var page = await context.NewPageAsync().ConfigureAwait(false);

        try
        {
            var model = await LoginAsync(page).ConfigureAwait(false);
            var inventory = await ReadInventoryAsync(page, emit).ConfigureAwait(false);
            var identity = BrowserJson.AsObject(inventory["identity"]);
            emit("login", "success", $"ONU detectada: {model}");
            emit("identity", "success", $"Serial GPON detectado: {identity["serial"]}");

            return new JsonObject
            {
                ["model"] = model,
                ["host"] = _device.Host,
                ["authenticated"] = true,
                ["serial"] = identity["serial"]?.DeepClone(),
                ["serial_raw"] = identity["serial_raw"]?.DeepClone(),
                ["authentication_mode"] = identity["authentication_mode"]?.DeepClone(),
                ["inventory"] = inventory,
            };
        }
        catch (Exception)
        {
            await CaptureFailureAsync(page).ConfigureAwait(false);
            throw;
        }
        finally
        {
            await context.CloseAsync().ConfigureAwait(false);
            await browser.CloseAsync().ConfigureAwait(false);
        }
    }

    public async Task<JsonObject> ProvisionAsync(ProvisionRequest request, ProgressCallback emit, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(_backupDir);
        await BrowserLauncher.EnsureInstalledAsync(message => emit("login", "running", message), cancellationToken).ConfigureAwait(false);

        using var playwright = await Playwright.CreateAsync().ConfigureAwait(false);
        var browser = await BrowserLauncher.LaunchAsync(playwright).ConfigureAwait(false);
        var context = await browser.NewContextAsync(new BrowserNewContextOptions { AcceptDownloads = true }).ConfigureAwait(false);
        var page = await context.NewPageAsync().ConfigureAwait(false);
        page.Dialog += OnDialog;

        try
        {
            emit("login", "running", $"Autenticando en {_device.Host}");
            var model = await LoginAsync(page).ConfigureAwait(false);
            if (model != request.Device.Model)
                throw new OnuProvisioningException($"Modelo no compatible: se esperaba {request.Device.Model} y se detecto {model}");
            emit("login", "success", $"Sesion tecnica iniciada en {model}");

            var identity = await ReadIdentityAsync(page).ConfigureAwait(false);
            emit("identity", "success", $"Serial GPON confirmado: {identity["serial"]}");

            var backups = new JsonObject { ["before"] = null, ["after"] = null };
            if (request.CreateBackups)
            {
                emit("backup_before", "running", "Creando respaldo antes de modificar");
                var before = await DownloadBackupAsync(page, "antes").ConfigureAwait(false);
                backups["before"] = before;
                emit("backup_before", before is null ? "warning" : "success",
                    before is null ? "El firmware no entrego el respaldo previo" : "Respaldo previo guardado");
            }

            var layer3 = request.ServiceMode == "router";
            var modeLabel = layer3 ? "Layer 3" : "Bridge";

            emit("lan_ports", "running", $"Preparando puertos LAN en modo {modeLabel}");
            var lanPorts = await ConfigureLanPortModeAsync(page, request.Wan.BindLanPorts, layer3).ConfigureAwait(false);
            emit("lan_ports", "success", $"Puertos LAN {modeLabel} listos: {string.Join(", ", BrowserJson.AsArray(lanPorts["requested"]).Select(item => item?.ToString()))}");

            var wanStage = layer3 ? "wan" : "bridge";
            emit(wanStage, "running", layer3 ? "Configurando IPoE, VLAN e IP estatica" : "Configurando bridge Ethernet y VLAN");
            var wan = await ConfigureWanAsync(page, request).ConfigureAwait(false);
            emit(wanStage, "success", $"Servicio {wan["connection_name"]} configurado");

            JsonObject? tr069 = null;
            if (layer3 && request.Tr069.Enabled)
            {
                emit("tr069", "running", "Configurando ACS y autenticacion TR-069");
                tr069 = await ConfigureTr069Async(page, request).ConfigureAwait(false);
                emit("tr069", "success", "ACS local y reporte periodico configurados");
            }

            JsonObject? wifi = null;
            if (layer3)
            {
                emit("wifi", "running", "Configurando SSID y seguridad WPA2");
                wifi = await ConfigureWifiAsync(page, request).ConfigureAwait(false);
                emit("wifi", "success", $"WiFi {wifi["ssid"]} configurado");
            }

            JsonObject? remoteAccess = null;
            if (layer3)
            {
                emit("remote", "running", "Aplicando control remoto HTTP restringido");
                remoteAccess = await ConfigureRemoteAccessAsync(page, request).ConfigureAwait(false);
                emit("remote", "success", $"HTTP permitido desde {remoteAccess["source"]}");
            }

            if (request.SaveConfiguration)
            {
                emit("save", "running", "Guardando configuracion en memoria permanente");
                await SaveConfigurationAsync(page).ConfigureAwait(false);
                emit("save", "success", "Configuracion guardada sin reiniciar");
            }

            emit("verify", "running", layer3 ? "Verificando WAN, WiFi y acceso remoto" : "Verificando bridge, VLAN y puertos LAN");
            var verification = await VerifyAsync(page, request).ConfigureAwait(false);
            emit("verify", "success", "Todos los valores coinciden con el perfil solicitado");

            var inventory = await ReadInventoryAsync(page, emit).ConfigureAwait(false);

            if (request.CreateBackups)
            {
                emit("backup_after", "running", "Creando respaldo final");
                var after = await DownloadBackupAsync(page, "configurada").ConfigureAwait(false);
                backups["after"] = after;
                emit("backup_after", after is null ? "warning" : "success",
                    after is null ? "El firmware no entrego el respaldo final" : "Respaldo final guardado");
            }

            return new JsonObject
            {
                ["model"] = model,
                ["host"] = request.Device.Host,
                ["serial"] = identity["serial"]?.DeepClone(),
                ["serial_raw"] = identity["serial_raw"]?.DeepClone(),
                ["authentication_mode"] = identity["authentication_mode"]?.DeepClone(),
                ["lan_ports"] = lanPorts,
                ["wan"] = wan,
                ["tr069"] = tr069,
                ["wifi"] = wifi,
                ["remote_access"] = remoteAccess,
                ["verification"] = verification,
                ["inventory"] = inventory,
                ["backups"] = backups,
            };
        }
        catch (Exception)
        {
            await CaptureFailureAsync(page).ConfigureAwait(false);
            throw;
        }
        finally
        {
            page.Dialog -= OnDialog;
            await context.CloseAsync().ConfigureAwait(false);
            await browser.CloseAsync().ConfigureAwait(false);
        }
    }

    // ─────────────────────────── Sesion ───────────────────────────

    private async Task<string> LoginAsync(IPage page)
    {
        var password = _device.Password ?? string.Empty;
        if (string.IsNullOrEmpty(password))
            throw new OnuProvisioningException("Falta la contrasena tecnica de la ONU en el agente local");

        try
        {
            await page.GotoAsync(_baseUrl, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 10000 }).ConfigureAwait(false);
            var initial = await LoginStatusAsync(page).ConfigureAwait(false);
            if (initial.LockLeft > 0)
                throw new OnuProvisioningException($"La ONU bloqueo temporalmente el acceso. Espera {initial.LockLeft} segundos.");

            await page.Locator("#txt_Username").FillAsync(_device.Username).ConfigureAwait(false);
            await page.Locator("#txt_Password").FillAsync(password).ConfigureAwait(false);
            await page.Locator("#loginbutton").ClickAsync().ConfigureAwait(false);
            await WaitForManagementPageAsync(page).ConfigureAwait(false);
        }
        catch (PlaywrightException exception)
        {
            var body = await SafeBodyTextAsync(page).ConfigureAwait(false);
            if (body.Contains("Incorrect User Name/Password"))
                throw new OnuProvisioningException("Usuario o contrasena incorrectos; la ONU puede bloquearse tras 3 intentos", innerException: exception);

            var status = await LoginStatusAsync(page).ConfigureAwait(false);
            if (status.LockLeft > 0)
                throw new OnuProvisioningException($"La ONU bloqueo temporalmente el acceso. Espera {status.LockLeft} segundos.", innerException: exception);
            if (status.LoginTimes > 0 || status.Failed)
                throw new OnuProvisioningException($"Credenciales rechazadas por la ONU (intento {status.LoginTimes} de {status.Limit}).", innerException: exception);

            throw new OnuProvisioningException(
                "La ONU acepto la conexion, pero mostro una pantalla no compatible. Revisa la captura de diagnostico.",
                innerException: exception);
        }

        var title = (await page.TitleAsync().ConfigureAwait(false)).Trim();
        return string.IsNullOrWhiteSpace(title) ? "EG8141A5" : title;
    }

    private sealed record LoginStatus(bool Failed, int LoginTimes, int LockLeft, int Limit);

    private static async Task<LoginStatus> LoginStatusAsync(IPage page)
    {
        try
        {
            var node = await BrowserJson.EvaluateNodeAsync(new PageScope(page), """
                () => ({
                    failed: String(globalThis.FailStat || '0') === '1',
                    login_times: Number(globalThis.LoginTimes || 0),
                    lock_left: Number(globalThis.LockLeftTime || 0),
                    limit: Number(globalThis.errloginlockNum || 3)
                })
                """).ConfigureAwait(false);
            var status = BrowserJson.AsObject(node);
            return new LoginStatus(
                status["failed"]?.GetValue<bool>() ?? false,
                (int)(status["login_times"]?.GetValue<double>() ?? 0),
                (int)(status["lock_left"]?.GetValue<double>() ?? 0),
                (int)(status["limit"]?.GetValue<double>() ?? 3));
        }
        catch (Exception)
        {
            return new LoginStatus(false, 0, 0, 3);
        }
    }

    private async Task WaitForManagementPageAsync(IPage page)
    {
        var deadline = Stopwatch.StartNew();
        var wizardClosed = false;
        while (deadline.Elapsed < TimeSpan.FromSeconds(12))
        {
            try
            {
                var advanced = page.GetByText("Advanced Configuration", new PageGetByTextOptions { Exact = true });
                if (await advanced.CountAsync().ConfigureAwait(false) == 1 && await advanced.IsVisibleAsync().ConfigureAwait(false))
                    return;

                var wizard = page.GetByText("Service Provisioning Method", new PageGetByTextOptions { Exact = true });
                if (!wizardClosed && await wizard.CountAsync().ConfigureAwait(false) == 1 && await wizard.IsVisibleAsync().ConfigureAwait(false))
                {
                    var exit = page.GetByRole(AriaRole.Button, new PageGetByRoleOptions { Name = "Exit", Exact = true });
                    if (await exit.CountAsync().ConfigureAwait(false) != 1 || !await exit.IsVisibleAsync().ConfigureAwait(false))
                        throw new OnuProvisioningException("La ONU mostro el asistente inicial, pero no permitio cerrarlo");
                    await exit.ClickAsync().ConfigureAwait(false);
                    wizardClosed = true;
                    await Task.Delay(800).ConfigureAwait(false);
                    continue;
                }

                var body = await SafeBodyTextAsync(page).ConfigureAwait(false);
                if (body.Contains("Incorrect User Name/Password"))
                    throw new OnuProvisioningException("Usuario o contrasena incorrectos; la ONU puede bloquearse tras 3 intentos");

                var status = await LoginStatusAsync(page).ConfigureAwait(false);
                if (status.LockLeft > 0)
                    throw new OnuProvisioningException($"La ONU bloqueo temporalmente el acceso. Espera {status.LockLeft} segundos.");
                await Task.Delay(200).ConfigureAwait(false);
            }
            catch (PlaywrightException exception) when (IsTransientNavigationError(exception))
            {
                try
                {
                    await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded, new PageWaitForLoadStateOptions { Timeout = 1000 }).ConfigureAwait(false);
                }
                catch (Exception timeout) when (PlaywrightErrors.IsTimeout(timeout))
                {
                    // La pagina sigue navegando: se reintenta en la proxima vuelta.
                }
                await Task.Delay(200).ConfigureAwait(false);
            }
        }
        throw new OnuProvisioningException(
            "La ONU acepto la conexion, pero su panel de administracion no aparecio. Revisa la captura de diagnostico.",
            "ONU_MANAGEMENT_PAGE_TIMEOUT");
    }

    internal static bool IsTransientNavigationError(Exception exception)
    {
        var message = exception.Message.ToLowerInvariant();
        return message.Contains("execution context was destroyed")
            || message.Contains("most likely because of a navigation")
            || message.Contains("cannot find context with specified id")
            || message.Contains("frame was detached");
    }

    private static async Task<string> SafeBodyTextAsync(IPage page)
    {
        try
        {
            return await page.Locator("body").InnerTextAsync(new LocatorInnerTextOptions { Timeout = 2000 }).ConfigureAwait(false);
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    // ─────────────────────────── Navegacion del panel ───────────────────────────

    private async Task OpenAdvancedAsync(IPage page)
    {
        var advanced = page.GetByText("Advanced Configuration", new PageGetByTextOptions { Exact = true });
        if (await advanced.CountAsync().ConfigureAwait(false) == 1 && await advanced.IsVisibleAsync().ConfigureAwait(false))
        {
            await advanced.ClickAsync().ConfigureAwait(false);
            await page.Locator("#menuIframe").WaitForAsync(new LocatorWaitForOptions
            {
                State = WaitForSelectorState.Attached,
                Timeout = 6000,
            }).ConfigureAwait(false);
        }
    }

    private static async Task<FrameScope> MenuFrameAsync(IPage page)
    {
        var deadline = Stopwatch.StartNew();
        while (deadline.Elapsed < TimeSpan.FromSeconds(7))
        {
            var handle = await page.Locator("#menuIframe").ElementHandleAsync().ConfigureAwait(false);
            if (handle is not null)
            {
                var frame = await handle.ContentFrameAsync().ConfigureAwait(false);
                if (frame is not null) return new FrameScope(frame);
            }
            await Task.Delay(150).ConfigureAwait(false);
        }
        throw new OnuProvisioningException("No se pudo abrir el panel interno de configuracion");
    }

    private static async Task ClickMenuAsync(IPage page, IReadOnlyList<string> selectors, string text)
    {
        foreach (var selector in selectors)
        {
            var locator = page.Locator(selector);
            if (await locator.CountAsync().ConfigureAwait(false) != 1 || !await locator.IsVisibleAsync().ConfigureAwait(false)) continue;
            await locator.ClickAsync().ConfigureAwait(false);
            await Task.Delay(250).ConfigureAwait(false);
            return;
        }

        var candidates = page.GetByText(text, new PageGetByTextOptions { Exact = true });
        var visible = new List<ILocator>();
        foreach (var candidate in await candidates.AllAsync().ConfigureAwait(false))
            if (await candidate.IsVisibleAsync().ConfigureAwait(false)) visible.Add(candidate);
        if (visible.Count != 1) throw new OnuProvisioningException($"El firmware no mostro el menu {text}");
        await visible[0].ClickAsync().ConfigureAwait(false);
        await Task.Delay(250).ConfigureAwait(false);
    }

    // ─────────────────────────── Lectura ───────────────────────────

    private async Task<JsonObject> ReadIdentityAsync(IPage page)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        return await ReadAuthenticationAsync(frame).ConfigureAwait(false);
    }

    private async Task<JsonObject> ReadAuthenticationAsync(IBrowserScope frame)
    {
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/amp/ontauth/passwordcommon.asp", 8000).ConfigureAwait(false);
            var serialField = frame.Locator("#SNValue");
            await serialField.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            var rawSerial = (await serialField.InputValueAsync().ConfigureAwait(false)).Trim().ToUpperInvariant();
            var method = await frame.Locator("input[name=\"rMethod\"]:checked").GetAttributeAsync("value").ConfigureAwait(false);

            return new JsonObject
            {
                ["serial"] = GponSerial.Normalize(rawSerial),
                ["serial_raw"] = rawSerial,
                ["authentication_mode"] = method == "1" ? "loid" : "sn_password",
            };
        }
        catch (Exception exception) when (exception is PlaywrightException or TimeoutException or FormatException)
        {
            throw new OnuProvisioningException("La ONU no expuso un serial GPON valido", innerException: exception);
        }
    }

    /// <summary>Lee todo lo que la ONU publica, sin devolver ninguna clave guardada.</summary>
    private async Task<JsonObject> ReadInventoryAsync(IPage page, ProgressCallback? emit)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        var errors = new JsonObject();

        void Report(string section, string message) => emit?.Invoke($"inventory_{section}", "success", message);

        var identity = await ReadAuthenticationAsync(frame).ConfigureAwait(false);

        var device = new JsonObject();
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/ssmp/deviceinfo/deviceinfo.asp", 8000).ConfigureAwait(false);
            await frame.Locator("#td3_2").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            device = BrowserJson.AsObject(await BrowserJson.EvaluateNodeAsync(frame, """
                () => {
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
                }
                """).ConfigureAwait(false));
            Report("device", "Modelo, firmware y estado GPON leidos");
        }
        catch (Exception)
        {
            errors["device"] = "Informacion del dispositivo no disponible";
        }

        var optical = new JsonObject();
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/amp/opticinfo/opticinfo.asp", 8000).ConfigureAwait(false);
            await frame.Locator("body").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            optical = BrowserJson.AsObject(await BrowserJson.EvaluateNodeAsync(frame, """
                () => {
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
                }
                """).ConfigureAwait(false));
            optical["signal_available"] = optical["rx_power_dbm"] is not null || optical["tx_power_dbm"] is not null;
            Report("optical", "Telemetria optica leida");
        }
        catch (Exception)
        {
            errors["optical"] = "Telemetria optica no disponible";
        }

        var wan = new JsonArray();
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/bbsp/waninfo/waninfo.asp", 8000).ConfigureAwait(false);
            await frame.Locator("body").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            wan = BrowserJson.AsArray(await BrowserJson.EvaluateNodeAsync(frame, """
                () => (globalThis.WanList || []).filter(Boolean).map((item) => ({
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
                }))
                """).ConfigureAwait(false));
            Report("wan", wan.Count == 1 ? "1 perfil WAN leido" : $"{wan.Count} perfiles WAN leidos");
        }
        catch (Exception)
        {
            errors["wan"] = "Configuracion WAN no disponible";
        }

        var ethernet = new JsonObject { ["mac"] = null, ["ports"] = new JsonArray() };
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/amp/ethinfo/ethinfo.asp", 8000).ConfigureAwait(false);
            await frame.Locator("body").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            ethernet = BrowserJson.AsObject(await BrowserJson.EvaluateNodeAsync(frame, """
                () => {
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
                }
                """).ConfigureAwait(false));
            Report("ethernet", "Estado de los puertos LAN leido");
        }
        catch (Exception)
        {
            errors["ethernet"] = "Estado Ethernet no disponible";
        }

        var wifi = new JsonObject { ["radios"] = new JsonArray(), ["clients"] = new JsonArray() };
        try
        {
            await frame.GotoAsync($"{_baseUrl}/html/amp/wlaninfo/wlaninfo.asp", 8000).ConfigureAwait(false);
            await frame.Locator("body").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
            wifi = BrowserJson.AsObject(await BrowserJson.EvaluateNodeAsync(frame, """
                () => {
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
                }
                """).ConfigureAwait(false));
            Report("wifi", "WiFi y estaciones conectadas leidos");
        }
        catch (Exception)
        {
            errors["wifi"] = "Estado WiFi no disponible";
        }

        var remoteAccess = new JsonObject { ["rules"] = new JsonArray() };
        try
        {
            var aclFrame = await OpenAclAsync(page).ConfigureAwait(false);
            var rows = await aclFrame.Locator("tr").AllInnerTextsAsync().ConfigureAwait(false);
            var rules = new JsonArray();
            foreach (var rule in ActualAclRows(rows).Take(32)) rules.Add(rule);
            remoteAccess = new JsonObject { ["rules"] = rules };
            Report("remote", "Reglas de administracion remota leidas");
        }
        catch (Exception)
        {
            errors["remote_access"] = "Control de acceso remoto no disponible";
        }

        return new JsonObject
        {
            ["collected_at"] = Storage.Clock.UtcNow(),
            ["source"] = "onu_local_read_only",
            ["identity"] = identity,
            ["device"] = device,
            ["optical"] = optical,
            ["wan"] = wan,
            ["ethernet"] = ethernet,
            ["wifi"] = wifi,
            ["remote_access"] = remoteAccess,
            ["errors"] = errors,
        };
    }

    // ─────────────────────────── Puertos LAN ───────────────────────────

    private async Task<FrameScope> OpenLanPortModeAsync(IPage page)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        await frame.GotoAsync($"{_baseUrl}/html/bbsp/layer3/layer3.asp", 8000).ConfigureAwait(false);
        await frame.Locator("#cb_Lan1").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
        return frame;
    }

    private static async Task<List<int>> EnabledLanPortsAsync(IBrowserScope frame)
    {
        var enabled = new List<int>();
        for (var port = 1; port <= 4; port++)
            if (await OnuControls.IsCheckedAsync(frame, $"#cb_Lan{port}").ConfigureAwait(false)) enabled.Add(port);
        return enabled;
    }

    private async Task<JsonObject> ConfigureLanPortModeAsync(IPage page, IReadOnlyList<int> requestedPorts, bool layer3)
    {
        var requested = requestedPorts.Distinct().OrderBy(port => port).ToList();
        var invalid = requested.Where(port => port is < 1 or > 4).ToList();
        if (invalid.Count > 0)
            throw new OnuProvisioningException($"Puertos LAN no compatibles: {string.Join(", ", invalid)}", "ONU_UNSUPPORTED_LAN_PORT", retryable: false);

        var frame = await OpenLanPortModeAsync(page).ConfigureAwait(false);
        var changed = new List<int>();
        foreach (var port in requested)
            if (await OnuControls.SetCheckedAsync(frame, $"#cb_Lan{port}", layer3, required: true).ConfigureAwait(false))
                changed.Add(port);

        if (changed.Count > 0)
        {
            ILocator? apply = null;
            foreach (var button in await frame.Locator("#Apply").AllAsync().ConfigureAwait(false))
            {
                if (!await button.IsVisibleAsync().ConfigureAwait(false) || !await button.IsEnabledAsync().ConfigureAwait(false)) continue;
                apply = button;
                break;
            }
            if (apply is null)
                throw new OnuProvisioningException(
                    "El firmware no mostro el boton para aplicar el modo de los puertos LAN",
                    "ONU_LAN_PORT_MODE_UNAVAILABLE", retryable: false);

            _dialogs.Clear();
            await apply.ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);
            await Task.Delay(800).ConfigureAwait(false);
            RaiseForDialogError("modo de puertos LAN");
            frame = await OpenLanPortModeAsync(page).ConfigureAwait(false);
        }

        var enabled = await EnabledLanPortsAsync(frame).ConfigureAwait(false);
        var missing = requested.Where(port => enabled.Contains(port) != layer3).ToList();
        if (missing.Count > 0)
            throw new OnuProvisioningException(
                $"La ONU no conservo LAN{string.Join(", LAN", missing)} en modo {(layer3 ? "Layer 3" : "Bridge")}",
                "ONU_LAN_PORT_MODE_NOT_APPLIED");

        return new JsonObject
        {
            ["requested"] = ToJsonArray(requested.Select(port => $"LAN{port}")),
            ["enabled"] = ToJsonArray(enabled.Select(port => $"LAN{port}")),
            ["mode"] = layer3 ? "router" : "bridge",
            ["changed"] = ToJsonArray(changed.Select(port => $"LAN{port}")),
        };
    }

    // ─────────────────────────── WAN ───────────────────────────

    private static string WanService(ProvisionRequest request) =>
        request.ServiceMode == "router" && request.Tr069.Enabled ? "TR069_INTERNET" : "INTERNET";

    internal static string WanConnectionName(ProvisionRequest request)
    {
        var mode = request.ServiceMode == "router" ? "R" : "B";
        return $"1_{WanService(request)}_{mode}_VID_{request.Wan.VlanId}";
    }

    private static async Task<bool> SelectWanConnectionAsync(IBrowserScope frame, string connectionName)
    {
        if (await OnuControls.ClickVisibleExactTextAsync(frame, connectionName).ConfigureAwait(false)) return true;

        var rows = frame.Locator("tr").Filter(new LocatorFilterOptions { HasText = connectionName });
        foreach (var row in await rows.AllAsync().ConfigureAwait(false))
        {
            if (!await row.IsVisibleAsync().ConfigureAwait(false)) continue;
            var cells = row.Locator("td");
            if (await cells.CountAsync().ConfigureAwait(false) > 1) await cells.Nth(1).ClickAsync().ConfigureAwait(false);
            else await row.ClickAsync().ConfigureAwait(false);
            return true;
        }
        return false;
    }

    internal static List<string> WanConnections(IEnumerable<string> rowTexts)
    {
        var names = new List<string>();
        var pattern = new Regex(@"\b\d+_[A-Z0-9_]+_[RB]_VID_\d+\b", RegexOptions.IgnoreCase);
        foreach (var row in rowTexts)
            foreach (Match match in pattern.Matches(row))
                if (!names.Contains(match.Value)) names.Add(match.Value);
        return names;
    }

    internal static string? CompatibleWanConnection(ProvisionRequest request, IReadOnlyList<string> names)
    {
        var suffix = $"_{(request.ServiceMode == "router" ? "R" : "B")}_VID_{request.Wan.VlanId}";
        var candidates = names.Where(name => name.ToUpperInvariant().EndsWith(suffix, StringComparison.Ordinal)).ToList();
        var desired = WanConnectionName(request);
        if (candidates.Contains(desired)) return desired;
        return candidates.FirstOrDefault(name => name.ToUpperInvariant().Contains("INTERNET"));
    }

    private async Task DeleteConflictingWanAsync(IBrowserScope frame, string name)
    {
        if (!await SelectWanConnectionAsync(frame, name).ConfigureAwait(false))
            throw new OnuProvisioningException("La WAN incompatible desaparecio antes de reemplazarla");

        var delete = frame.GetByRole(AriaRole.Button, "Delete");
        if (await delete.CountAsync().ConfigureAwait(false) != 1 ||
            !await delete.IsVisibleAsync().ConfigureAwait(false) ||
            !await delete.IsEnabledAsync().ConfigureAwait(false))
            throw new OnuProvisioningException(
                "El firmware no permite eliminar la WAN incompatible", "ONU_WAN_REPLACEMENT_UNAVAILABLE", retryable: false);

        _dialogs.Clear();
        await delete.ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);
        await Task.Delay(800).ConfigureAwait(false);
        RaiseForDialogError("reemplazo WAN");
    }

    private async Task<FrameScope> OpenWanAsync(IPage page)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        await ClickMenuAsync(page, new[] { "#name_wanconfig", "#wanconfig" }, "WAN Configuration").ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        await frame.GetByText("WAN Configuration").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 6000,
        }).ConfigureAwait(false);
        return frame;
    }

    private async Task<JsonObject> ConfigureWanAsync(IPage page, ProvisionRequest request)
    {
        var frame = await OpenWanAsync(page).ConfigureAwait(false);
        var desiredName = WanConnectionName(request);
        var connections = WanConnections(await frame.Locator("tr").AllInnerTextsAsync().ConfigureAwait(false));
        var name = CompatibleWanConnection(request, connections) ?? desiredName;
        var editingExisting = await SelectWanConnectionAsync(frame, name).ConfigureAwait(false);

        if (!editingExisting)
        {
            var suffix = $"_{(request.ServiceMode == "router" ? "R" : "B")}_VID_{request.Wan.VlanId}";
            var conflicts = connections
                .Where(candidate => candidate != name && candidate.ToUpperInvariant().EndsWith(suffix, StringComparison.Ordinal))
                .ToList();
            if (conflicts.Count > 0 && !request.ReplaceConflictingWan)
                throw new OnuProvisioningException(
                    $"La VLAN {request.Wan.VlanId} ya usa {conflicts[0]}. Confirma el reemplazo despues del respaldo.",
                    "ONU_WAN_REPLACEMENT_CONFIRMATION_REQUIRED");
            foreach (var conflict in conflicts) await DeleteConflictingWanAsync(frame, conflict).ConfigureAwait(false);

            var newButton = frame.GetByRole(AriaRole.Button, "New");
            await newButton.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 4000 }).ConfigureAwait(false);
            await newButton.ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);
        }

        await frame.Locator("#WanSwitch").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#WanSwitch", true, required: true).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#VlanSwitch", true, required: true).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#EncapMode1", true, required: true).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#ProtocolType", "IPv4", required: true).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#WanMode", request.ServiceMode == "router" ? "IP_Routed" : "IP_Bridged", required: true).ConfigureAwait(false);

        var service = WanService(request);
        if (editingExisting)
        {
            var existing = await OnuControls.InputValueAsync(frame, "#ServiceList").ConfigureAwait(false);
            if (existing is "INTERNET" or "TR069_INTERNET") service = existing;
        }
        await OnuControls.SelectAsync(frame, "#ServiceList", service, required: true).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#VlanId", request.Wan.VlanId.ToString()).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#PriorityPolicy", "Specified", required: true).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#DefaultVlanPriority", request.Wan.Priority.ToString()).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#VlanPriority", request.Wan.Priority.ToString(), required: true).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#IPv4MXU", request.Wan.Mtu.ToString()).ConfigureAwait(false);

        for (var port = 1; port <= 4; port++)
            await OnuControls.SetCheckedAsync(frame, $"#IPv4BindLanList{port}", request.Wan.BindLanPorts.Contains(port)).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#IPv4BindLanList9", request.Wan.BindSsid1).ConfigureAwait(false);

        if (request.ServiceMode == "router")
        {
            await OnuControls.SetCheckedAsync(frame, "#IPv4AddressMode1", true).ConfigureAwait(false);
            await OnuControls.SetCheckedAsync(frame, "#IPv4NatSwitch", request.Wan.NatEnabled).ConfigureAwait(false);
            await OnuControls.FillAsync(frame, "#IPv4IPAddress", request.Wan.IpAddress).ConfigureAwait(false);
            await OnuControls.FillAsync(frame, "#IPv4SubnetMask", request.Wan.SubnetMask).ConfigureAwait(false);
            await OnuControls.FillAsync(frame, "#IPv4DefaultGateway", request.Wan.Gateway).ConfigureAwait(false);
            await OnuControls.SetCheckedAsync(frame, "#IPv4DNSOverrideSwitch", true).ConfigureAwait(false);
            await OnuControls.FillAsync(frame, "#IPv4PrimaryDNSServer", request.Wan.PrimaryDns).ConfigureAwait(false);
            await OnuControls.FillAsync(frame, "#IPv4SecondaryDNSServer", request.Wan.SecondaryDns ?? string.Empty).ConfigureAwait(false);
        }
        else
        {
            await OnuControls.SetCheckedAsync(frame, "#IPv4NatSwitch", false).ConfigureAwait(false);
        }

        _dialogs.Clear();
        await frame.Locator("#ButtonApply").ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);
        await Task.Delay(800).ConfigureAwait(false);
        RaiseForDialogError("WAN");

        _configuredWanName = name;
        _configuredWanService = service;

        var bindings = request.Wan.BindLanPorts.Select(port => $"LAN{port}").ToList();
        if (request.Wan.BindSsid1) bindings.Add("SSID1");

        return new JsonObject
        {
            ["connection_name"] = name,
            ["service_mode"] = request.ServiceMode,
            ["service"] = service,
            ["vlan_id"] = request.Wan.VlanId,
            ["ip_address"] = request.ServiceMode == "router" ? request.Wan.IpAddress : null,
            ["gateway"] = request.Wan.Gateway,
            ["dns"] = new JsonArray(request.Wan.PrimaryDns, request.Wan.SecondaryDns ?? string.Empty),
            ["nat"] = request.Wan.NatEnabled,
            ["bindings"] = ToJsonArray(bindings),
            ["operation"] = editingExisting ? "updated" : "created",
        };
    }

    // ─────────────────────────── TR-069 ───────────────────────────

    private async Task<IPage> OpenTr069PageAsync(IPage page)
    {
        var tr069Page = await page.Context.NewPageAsync().ConfigureAwait(false);
        tr069Page.Dialog += OnDialog;
        await tr069Page.GotoAsync($"{_baseUrl}/html/ssmp/tr069/tr069.asp",
            new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 10000 }).ConfigureAwait(false);
        await tr069Page.Locator("#EnableCWMP").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Attached,
            Timeout = 6000,
        }).ConfigureAwait(false);
        return tr069Page;
    }

    private async Task<JsonObject> ConfigureTr069Async(IPage page, ProvisionRequest request)
    {
        var desired = request.Tr069;
        var password = desired.Password ?? string.Empty;
        var connectionRequestPassword = desired.ConnectionRequestPassword ?? string.Empty;
        if (string.IsNullOrEmpty(password) || string.IsNullOrEmpty(connectionRequestPassword))
            throw new OnuProvisioningException("Faltan las credenciales protegidas TR-069");

        var tr069Page = await OpenTr069PageAsync(page).ConfigureAwait(false);
        var scope = new PageScope(tr069Page);
        try
        {
            await OnuControls.SetCheckedAsync(scope, "#EnableCWMP", true).ConfigureAwait(false);
            await OnuControls.SetCheckedAsync(scope, "#PeriodicInformEnable", true).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#PeriodicInformInterval", desired.PeriodicInformInterval.ToString()).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#URL", desired.AcsUrl).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#Username", desired.Username).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#Password", password).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#ConnectionRequestUsername", desired.ConnectionRequestUsername).ConfigureAwait(false);
            await OnuControls.FillAsync(scope, "#ConnectionRequestPassword", connectionRequestPassword).ConfigureAwait(false);
            await OnuControls.SetCheckedAsync(scope, "#CertificateEnable", false).ConfigureAwait(false);

            _dialogs.Clear();
            await tr069Page.Locator("#ACSbtnApply").ClickAsync().ConfigureAwait(false);
            await Task.Delay(1000).ConfigureAwait(false);
            RaiseForDialogError("TR-069");
        }
        finally
        {
            tr069Page.Dialog -= OnDialog;
            await tr069Page.CloseAsync().ConfigureAwait(false);
        }

        return new JsonObject
        {
            ["enabled"] = true,
            ["acs_url"] = desired.AcsUrl,
            ["username"] = desired.Username,
            ["connection_request_username"] = desired.ConnectionRequestUsername,
            ["periodic_inform_interval"] = desired.PeriodicInformInterval,
            ["authentication_configured"] = true,
        };
    }

    // ─────────────────────────── WiFi ───────────────────────────

    private async Task<JsonObject> ConfigureWifiAsync(IPage page, ProvisionRequest request)
    {
        await ClickMenuAsync(page, new[] { "#name_wlanconfig", "#wlanconfig" }, "WLAN").ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        await frame.Locator("#wlSsid").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 6000 }).ConfigureAwait(false);

        await OnuControls.SetCheckedAsync(frame, "#wlEnbl", request.Wifi.Enabled).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#wlEnable", request.Wifi.Enabled).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#wlSsid", request.Wifi.Ssid).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#X_HW_AssociateNum", request.Wifi.MaxClients.ToString()).ConfigureAwait(false);
        // El firmware llama al control wlHide, pero lo que envia es SSIDAdvertisementEnabled:
        // marcado significa que el nombre de la red se ve.
        await OnuControls.SetCheckedAsync(frame, "#wlHide", request.Wifi.Broadcast, required: true).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#enableWmm", request.Wifi.WmmEnabled).ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#wlAuthMode", "wpa2-psk").ConfigureAwait(false);
        await OnuControls.SelectAsync(frame, "#wlEncryption", "AESEncryption").ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#hidewlWpaPsk", true).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#wlWpaPsk", request.Wifi.Password).ConfigureAwait(false);
        await OnuControls.FillAsync(frame, "#wlWpaGtkRekey", "3600").ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#wlWPSEnable", request.Wifi.WpsEnabled).ConfigureAwait(false);

        _dialogs.Clear();
        await frame.Locator("#btnApplySubmit").ClickAsync().ConfigureAwait(false);
        await Task.Delay(800).ConfigureAwait(false);
        RaiseForDialogError("WiFi");

        return new JsonObject
        {
            ["ssid"] = request.Wifi.Ssid,
            ["security"] = "WPA2-PSK/AES",
            ["broadcast"] = request.Wifi.Broadcast,
            ["wmm"] = request.Wifi.WmmEnabled,
            ["wps"] = request.Wifi.WpsEnabled,
        };
    }

    // ─────────────────────────── Acceso remoto ───────────────────────────

    private async Task<FrameScope> OpenAclAsync(IPage page)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        await ClickMenuAsync(page, new[] { "#name_securityconfig", "#securityconfig" }, "Security Configuration").ConfigureAwait(false);
        await ClickMenuAsync(page, new[] { "#wanacl" }, "WAN Access Control Configuration").ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        await frame.GetByText("WAN Access Control Configuration").WaitForAsync(new LocatorWaitForOptions
        {
            State = WaitForSelectorState.Visible,
            Timeout = 6000,
        }).ConfigureAwait(false);
        return frame;
    }

    internal static List<string> ActualAclRows(IEnumerable<string> rows) => rows
        .Select(row => Regex.Replace(row, @"\s+", " ").Trim())
        .Where(row =>
            Regex.IsMatch(row, @"\b\d+_[A-Z0-9_]+_[RB]_VID_\d+\b", RegexOptions.IgnoreCase) &&
            row.ToUpperInvariant().Contains("HTTP") &&
            Regex.IsMatch(row, @"\b(?:\d{1,3}\.){3}\d{1,3}(?:/\d{1,2})?\b"))
        .ToList();

    private async Task<JsonObject> ConfigureRemoteAccessAsync(IPage page, ProvisionRequest request)
    {
        var frame = await OpenAclAsync(page).ConfigureAwait(false);
        var name = _configuredWanName ?? WanConnectionName(request);
        var desired = request.RemoteAccess;

        var rows = ActualAclRows(await frame.Locator("tr").AllInnerTextsAsync().ConfigureAwait(false));
        var exact = rows.Any(row => row.Contains(name) && row.Contains("HTTP") && row.Contains(desired.Source) && row.Contains("Enable"));
        if (exact)
            return new JsonObject { ["wan"] = name, ["protocol"] = "HTTP", ["source"] = desired.Source, ["enabled"] = true };

        if (!await OnuControls.ClickVisibleExactTextAsync(frame, name).ConfigureAwait(false))
            await frame.GetByRole(AriaRole.Button, "New").ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);

        await frame.Locator("#WanAclEnable").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 5000 }).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#WanAclEnable", desired.Enabled, required: true).ConfigureAwait(false);

        var wanSelect = frame.Locator("#WanNameList");
        await wanSelect.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 4000 }).ConfigureAwait(false);
        var options = await wanSelect.Locator("option").EvaluateAllAsync<WanOption[]>(
            "options => options.map(option => ({ value: option.value, label: option.textContent.trim() }))").ConfigureAwait(false);
        var match = options.FirstOrDefault(option => option.Label == name);
        if (match is null) throw new OnuProvisioningException("La regla ACL no encontro la WAN configurada");

        await OnuControls.SelectAsync(frame, "#WanNameList", match.Value, required: true).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#cb_TELNET", false).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#cb_SSH", false).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#cb_HTTP", true).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#cb_FTP", false).ConfigureAwait(false);
        await OnuControls.SetCheckedAsync(frame, "#cb_ICMP", false).ConfigureAwait(false);

        if (await frame.Locator("#ip_0").CountAsync().ConfigureAwait(false) == 0)
        {
            await frame.GetByRole(AriaRole.Button, "Add").ClickAsync().ConfigureAwait(false);
            await frame.Locator("#ip_0").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Visible, Timeout = 4000 }).ConfigureAwait(false);
        }
        await OnuControls.FillAsync(frame, "#ip_0", desired.Source).ConfigureAwait(false);

        _dialogs.Clear();
        await frame.GetByRole(AriaRole.Button, "Apply").ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);
        await Task.Delay(800).ConfigureAwait(false);
        RaiseForDialogError("acceso remoto");

        var refreshed = await OpenAclAsync(page).ConfigureAwait(false);
        var appliedRows = ActualAclRows(await refreshed.Locator("tr").AllInnerTextsAsync().ConfigureAwait(false));
        var applied = appliedRows.Any(row =>
            row.Contains(name) && row.ToUpperInvariant().Contains("HTTP") &&
            row.Contains(desired.Source) && row.ToUpperInvariant().Contains("ENABLE"));
        if (!applied) throw new OnuProvisioningException("La ONU no confirmo la regla HTTP restringida");

        return new JsonObject { ["wan"] = name, ["protocol"] = "HTTP", ["source"] = desired.Source, ["enabled"] = desired.Enabled };
    }

    private sealed class WanOption
    {
        public string Value { get; set; } = string.Empty;
        public string Label { get; set; } = string.Empty;
    }

    // ─────────────────────────── Guardado, respaldo y verificacion ───────────────────────────

    private async Task SaveConfigurationAsync(IPage page)
    {
        await OpenAdvancedAsync(page).ConfigureAwait(false);
        await ClickMenuAsync(page, new[] { "#name_maintaininfo" }, "Maintenance Diagnosis").ConfigureAwait(false);
        await ClickMenuAsync(page, new[] { "#cfgconfig" }, "Configuration File Management").ConfigureAwait(false);
        var frame = await MenuFrameAsync(page).ConfigureAwait(false);
        _dialogs.Clear();
        await frame.GetByRole(AriaRole.Button, "Save").ClickAsync().ConfigureAwait(false);
        await Task.Delay(800).ConfigureAwait(false);
        RaiseForDialogError("guardado");
    }

    private async Task<string?> DownloadBackupAsync(IPage page, string suffix)
    {
        try
        {
            await OpenAdvancedAsync(page).ConfigureAwait(false);
            await ClickMenuAsync(page, new[] { "#name_maintaininfo" }, "Maintenance Diagnosis").ConfigureAwait(false);
            await ClickMenuAsync(page, new[] { "#cfgconfig" }, "Configuration File Management").ConfigureAwait(false);
            var frame = await MenuFrameAsync(page).ConfigureAwait(false);

            var download = await page.RunAndWaitForDownloadAsync(async () =>
            {
                await frame.GetByRole(AriaRole.Button, "Download Configuration File").ClickAsync().ConfigureAwait(false);
            }, new PageRunAndWaitForDownloadOptions { Timeout = 8000 }).ConfigureAwait(false);

            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var target = Path.Combine(_backupDir, $"EG8141A5-{_device.Host}-{stamp}-{suffix}.xml");
            await download.SaveAsAsync(target).ConfigureAwait(false);
            return target;
        }
        catch (Exception)
        {
            return null;
        }
    }

    private async Task<JsonObject> VerifyAsync(IPage page, ProvisionRequest request)
    {
        var frame = await OpenWanAsync(page).ConfigureAwait(false);
        var name = _configuredWanName ?? WanConnectionName(request);
        if (!await SelectWanConnectionAsync(frame, name).ConfigureAwait(false))
            throw new OnuProvisioningException("La conexion WAN no aparece despues de aplicar");

        if (request.ServiceMode == "bridge")
        {
            var bindings = new List<int>();
            for (var port = 1; port <= 4; port++)
                if (await OnuControls.IsCheckedAsync(frame, $"#IPv4BindLanList{port}").ConfigureAwait(false)) bindings.Add(port);

            var mode = await OnuControls.InputValueAsync(frame, "#WanMode").ConfigureAwait(false);
            var service = await OnuControls.InputValueAsync(frame, "#ServiceList").ConfigureAwait(false);
            var vlan = await OnuControls.InputValueAsync(frame, "#VlanId").ConfigureAwait(false);
            var nat = await OnuControls.IsCheckedAsync(frame, "#IPv4NatSwitch").ConfigureAwait(false);

            var mismatch = mode != "IP_Bridged" || service != "INTERNET" || vlan != request.Wan.VlanId.ToString()
                || nat || !bindings.SequenceEqual(request.Wan.BindLanPorts);
            if (mismatch)
                throw new OnuProvisioningException(
                    $"Verificacion Bridge fallo: modo={mode}, servicio={service}, vlan={vlan}, nat={nat}, puertos={string.Join(",", bindings)}");

            return new JsonObject { ["bridge"] = true, ["vlan"] = true, ["lan_ports"] = true, ["ip_host_absent"] = true };
        }

        await frame.Locator("#IPv4IPAddress").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);

        var actualBindings = new List<int>();
        for (var port = 1; port <= 4; port++)
            if (await OnuControls.IsCheckedAsync(frame, $"#IPv4BindLanList{port}").ConfigureAwait(false)) actualBindings.Add(port);

        var values = new
        {
            Service = await OnuControls.InputValueAsync(frame, "#ServiceList").ConfigureAwait(false),
            Vlan = await OnuControls.InputValueAsync(frame, "#VlanId").ConfigureAwait(false),
            Ip = await OnuControls.InputValueAsync(frame, "#IPv4IPAddress").ConfigureAwait(false),
            Mask = await OnuControls.InputValueAsync(frame, "#IPv4SubnetMask").ConfigureAwait(false),
            Gateway = await OnuControls.InputValueAsync(frame, "#IPv4DefaultGateway").ConfigureAwait(false),
            Dns = await OnuControls.InputValueAsync(frame, "#IPv4PrimaryDNSServer").ConfigureAwait(false),
            Nat = await OnuControls.IsCheckedAsync(frame, "#IPv4NatSwitch").ConfigureAwait(false),
            Ssid1 = await OnuControls.IsCheckedAsync(frame, "#IPv4BindLanList9").ConfigureAwait(false),
        };

        var expectedService = _configuredWanService ?? WanService(request);
        var wanMismatch = values.Service != expectedService
            || values.Vlan != request.Wan.VlanId.ToString()
            || values.Ip != request.Wan.IpAddress
            || values.Mask != request.Wan.SubnetMask
            || values.Gateway != request.Wan.Gateway
            || values.Dns != request.Wan.PrimaryDns
            || values.Nat != request.Wan.NatEnabled
            || values.Ssid1 != request.Wan.BindSsid1
            || !actualBindings.SequenceEqual(request.Wan.BindLanPorts);
        if (wanMismatch)
            throw new OnuProvisioningException(
                $"Verificacion WAN fallo: servicio={values.Service}, vlan={values.Vlan}, ip={values.Ip}, mascara={values.Mask}, " +
                $"gateway={values.Gateway}, dns={values.Dns}, nat={values.Nat}, puertos={string.Join(",", actualBindings)}, ssid1={values.Ssid1}");

        var tr069Ok = !request.Tr069.Enabled || await VerifyTr069Async(page, request).ConfigureAwait(false);

        await ClickMenuAsync(page, new[] { "#name_wlanconfig", "#wlanconfig" }, "WLAN").ConfigureAwait(false);
        var wifiFrame = await MenuFrameAsync(page).ConfigureAwait(false);
        await wifiFrame.Locator("#wlSsid").WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 5000 }).ConfigureAwait(false);

        var enabled = await wifiFrame.Locator("#wlEnbl").CountAsync().ConfigureAwait(false) == 1
            ? await OnuControls.IsCheckedAsync(wifiFrame, "#wlEnbl").ConfigureAwait(false)
            : await OnuControls.IsCheckedAsync(wifiFrame, "#wlEnable").ConfigureAwait(false);

        var wifiValues = new
        {
            Ssid = await OnuControls.InputValueAsync(wifiFrame, "#wlSsid").ConfigureAwait(false),
            Enabled = enabled,
            MaxClients = await OnuControls.InputValueAsync(wifiFrame, "#X_HW_AssociateNum").ConfigureAwait(false),
            Broadcast = await OnuControls.IsCheckedAsync(wifiFrame, "#wlHide").ConfigureAwait(false),
            Wmm = await OnuControls.IsCheckedAsync(wifiFrame, "#enableWmm").ConfigureAwait(false),
            Authentication = await OnuControls.InputValueAsync(wifiFrame, "#wlAuthMode").ConfigureAwait(false),
            Encryption = await OnuControls.InputValueAsync(wifiFrame, "#wlEncryption").ConfigureAwait(false),
            Wps = await OnuControls.IsCheckedAsync(wifiFrame, "#wlWPSEnable").ConfigureAwait(false),
        };

        var wifiMismatch = wifiValues.Ssid != request.Wifi.Ssid
            || wifiValues.Enabled != request.Wifi.Enabled
            || wifiValues.MaxClients != request.Wifi.MaxClients.ToString()
            || wifiValues.Broadcast != request.Wifi.Broadcast
            || wifiValues.Wmm != request.Wifi.WmmEnabled
            || wifiValues.Authentication != "wpa2-psk"
            || wifiValues.Encryption != "AESEncryption"
            || wifiValues.Wps != request.Wifi.WpsEnabled;
        if (wifiMismatch)
            throw new OnuProvisioningException(
                $"Verificacion WiFi fallo: ssid={wifiValues.Ssid}, encendido={wifiValues.Enabled}, equipos={wifiValues.MaxClients}, " +
                $"visible={wifiValues.Broadcast}, wmm={wifiValues.Wmm}, seguridad={wifiValues.Authentication}/{wifiValues.Encryption}, wps={wifiValues.Wps}");

        var aclFrame = await OpenAclAsync(page).ConfigureAwait(false);
        var aclRows = ActualAclRows(await aclFrame.Locator("tr").AllInnerTextsAsync().ConfigureAwait(false));
        var aclOk = aclRows.Any(row =>
            row.Contains(name) && row.Contains("HTTP") && row.Contains(request.RemoteAccess.Source) &&
            (!request.RemoteAccess.Enabled || row.Contains("Enable")));
        if (!aclOk) throw new OnuProvisioningException("La regla HTTP restringida no aparece en la tabla WAN ACL");

        return new JsonObject { ["wan"] = true, ["tr069"] = tr069Ok, ["wifi"] = true, ["remote_access"] = true };
    }

    private async Task<bool> VerifyTr069Async(IPage page, ProvisionRequest request)
    {
        var tr069Page = await OpenTr069PageAsync(page).ConfigureAwait(false);
        var scope = new PageScope(tr069Page);
        try
        {
            var desired = request.Tr069;
            var actual = new
            {
                Enabled = await OnuControls.IsCheckedAsync(scope, "#EnableCWMP").ConfigureAwait(false),
                Periodic = await OnuControls.IsCheckedAsync(scope, "#PeriodicInformEnable").ConfigureAwait(false),
                Interval = await OnuControls.InputValueAsync(scope, "#PeriodicInformInterval").ConfigureAwait(false),
                Url = await OnuControls.InputValueAsync(scope, "#URL").ConfigureAwait(false),
                Username = await OnuControls.InputValueAsync(scope, "#Username").ConfigureAwait(false),
                ConnectionRequestUsername = await OnuControls.InputValueAsync(scope, "#ConnectionRequestUsername").ConfigureAwait(false),
                Certificate = await OnuControls.IsCheckedAsync(scope, "#CertificateEnable").ConfigureAwait(false),
            };

            var mismatch = !actual.Enabled || !actual.Periodic
                || actual.Interval != desired.PeriodicInformInterval.ToString()
                || actual.Url != desired.AcsUrl
                || actual.Username != desired.Username
                || actual.ConnectionRequestUsername != desired.ConnectionRequestUsername
                || actual.Certificate;
            if (mismatch)
                throw new OnuProvisioningException(
                    $"Verificacion TR-069 fallo: activo={actual.Enabled}, periodico={actual.Periodic}, intervalo={actual.Interval}, " +
                    $"url={actual.Url}, usuario={actual.Username}, conexion={actual.ConnectionRequestUsername}, certificado={actual.Certificate}");
            return true;
        }
        finally
        {
            tr069Page.Dialog -= OnDialog;
            await tr069Page.CloseAsync().ConfigureAwait(false);
        }
    }

    // ─────────────────────────── Dialogos y diagnostico ───────────────────────────

    private void OnDialog(object? sender, IDialog dialog)
    {
        _dialogs.Add(dialog.Message ?? string.Empty);
        _ = dialog.DismissAsync();
    }

    private void RaiseForDialogError(string step)
    {
        var errors = _dialogs
            .Where(message => Regex.IsMatch(message, "invalid|incorrect|error|fail|required|must", RegexOptions.IgnoreCase))
            .ToList();
        if (errors.Count > 0)
            throw new OnuProvisioningException($"El firmware rechazo {step}: {errors[^1]}");
    }

    private async Task CaptureFailureAsync(IPage page)
    {
        try
        {
            Directory.CreateDirectory(_backupDir);
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            await page.ScreenshotAsync(new PageScreenshotOptions
            {
                Path = Path.Combine(_backupDir, $"error-{stamp}.png"),
                FullPage = true,
            }).ConfigureAwait(false);
            await File.WriteAllTextAsync(
                Path.Combine(_backupDir, $"error-{stamp}.html"),
                await page.ContentAsync().ConfigureAwait(false)).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // El diagnostico es opcional: nunca debe tapar el error real.
        }
    }

    internal static JsonArray ToJsonArray(IEnumerable<string> values)
    {
        var array = new JsonArray();
        foreach (var value in values) array.Add(value);
        return array;
    }
}
