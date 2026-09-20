using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Playwright;
using OnuStudio.Core.Models;

namespace OnuStudio.Core.Onu;

/// <summary>
/// Controlador certificado para la ZTE F670L V7.1. Este firmware invalida la ruta
/// de administracion despues de cada lectura, por eso renueva la sesion en cada
/// modulo, y cada cambio se comprueba leyendo otra vez.
/// </summary>
public sealed class ZteF670L : IOnuController
{
    internal static readonly IReadOnlyDictionary<string, string> AuditPages = new Dictionary<string, string>
    {
        ["device"] = "status_dev_info_t.gch",
        ["wan_status"] = "IPv46_status_wan2_if_t.gch",
        ["pon_status"] = "pon_status_link_info_t.gch",
        ["wifi24_status"] = "status_wlanm_info1_t.gch",
        ["wifi5_status"] = "status_wlanm_info2_t.gch",
        ["ethernet_status"] = "pon_status_lan_info_t.gch",
        ["wan"] = "IPv46_net_wan2_conf_t.gch",
        ["port_binding"] = "net_portbind_conf_t.gch",
        ["wifi_common"] = "net_wlanm_off_t.gch",
        ["wifi24"] = "net_wlanm_conf1_t.gch",
        ["wifi24_ssid"] = "net_wlanm_essid1_t.gch",
        ["wifi24_security"] = "net_wlanm_secrity1_t.gch",
        ["wifi24_clients"] = "net_wlanm_assoc1_t.gch",
        ["wifi24_wps"] = "net_wlanm_wps1_t.gch",
        ["wifi5"] = "net_wlanm_conf2_t.gch",
        ["wifi5_ssid"] = "net_wlanm_essid2_t.gch",
        ["wifi5_security"] = "net_wlanm_secrity2_t.gch",
        ["wifi5_clients"] = "net_wlanm_assoc2_t.gch",
        ["wifi5_wps"] = "net_wlanm_wps2_t.gch",
        ["lan"] = "net_dhcp_dynamic_t.gch",
        ["pon"] = "pon_net_ponloid_t.gch",
        ["firewall"] = "sec_firewall_conf_t.gch",
        ["ip_filter"] = "sec_portfilter_conf_t.gch",
        ["mac_filter"] = "sec_macfilter_conf_t.gch",
        ["url_filter"] = "sec_url_filter_t.gch",
        ["service_control"] = "sec_sc_t.gch",
        ["alg"] = "sec_fw_alg_t.gch",
        ["dmz"] = "app_dmz_conf_t.gch",
        ["upnp"] = "app_upnp_conf_t.gch",
        ["port_forward"] = "app_virtual_conf_t.gch",
        ["sntp"] = "net_sntp_conf_t.gch",
        ["tr069"] = "net_tr069_basic_t.gch",
        ["users"] = "manager_aduser_conf_t.gch",
        ["logs"] = "manager_log_conf_t.gch",
        ["ipv6"] = "manager_ipv6_switch_t.gch",
    };

    private static readonly IReadOnlyDictionary<string, string> ExpectedControls = new Dictionary<string, string>
    {
        ["wan"] = "#Frm_WANCName0",
        ["wifi_common"] = "#Frm_Enable",
        ["wifi24"] = "#Frm_RadioStatus",
        ["wifi24_ssid"] = "#Frm_ESSID",
        ["wifi24_security"] = "#Frm_Authentication",
        ["wifi24_wps"] = "#Frm_WPSMode",
        ["wifi5"] = "#Frm_RadioStatus",
        ["wifi5_ssid"] = "#Frm_ESSID",
        ["wifi5_security"] = "#Frm_Authentication",
        ["wifi5_wps"] = "#Frm_WPSMode",
        ["lan"] = "#Frm_BasicIPAddr",
        ["pon"] = "#Frm_PonLoid",
        ["firewall"] = "#Frm_level_low",
        ["sntp"] = "#Frm_LocalTimeZoneandName",
        ["tr069"] = "#Frm_URL",
    };

    private readonly DeviceSettings _device;
    private readonly string _backupDir;
    private readonly int? _adapterIndex;
    private string? _baseUrl;

    public ZteF670L(DeviceSettings device, string backupDir, int? adapterIndex = null)
    {
        _device = device;
        _backupDir = backupDir;
        _adapterIndex = adapterIndex;
    }

    private bool NeedsBridge => _device.Host.Contains(':');

    private LinkLocalHttpBridge? CreateBridge()
    {
        if (!NeedsBridge) return null;
        if (_adapterIndex is null or <= 0)
            throw new OnuProvisioningException(
                "La ZTE F670L por IPv6 requiere seleccionar la tarjeta Ethernet", "ZTE_ADAPTER_REQUIRED");
        return new LinkLocalHttpBridge(_device.Host, _adapterIndex.Value);
    }

    // ─────────────────────────── Operaciones publicas ───────────────────────────

    public async Task<JsonObject> CheckAsync(ProgressCallback emit, CancellationToken cancellationToken = default)
    {
        emit("login", "running", "Abriendo el panel ZTE F670L");
        await BrowserLauncher.EnsureInstalledAsync(message => emit("login", "running", message), cancellationToken).ConfigureAwait(false);

        using var bridge = CreateBridge();
        _baseUrl = bridge?.Url ?? $"http://{_device.Host}";

        using var playwright = await Playwright.CreateAsync().ConfigureAwait(false);
        var browser = await BrowserLauncher.LaunchAsync(playwright).ConfigureAwait(false);
        var context = await browser.NewContextAsync().ConfigureAwait(false);
        var page = await context.NewPageAsync().ConfigureAwait(false);

        try
        {
            await LoginAsync(page, _baseUrl).ConfigureAwait(false);
            emit("login", "success", "Sesion tecnica iniciada en ZTE F670L");

            var snapshot = await CollectInventoryAsync(page, _baseUrl).ConfigureAwait(false);
            var inventory = BuildInventory(snapshot);
            var identity = BrowserJson.AsObject(inventory["identity"]);
            var serial = identity["serial"]?.GetValue<string>();

            emit("identity", serial is null ? "warning" : "success",
                serial is null
                    ? "Sesion valida; el firmware no mostro el serial en las vistas de estado"
                    : $"Serial GPON detectado: {serial}");

            return new JsonObject
            {
                ["model"] = "F670L",
                ["host"] = _device.Host,
                ["authenticated"] = true,
                ["supports_provisioning"] = true,
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

        var changed = false;
        string? backupBefore = null;

        using var bridge = CreateBridge();
        var baseUrl = bridge?.Url ?? $"http://{_device.Host}";
        _baseUrl = baseUrl;

        using var playwright = await Playwright.CreateAsync().ConfigureAwait(false);
        var browser = await BrowserLauncher.LaunchAsync(playwright).ConfigureAwait(false);
        var context = await browser.NewContextAsync(new BrowserNewContextOptions { AcceptDownloads = true }).ConfigureAwait(false);
        var page = await context.NewPageAsync().ConfigureAwait(false);

        try
        {
            emit("login", "running", "Abriendo el panel ZTE F670L");
            await LoginAsync(page, baseUrl).ConfigureAwait(false);
            emit("login", "success", "Sesion tecnica iniciada en ZTE F670L");

            // El preflight solo necesita identidad y firmware. Leer todas las vistas
            // agota las sesiones cortas de este firmware antes del respaldo protegido.
            var inventoryBefore = BuildInventory(
                await CollectInventoryAsync(page, baseUrl, new[] { "device", "pon_status" }).ConfigureAwait(false));

            var firmware = BrowserJson.AsObject(inventoryBefore["device"])["software_version"]?.GetValue<string>() ?? string.Empty;
            if (!firmware.StartsWith("V7.1.10P1T1", StringComparison.Ordinal))
                throw new OnuProvisioningException(
                    $"Firmware ZTE no certificado para escritura: {(string.IsNullOrWhiteSpace(firmware) ? "desconocido" : firmware)}",
                    "ZTE_FIRMWARE_NOT_CERTIFIED", retryable: false);

            var identity = BrowserJson.AsObject(inventoryBefore["identity"]);
            emit("identity", "success", $"Serial GPON confirmado: {identity["serial"]?.GetValue<string>() ?? "no informado"}");

            if (request.CreateBackups)
            {
                emit("backup_before", "running", "Guardando configuracion antes de modificar");
                backupBefore = await DownloadBackupAsync(page, "antes").ConfigureAwait(false);
                emit("backup_before", "success", "Respaldo previo guardado");
            }

            if (request.ReplaceConflictingWan && backupBefore is null)
                throw new OnuProvisioningException(
                    "Limpiar todas las WAN requiere guardar primero un respaldo de la ONU",
                    "ZTE_WAN_REPLACE_REQUIRES_BACKUP", retryable: false);

            var routed = request.ServiceMode == "router";
            var wanStage = routed ? "wan" : "bridge";
            emit(wanStage, "running", routed ? "Configurando WAN, VLAN e IP estatica" : "Configurando bridge Ethernet y VLAN");
            // A partir de aqui un reemplazo destructivo ya pudo borrar un perfil
            // aunque la creacion de la WAN falle antes de devolver.
            changed = changed || request.ReplaceConflictingWan;
            var wan = await ConfigureWanAsync(page, request).ConfigureAwait(false);
            changed = changed || (wan["changed"]?.GetValue<bool>() ?? false);
            emit(wanStage, "success", $"Servicio {wan["name"]} verificado en VLAN {request.Wan.VlanId}");

            emit("lan_ports", "running", "Vinculando LAN y WiFi a la WAN");
            var binding = await ConfigurePortBindingAsync(page, request, wan).ConfigureAwait(false);
            changed = changed || (binding["changed"]?.GetValue<bool>() ?? false);
            emit("lan_ports", "success", "Puertos LAN y radios WiFi vinculados");

            JsonObject? tr069 = null;
            if (routed && request.Tr069.Enabled)
            {
                emit("tr069", "running", "Configurando ACS TR-069");
                tr069 = await ConfigureTr069Async(page, request, wan).ConfigureAwait(false);
                changed = changed || (tr069["changed"]?.GetValue<bool>() ?? false);
                emit("tr069", "success", "ACS, credenciales e Inform periodico verificados");
            }

            JsonObject? wifi = null;
            if (routed)
            {
                emit("wifi", "running", "Configurando WiFi 2.4 y 5 GHz con WPA2-AES");
                wifi = await ConfigureWifiAsync(page, request).ConfigureAwait(false);
                changed = changed || (wifi["changed"]?.GetValue<bool>() ?? false);
                emit("wifi", "success", $"WiFi dual {wifi["ssid"]} verificado");
            }

            JsonObject? time = null;
            if (routed)
            {
                emit("time", "running", "Configurando hora y servidores NTP");
                time = await ConfigureTimeAsync(page).ConfigureAwait(false);
                changed = changed || (time["changed"]?.GetValue<bool>() ?? false);
                emit("time", "success", "Zona horaria y NTP verificados");
            }

            JsonObject? remote = null;
            if (routed && request.RemoteAccess.Enabled)
            {
                emit("remote", "running", "Creando acceso HTTP restringido");
                remote = await ConfigureRemoteAccessAsync(page, request, wan).ConfigureAwait(false);
                changed = changed || (remote["changed"]?.GetValue<bool>() ?? false);
                emit("remote", "success", $"HTTP restringido a {request.RemoteAccess.Source}");
            }

            emit("verify", "running", "Leyendo nuevamente toda la configuracion");
            var verification = await VerifyAsync(page, request, wan).ConfigureAwait(false);

            string? backupAfter = null;
            if (request.CreateBackups)
            {
                emit("backup_after", "running", "Guardando configuracion final");
                backupAfter = await DownloadBackupAsync(page, "configurada").ConfigureAwait(false);
                emit("backup_after", "success", "Respaldo final guardado");
            }

            var inventoryAfter = BuildInventory(await CollectInventoryAsync(page, baseUrl).ConfigureAwait(false));
            emit("verify", "success", routed ? "WAN, WiFi, TR-069, NTP y ACL coinciden" : "Bridge, VLAN y puertos LAN coinciden");

            return new JsonObject
            {
                ["model"] = "F670L",
                ["host"] = request.Device.Host,
                ["serial"] = identity["serial"]?.DeepClone(),
                ["serial_raw"] = identity["serial_raw"]?.DeepClone(),
                ["authentication_mode"] = identity["authentication_mode"]?.DeepClone(),
                ["wan"] = wan,
                ["lan_ports"] = binding,
                ["tr069"] = tr069,
                ["wifi"] = wifi,
                ["time"] = time,
                ["remote_access"] = remote,
                ["verification"] = verification,
                ["inventory"] = inventoryAfter,
                ["backups"] = new JsonObject { ["before"] = backupBefore, ["after"] = backupAfter },
            };
        }
        catch (Exception exception)
        {
            await CaptureFailureAsync(page).ConfigureAwait(false);
            if (changed && backupBefore is not null)
            {
                emit("rollback", "running", "Restaurando el respaldo previo por seguridad");
                try
                {
                    await RestoreBackupAsync(page, baseUrl, backupBefore).ConfigureAwait(false);
                    emit("rollback", "success", "Configuracion anterior restaurada");
                }
                catch (Exception rollbackException)
                {
                    emit("rollback", "error", $"No se pudo restaurar automaticamente: {rollbackException.Message}");
                }
            }
            if (exception is OnuProvisioningException) throw;
            var first = exception.Message.Split('\n')[0];
            throw new OnuProvisioningException($"La ZTE rechazo la configuracion: {first}", "ZTE_CONFIGURATION_FAILED", innerException: exception);
        }
        finally
        {
            await context.CloseAsync().ConfigureAwait(false);
            await browser.CloseAsync().ConfigureAwait(false);
        }
    }

    // ─────────────────────────── Sesion ───────────────────────────

    private async Task LoginAsync(IPage page, string baseUrl)
    {
        var password = _device.Password ?? string.Empty;
        if (string.IsNullOrEmpty(password))
            throw new OnuProvisioningException(
                "Ingresa el usuario y la contrasena impresos en la etiqueta de la ZTE F670L",
                "ZTE_CREDENTIALS_REQUIRED", retryable: false);

        try
        {
            await page.GotoAsync(baseUrl, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 10000 }).ConfigureAwait(false);
            if (await page.Locator("#Frm_Username").CountAsync().ConfigureAwait(false) != 1 ||
                await page.Locator("#Frm_Password").CountAsync().ConfigureAwait(false) != 1)
                throw new OnuProvisioningException(
                    "El panel detectado no corresponde al firmware ZTE F670L esperado",
                    "ZTE_LOGIN_FORM_MISMATCH", retryable: false);

            await page.Locator("#Frm_Username").FillAsync(_device.Username).ConfigureAwait(false);
            await page.Locator("#Frm_Password").FillAsync(password).ConfigureAwait(false);
            await page.Locator("#LoginId").ClickAsync(new LocatorClickOptions { Timeout = 4000 }).ConfigureAwait(false);

            var deadline = DateTime.UtcNow.AddSeconds(12);
            while (DateTime.UtcNow < deadline)
            {
                string body;
                try
                {
                    body = await page.Locator("body").InnerTextAsync(new LocatorInnerTextOptions { Timeout = 1500 }).ConfigureAwait(false);
                }
                catch (PlaywrightException)
                {
                    await page.WaitForTimeoutAsync(250).ConfigureAwait(false);
                    continue;
                }

                if (Regex.IsMatch(body, "User information is error|username or password.*(?:error|incorrect|invalid)", RegexOptions.IgnoreCase))
                    throw new OnuProvisioningException(
                        "La ZTE F670L rechazo el usuario o la contrasena; usa los datos de su etiqueta",
                        "ZTE_CREDENTIALS_REJECTED", retryable: false);

                if (await page.Locator("#Frm_Username").CountAsync().ConfigureAwait(false) == 0 &&
                    !Regex.IsMatch(body, "Please login to continue", RegexOptions.IgnoreCase))
                    return;

                await page.WaitForTimeoutAsync(250).ConfigureAwait(false);
            }
        }
        catch (PlaywrightException exception)
        {
            throw new OnuProvisioningException(
                "La ZTE F670L respondio, pero no completo el inicio de sesion", "ZTE_LOGIN_TIMEOUT", innerException: exception);
        }

        throw new OnuProvisioningException("La ZTE F670L no abandono la pantalla de acceso", "ZTE_LOGIN_NOT_COMPLETED");
    }

    // ─────────────────────────── Lectura de paginas ───────────────────────────

    internal sealed class ZteControl
    {
        public string Type { get; set; } = string.Empty;
        public string Value { get; set; } = string.Empty;
        public bool Checked { get; set; }
        public bool Disabled { get; set; }
        public List<string> Selected { get; set; } = new();
    }

    internal sealed class ZteSnapshot
    {
        public Dictionary<string, string> Pairs { get; } = new();
        public List<List<string>> Rows { get; } = new();
        public Dictionary<string, ZteControl> Controls { get; } = new();
        public string Text { get; set; } = string.Empty;
    }

    private const string SnapshotScript = """
        () => {
            const visible = (el) => Boolean(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
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
        }
        """;

    private static async Task<ZteSnapshot> PageSnapshotAsync(IPage page)
    {
        var result = new ZteSnapshot();
        var texts = new List<string>();

        foreach (var frame in page.Frames)
        {
            JsonElement element;
            try
            {
                element = await frame.EvaluateAsync<JsonElement>(SnapshotScript).ConfigureAwait(false);
            }
            catch (PlaywrightException)
            {
                continue;
            }

            if (element.ValueKind != JsonValueKind.Object) continue;

            if (element.TryGetProperty("pairs", out var pairs) && pairs.ValueKind == JsonValueKind.Object)
                foreach (var pair in pairs.EnumerateObject())
                    result.Pairs[pair.Name] = pair.Value.ValueKind == JsonValueKind.String ? pair.Value.GetString() ?? string.Empty : pair.Value.ToString();

            if (element.TryGetProperty("rows", out var rows) && rows.ValueKind == JsonValueKind.Array)
                foreach (var row in rows.EnumerateArray())
                    result.Rows.Add(row.EnumerateArray().Select(cell => cell.GetString() ?? string.Empty).ToList());

            if (element.TryGetProperty("controls", out var controls) && controls.ValueKind == JsonValueKind.Object)
                foreach (var control in controls.EnumerateObject())
                    result.Controls[control.Name] = ReadControl(control.Value);

            if (element.TryGetProperty("text", out var text) && text.ValueKind == JsonValueKind.String)
            {
                var value = text.GetString();
                if (!string.IsNullOrWhiteSpace(value)) texts.Add(value);
            }
        }

        result.Text = string.Join("\n", texts);
        return result;

        static ZteControl ReadControl(JsonElement element) => new()
        {
            Type = element.TryGetProperty("type", out var type) ? type.GetString() ?? string.Empty : string.Empty,
            Value = element.TryGetProperty("value", out var value) ? value.GetString() ?? string.Empty : string.Empty,
            Checked = element.TryGetProperty("checked", out var isChecked) && isChecked.ValueKind == JsonValueKind.True,
            Disabled = element.TryGetProperty("disabled", out var disabled) && disabled.ValueKind == JsonValueKind.True,
            Selected = element.TryGetProperty("selected", out var selected) && selected.ValueKind == JsonValueKind.Array
                ? selected.EnumerateArray().Select(item => item.GetString() ?? string.Empty).ToList()
                : new List<string>(),
        };
    }

    internal sealed class InventorySnapshot
    {
        public Dictionary<string, ZteSnapshot> Pages { get; } = new();
        public Dictionary<string, string> Errors { get; } = new();
    }

    private async Task<InventorySnapshot> CollectInventoryAsync(IPage page, string baseUrl, IReadOnlyList<string>? keys = null)
    {
        var inventory = new InventorySnapshot();
        var selected = keys is null
            ? AuditPages.Select(pair => (pair.Key, pair.Value))
            : keys.Select(key => (key, AuditPages[key]));

        foreach (var (key, endpoint) in selected)
        {
            ExpectedControls.TryGetValue(key, out var expected);
            string? lastError = null;

            for (var attempt = 0; attempt < 2; attempt++)
            {
                try
                {
                    // Este firmware V7 invalida la ruta de administracion tras una lectura
                    // directa. Renovar el acceso evita que el siguiente modulo devuelva 404.
                    await LoginAsync(page, baseUrl).ConfigureAwait(false);
                    await page.GotoAsync($"{baseUrl}/getpage.gch?pid=1002&nextpage={endpoint}",
                        new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 7000 }).ConfigureAwait(false);

                    if (expected is not null)
                        await page.Locator(expected).WaitForAsync(new LocatorWaitForOptions
                        {
                            State = WaitForSelectorState.Attached,
                            Timeout = 2500,
                        }).ConfigureAwait(false);

                    await page.WaitForTimeoutAsync(350).ConfigureAwait(false);
                    var candidate = await PageSnapshotAsync(page).ConfigureAwait(false);

                    if (expected is not null && !candidate.Controls.ContainsKey(expected.TrimStart('#')))
                        throw new OnuProvisioningException($"La pagina {key} no termino de cargar sus controles", "ZTE_INVENTORY_PAGE_INCOMPLETE");

                    inventory.Pages[key] = candidate;
                    lastError = null;
                    break;
                }
                catch (Exception exception) when (exception is PlaywrightException or OnuProvisioningException or TimeoutException)
                {
                    var text = exception.Message.Split('\n')[0];
                    lastError = text.Length > 180 ? text[..180] : text;
                    if (attempt == 0) await page.WaitForTimeoutAsync(250).ConfigureAwait(false);
                }
            }

            if (lastError is not null) inventory.Errors[key] = lastError;
        }
        return inventory;
    }

    /// <summary>Abre un modulo del panel renovando antes la sesion, como exige el firmware.</summary>
    private async Task OpenAsync(IPage page, string endpoint)
    {
        var baseUrl = _baseUrl ?? page.Url[..page.Url.LastIndexOf('/')];
        Exception? lastError = null;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                await LoginAsync(page, baseUrl).ConfigureAwait(false);
                var response = await page.GotoAsync($"{baseUrl}/getpage.gch?pid=1002&nextpage={endpoint}",
                    new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 7000 }).ConfigureAwait(false);
                await page.WaitForTimeoutAsync(400).ConfigureAwait(false);

                if (await page.Locator("#Frm_Username").CountAsync().ConfigureAwait(false) > 0)
                    throw new OnuProvisioningException("La sesion ZTE vencio durante la configuracion", "ZTE_SESSION_EXPIRED");
                if (response is not null && response.Status >= 400)
                    throw new OnuProvisioningException($"La ZTE devolvio HTTP {response.Status} al abrir {endpoint}", "ZTE_PAGE_UNAVAILABLE");
                return;
            }
            catch (Exception exception) when (exception is PlaywrightException or OnuProvisioningException or TimeoutException)
            {
                lastError = exception;
                if (attempt == 0) await page.WaitForTimeoutAsync(250).ConfigureAwait(false);
            }
        }

        if (lastError is OnuProvisioningException provisioning) throw provisioning;
        throw new OnuProvisioningException($"No se pudo abrir el modulo ZTE {endpoint}", "ZTE_PAGE_UNAVAILABLE", innerException: lastError);
    }

    // ─────────────────────────── Campos del formulario ───────────────────────────

    private static async Task<ILocator> ControlAsync(IPage page, string selector)
    {
        var control = page.Locator(selector);
        if (await control.CountAsync().ConfigureAwait(false) != 1)
            throw new OnuProvisioningException($"El firmware ZTE no mostro el control {selector}", "ZTE_FORM_MISMATCH", retryable: false);
        return control;
    }

    private static async Task<bool> FillAsync(IPage page, string selector, string value)
    {
        var control = await ControlAsync(page, selector).ConfigureAwait(false);
        if (await control.InputValueAsync().ConfigureAwait(false) == value) return false;
        if (await control.IsDisabledAsync().ConfigureAwait(false))
        {
            if (await control.InputValueAsync().ConfigureAwait(false) != value)
                throw new OnuProvisioningException($"El campo {selector} esta bloqueado con un valor incompatible", "ZTE_FIELD_LOCKED", retryable: false);
            return false;
        }
        await control.FillAsync(value, new LocatorFillOptions { Timeout = 2000 }).ConfigureAwait(false);
        if (await control.InputValueAsync().ConfigureAwait(false) != value)
            throw new OnuProvisioningException($"La ZTE no acepto el valor de {selector}", "ZTE_VALUE_REJECTED");
        return true;
    }

    private static async Task<bool> CheckAsync(IPage page, string selector, bool desired)
    {
        var control = await ControlAsync(page, selector).ConfigureAwait(false);
        if (await control.IsCheckedAsync().ConfigureAwait(false) == desired) return false;
        if (await control.IsDisabledAsync().ConfigureAwait(false))
            throw new OnuProvisioningException($"El campo {selector} esta bloqueado con un valor incompatible", "ZTE_FIELD_LOCKED", retryable: false);

        await control.SetCheckedAsync(desired, new LocatorSetCheckedOptions { Timeout = 2000 }).ConfigureAwait(false);
        if (await control.IsCheckedAsync().ConfigureAwait(false) != desired)
            throw new OnuProvisioningException($"La ZTE no acepto el valor de {selector}", "ZTE_VALUE_REJECTED");
        return true;
    }

    private static async Task<bool> SelectAsync(IPage page, string selector, string value)
    {
        var control = await ControlAsync(page, selector).ConfigureAwait(false);
        if (await control.InputValueAsync().ConfigureAwait(false) == value) return false;
        if (await control.IsDisabledAsync().ConfigureAwait(false))
            throw new OnuProvisioningException($"El campo {selector} esta bloqueado con un valor incompatible", "ZTE_FIELD_LOCKED", retryable: false);

        try
        {
            await control.SelectOptionAsync(new[] { new SelectOptionValue { Value = value } },
                new LocatorSelectOptionOptions { Timeout = 2000 }).ConfigureAwait(false);
        }
        catch (PlaywrightException exception)
        {
            throw new OnuProvisioningException(
                $"El firmware no ofrece la opcion {value} en {selector}", "ZTE_OPTION_UNAVAILABLE", retryable: false, innerException: exception);
        }

        if (await control.InputValueAsync().ConfigureAwait(false) != value)
            throw new OnuProvisioningException($"La ZTE no acepto el valor de {selector}", "ZTE_VALUE_REJECTED");
        return true;
    }

    private static async Task SettleAfterNavigationAsync(IPage page)
    {
        try
        {
            await page.WaitForLoadStateAsync(LoadState.DOMContentLoaded, new PageWaitForLoadStateOptions { Timeout = 2500 }).ConfigureAwait(false);
        }
        catch (Exception waited) when (PlaywrightErrors.IsTimeout(waited))
        {
            // La pagina sigue cargando; el siguiente paso vuelve a comprobar.
        }
        catch (PlaywrightException exception) when (HuaweiEg8141A5.IsTransientNavigationError(exception))
        {
            // Navegacion en curso: es el comportamiento normal de este firmware.
        }
        await page.WaitForTimeoutAsync(180).ConfigureAwait(false);
    }

    /// <summary>Ejecuta la funcion de envio del firmware y comprueba el resultado.</summary>
    private static async Task SubmitFunctionAsync(IPage page, string functionName, float timeout = 8000)
    {
        var exists = await page.EvaluateAsync<bool>($"() => typeof globalThis[{JsonSerializer.Serialize(functionName)}] === 'function'").ConfigureAwait(false);
        if (!exists)
            throw new OnuProvisioningException($"El firmware ZTE no expone {functionName}", "ZTE_FORM_MISMATCH", retryable: false);

        var navigationStarted = false;
        try
        {
            // La F670L responde a cada envio con una navegacion completa. Playwright
            // marca esta espera como obsoleta, pero es la que describe ese firmware.
#pragma warning disable CS0612
            await page.RunAndWaitForNavigationAsync(async () =>
            {
                try
                {
                    await page.EvaluateAsync($"() => globalThis[{JsonSerializer.Serialize(functionName)}]()").ConfigureAwait(false);
                }
                catch (PlaywrightException exception)
                {
                    if (!HuaweiEg8141A5.IsTransientNavigationError(exception)) throw;
                    navigationStarted = true;
                }
            }, new PageRunAndWaitForNavigationOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = timeout }).ConfigureAwait(false);
#pragma warning restore CS0612
        }
        catch (Exception waited) when (PlaywrightErrors.IsTimeout(waited))
        {
            if (!navigationStarted && await page.Locator("#fSubmit").CountAsync().ConfigureAwait(false) > 0)
                throw new OnuProvisioningException("La ZTE no confirmo el cambio", "ZTE_SUBMIT_TIMEOUT");
        }
        catch (PlaywrightException exception)
        {
            if (!HuaweiEg8141A5.IsTransientNavigationError(exception)) throw;
            navigationStarted = true;
        }

        if (navigationStarted) await SettleAfterNavigationAsync(page).ConfigureAwait(false);
        else await page.WaitForTimeoutAsync(180).ConfigureAwait(false);

        try
        {
            var error = await page.Locator("#IF_ERRORSTR").InputValueAsync(new LocatorInputValueOptions { Timeout = 800 }).ConfigureAwait(false);
            if (!string.IsNullOrEmpty(error) && error is not ("SUCC" or "NULL"))
            {
                if (error.ToLowerInvariant().Contains("page has expired")) return;
                throw new OnuProvisioningException($"La ZTE devolvio: {error}", "ZTE_DEVICE_REJECTED");
            }
        }
        catch (PlaywrightException)
        {
            // El firmware no publico campo de error en esta vista.
        }
        catch (Exception waited) when (PlaywrightErrors.IsTimeout(waited))
        {
            // Igual que arriba: sin campo de error visible.
        }
    }

    private static async Task SelectWanOptionAsync(IPage page, string value)
    {
        var selector = await ControlAsync(page, "#Frm_WANCName0").ConfigureAwait(false);
        if (await selector.InputValueAsync().ConfigureAwait(false) == value) return;

        var navigationStarted = false;
        try
        {
            // Cambiar de WAN tambien recarga la pagina en este firmware.
#pragma warning disable CS0612
            await page.RunAndWaitForNavigationAsync(async () =>
            {
                try
                {
                    await selector.SelectOptionAsync(new[] { new SelectOptionValue { Value = value } },
                        new LocatorSelectOptionOptions { Timeout = 2000 }).ConfigureAwait(false);
                }
                catch (PlaywrightException exception)
                {
                    if (!HuaweiEg8141A5.IsTransientNavigationError(exception)) throw;
                    navigationStarted = true;
                }
            }, new PageRunAndWaitForNavigationOptions { WaitUntil = WaitUntilState.DOMContentLoaded, Timeout = 4000 }).ConfigureAwait(false);
#pragma warning restore CS0612
        }
        catch (Exception waited) when (PlaywrightErrors.IsTimeout(waited))
        {
            // Algunas vistas aplican el cambio sin navegar.
        }
        catch (PlaywrightException exception)
        {
            if (!HuaweiEg8141A5.IsTransientNavigationError(exception)) throw;
            navigationStarted = true;
        }

        if (navigationStarted) await SettleAfterNavigationAsync(page).ConfigureAwait(false);
        else await page.WaitForTimeoutAsync(120).ConfigureAwait(false);

        var refreshed = await ControlAsync(page, "#Frm_WANCName0").ConfigureAwait(false);
        if (await refreshed.InputValueAsync().ConfigureAwait(false) != value)
            throw new OnuProvisioningException("La ZTE no mantuvo la WAN seleccionada despues de recargar", "ZTE_WAN_SELECTION_FAILED");
    }

    internal static string WanName(ProvisionRequest request)
    {
        if (request.ServiceMode == "bridge")
        {
            var bridge = $"ISPMax-Bridge-{request.Wan.VlanId}";
            return bridge.Length > 32 ? bridge[..32] : bridge;
        }
        var suffix = request.Wan.IpAddress.Split('.').Last();
        var name = $"ISPMax-{suffix}";
        return name.Length > 32 ? name[..32] : name;
    }

    // ─────────────────────────── WAN ───────────────────────────

    private sealed record WanOption(string Id, string Name);

    private static async Task<List<WanOption>> ExistingWansAsync(IPage page)
    {
        var selector = await ControlAsync(page, "#Frm_WANCName0").ConfigureAwait(false);
        var options = selector.Locator("option");
        var count = await options.CountAsync().ConfigureAwait(false);
        var existing = new List<WanOption>();
        for (var index = 0; index < count; index++)
        {
            var option = options.Nth(index);
            var value = await option.GetAttributeAsync("value").ConfigureAwait(false);
            if (value is null or "-1") continue;
            existing.Add(new WanOption(value, (await option.InnerTextAsync().ConfigureAwait(false)).Trim()));
        }
        return existing;
    }

    private async Task<List<string>> DeleteAllWansAsync(IPage page)
    {
        var deleted = new List<string>();
        for (var attempt = 0; attempt < 32; attempt++)
        {
            await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
            var existing = await ExistingWansAsync(page).ConfigureAwait(false);
            if (existing.Count == 0) return deleted;

            var target = existing[0];
            await SelectWanOptionAsync(page, target.Id).ConfigureAwait(false);
            await SubmitFunctionAsync(page, "pageDel").ConfigureAwait(false);

            await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
            var remaining = (await ExistingWansAsync(page).ConfigureAwait(false)).Select(item => item.Id).ToHashSet();
            if (remaining.Contains(target.Id))
                throw new OnuProvisioningException($"La WAN {target.Name} sigue presente despues de eliminarla", "ZTE_WAN_DELETE_VERIFY_FAILED");
            deleted.Add(target.Name);
        }
        throw new OnuProvisioningException(
            "La ONU conserva mas perfiles WAN de los que el agente puede limpiar con seguridad",
            "ZTE_WAN_DELETE_LIMIT", retryable: false);
    }

    private async Task<JsonObject> ConfigureWanAsync(IPage page, ProvisionRequest request)
    {
        await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
        var existing = await ExistingWansAsync(page).ConfigureAwait(false);

        var deletedWans = new List<string>();
        if (request.ReplaceConflictingWan && existing.Count > 0)
        {
            deletedWans = await DeleteAllWansAsync(page).ConfigureAwait(false);
            await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
            existing = new List<WanOption>();
        }

        WanOption? compatible = null;
        WanOption? conflict = null;
        foreach (var item in existing)
        {
            await SelectWanOptionAsync(page, item.Id).ConfigureAwait(false);
            var vlan = await (await ControlAsync(page, "#Frm_VLANID").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);
            var service = await (await ControlAsync(page, "#Frm_ServList").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);
            var address = await (await ControlAsync(page, "#Frm_IPAddress").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);
            var mode = await (await ControlAsync(page, "#Frm_mode").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);

            if (vlan != request.Wan.VlanId.ToString()) continue;

            var expectedService = request.ServiceMode == "bridge" || !request.Tr069.Enabled
                ? new[] { "1", "3" }
                : new[] { "3" };
            var expectedAddress = request.ServiceMode == "bridge" || address == request.Wan.IpAddress;
            var expectedMode = mode.Equals(request.ServiceMode == "bridge" ? "bridge" : "route", StringComparison.OrdinalIgnoreCase);

            if (expectedService.Contains(service) && expectedAddress && expectedMode)
            {
                compatible = item;
                break;
            }
            conflict = item;
        }

        if (compatible is not null)
            return new JsonObject
            {
                ["name"] = compatible.Name, ["id"] = compatible.Id, ["changed"] = false, ["reused"] = true,
                ["deleted_wans"] = HuaweiEg8141A5.ToJsonArray(deletedWans), ["service_mode"] = request.ServiceMode,
            };

        if (conflict is not null && !request.ReplaceConflictingWan)
            throw new OnuProvisioningException(
                $"La VLAN {request.Wan.VlanId} ya pertenece a {conflict.Name} y no coincide con el expediente. " +
                "Confirma reemplazar la WAN para continuar.",
                "ZTE_WAN_CONFLICT", retryable: false);

        if (conflict is not null)
        {
            await SelectWanOptionAsync(page, conflict.Id).ConfigureAwait(false);
            await SubmitFunctionAsync(page, "pageDel").ConfigureAwait(false);
            await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
            var remaining = (await ExistingWansAsync(page).ConfigureAwait(false)).Select(item => item.Id).ToHashSet();
            if (remaining.Contains(conflict.Id))
                throw new OnuProvisioningException("La WAN anterior sigue presente despues de eliminarla", "ZTE_WAN_DELETE_VERIFY_FAILED");
        }

        var name = WanName(request);
        await SelectAsync(page, "#Frm_WANCName0", "-1").ConfigureAwait(false);
        await FillAsync(page, "#Frm_WANCName1", name).ConfigureAwait(false);
        await CheckAsync(page, "#Frm_WBDMode", true).ConfigureAwait(false);
        await FillAsync(page, "#Frm_VLANID", request.Wan.VlanId.ToString()).ConfigureAwait(false);
        await SelectAsync(page, "#Frm_Priority", request.Wan.Priority.ToString()).ConfigureAwait(false);
        await SelectAsync(page, "#Frm_mode", request.ServiceMode == "router" ? "Route" : "Bridge").ConfigureAwait(false);
        await SelectAsync(page, "#Frm_ServList", request.ServiceMode == "router" && request.Tr069.Enabled ? "3" : "1").ConfigureAwait(false);
        await FillAsync(page, "#Frm_MTU", request.Wan.Mtu.ToString()).ConfigureAwait(false);
        await SelectAsync(page, "#Frm_linkMode", "IP").ConfigureAwait(false);
        await SelectAsync(page, "#Frm_IpMode", "IPv4").ConfigureAwait(false);

        if (request.ServiceMode == "router")
        {
            await SelectAsync(page, "#Frm_WANCType", "Static").ConfigureAwait(false);
            await CheckAsync(page, "#Frm_IsNAT", request.Wan.NatEnabled).ConfigureAwait(false);
            await FillAsync(page, "#Frm_IPAddress", request.Wan.IpAddress).ConfigureAwait(false);
            await FillAsync(page, "#Frm_SubnetMask", request.Wan.SubnetMask).ConfigureAwait(false);
            await FillAsync(page, "#Frm_GateWay", request.Wan.Gateway).ConfigureAwait(false);
            await FillAsync(page, "#Frm_DNS1", request.Wan.PrimaryDns).ConfigureAwait(false);
            await FillAsync(page, "#Frm_DNS2", request.Wan.SecondaryDns ?? string.Empty).ConfigureAwait(false);
            await FillAsync(page, "#Frm_DNS3", string.Empty).ConfigureAwait(false);
        }
        else
        {
            await CheckAsync(page, "#Frm_IsNAT", false).ConfigureAwait(false);
        }

        await SubmitFunctionAsync(page, "pageAdd").ConfigureAwait(false);
        await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);

        foreach (var option in await ExistingWansAsync(page).ConfigureAwait(false))
        {
            if (option.Name != name) continue;
            await SelectWanOptionAsync(page, option.Id).ConfigureAwait(false);
            var vlan = await (await ControlAsync(page, "#Frm_VLANID").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);
            if (vlan != request.Wan.VlanId.ToString()) break;
            return new JsonObject
            {
                ["name"] = name, ["id"] = option.Id, ["changed"] = true, ["reused"] = false,
                ["deleted_wans"] = HuaweiEg8141A5.ToJsonArray(deletedWans), ["service_mode"] = request.ServiceMode,
            };
        }
        throw new OnuProvisioningException("La WAN no aparecio despues de crearla", "ZTE_WAN_VERIFY_FAILED");
    }

    private async Task<JsonObject> ConfigurePortBindingAsync(IPage page, ProvisionRequest request, JsonObject wan)
    {
        await OpenAsync(page, AuditPages["port_binding"]).ConfigureAwait(false);
        var wanId = wan["id"]!.GetValue<string>();

        var wanSelect = await ControlAsync(page, "#Frm_DefRTInterface").ConfigureAwait(false);
        var options = wanSelect.Locator("option");
        var count = await options.CountAsync().ConfigureAwait(false);
        var values = new List<string?>();
        for (var index = 0; index < count; index++)
            values.Add(await options.Nth(index).GetAttributeAsync("value").ConfigureAwait(false));
        if (!values.Contains(wanId))
            throw new OnuProvisioningException("La WAN no esta disponible para vincular puertos", "ZTE_BINDING_WAN_MISSING");

        await SelectAsync(page, "#Frm_DefRTInterface", wanId).ConfigureAwait(false);

        var requested = request.Wan.BindLanPorts.Select(port => $"IGD.LD1.ETH{port}").ToHashSet();
        if (request.ServiceMode == "router" && request.Wan.BindSsid1)
        {
            requested.Add("IGD.LD1.WLAN1");
            requested.Add("IGD.LD1.WLAN5");
        }

        var changed = false;
        for (var index = 0; index < 12; index++)
        {
            var control = page.Locator($"#FRM_{index}");
            if (await control.CountAsync().ConfigureAwait(false) == 0) continue;
            var value = await control.GetAttributeAsync("value").ConfigureAwait(false);
            var desired = value is not null && requested.Contains(value);
            if (await control.IsCheckedAsync().ConfigureAwait(false) != desired) changed = true;
            await control.SetCheckedAsync(desired).ConfigureAwait(false);
        }
        if (changed) await SubmitFunctionAsync(page, "pageSubmit").ConfigureAwait(false);

        return new JsonObject
        {
            ["wan"] = wan["name"]?.DeepClone(),
            ["ports"] = HuaweiEg8141A5.ToJsonArray(requested.OrderBy(value => value, StringComparer.Ordinal)),
            ["changed"] = changed,
        };
    }

    private async Task<JsonObject> ConfigureTr069Async(IPage page, ProvisionRequest request, JsonObject wan)
    {
        await OpenAsync(page, AuditPages["tr069"]).ConfigureAwait(false);
        var wanId = wan["id"]!.GetValue<string>();

        var changed = await SelectAsync(page, "#Frm_DefaultWan", wanId).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_URL", request.Tr069.AcsUrl).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_UserName", request.Tr069.Username).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_UserPassword", request.Tr069.Password ?? string.Empty).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_ConnectionRequestUsername", request.Tr069.ConnectionRequestUsername).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_ConnectionRequestPassword", request.Tr069.ConnectionRequestPassword ?? string.Empty).ConfigureAwait(false);
        changed |= await CheckAsync(page, "#Frm_PeriodicInformEnable", true).ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_PeriodicInformInterval", request.Tr069.PeriodicInformInterval.ToString()).ConfigureAwait(false);
        changed |= await CheckAsync(page, "#Frm_SupportCertAuth", false).ConfigureAwait(false);
        if (changed) await SubmitFunctionAsync(page, "pageSubmit").ConfigureAwait(false);

        return new JsonObject
        {
            ["acs_url"] = request.Tr069.AcsUrl,
            ["wan"] = wan["name"]?.DeepClone(),
            ["interval"] = request.Tr069.PeriodicInformInterval,
            ["changed"] = changed,
        };
    }

    private async Task<JsonObject> ConfigureWifiAsync(IPage page, ProvisionRequest request)
    {
        var password = request.Wifi.Password;
        var ssid5 = $"{request.Wifi.Ssid}-5G";
        if (ssid5.Length > 32) ssid5 = ssid5[..32];
        var changed = false;

        var bands = new[]
        {
            ("wifi24", "wifi24_ssid", "wifi24_security", "wifi24_wps", request.Wifi.Ssid),
            ("wifi5", "wifi5_ssid", "wifi5_security", "wifi5_wps", ssid5),
        };

        foreach (var (configKey, ssidKey, securityKey, wpsKey, ssid) in bands)
        {
            await OpenAsync(page, AuditPages[configKey]).ConfigureAwait(false);
            var pageChanged = await CheckAsync(page, "#Frm_RadioStatus", request.Wifi.Enabled).ConfigureAwait(false);
            pageChanged |= await SelectAsync(page, "#Frm_QosType", request.Wifi.WmmEnabled ? "WMM" : "Disabled").ConfigureAwait(false);
            if (pageChanged)
            {
                await SubmitFunctionAsync(page, "pageSubmit").ConfigureAwait(false);
                changed = true;
            }

            await OpenAsync(page, AuditPages[ssidKey]).ConfigureAwait(false);
            pageChanged = await CheckAsync(page, "#Frm_Enable", request.Wifi.Enabled).ConfigureAwait(false);
            pageChanged |= await CheckAsync(page, "#Frm_ESSIDHideEnable", !request.Wifi.Broadcast).ConfigureAwait(false);
            pageChanged |= await CheckAsync(page, "#Frm_VapIsolationEnable", false).ConfigureAwait(false);
            pageChanged |= await FillAsync(page, "#Frm_MaxUserNum", request.Wifi.MaxClients.ToString()).ConfigureAwait(false);
            pageChanged |= await FillAsync(page, "#Frm_ESSID", ssid).ConfigureAwait(false);
            if (pageChanged)
            {
                await SubmitFunctionAsync(page, "pageSubmit").ConfigureAwait(false);
                changed = true;
            }

            await OpenAsync(page, AuditPages[securityKey]).ConfigureAwait(false);
            pageChanged = await SelectAsync(page, "#Frm_Authentication", "WPA2-PSK").ConfigureAwait(false);
            pageChanged |= await SelectAsync(page, "#Frm_WPAEncryptType", "AESEncryption").ConfigureAwait(false);
            pageChanged |= await FillAsync(page, "#Frm_KeyPassphrase", password).ConfigureAwait(false);
            if (pageChanged)
            {
                await SubmitFunctionAsync(page, "submitPage").ConfigureAwait(false);
                changed = true;
            }

            await OpenAsync(page, AuditPages[wpsKey]).ConfigureAwait(false);
            var desiredWps = request.Wifi.WpsEnabled ? "PBC" : "Disabled";
            var currentWps = await (await ControlAsync(page, "#Frm_WPSMode").ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);
            if (currentWps != desiredWps)
            {
                await SelectAsync(page, "#Frm_WPSMode", desiredWps).ConfigureAwait(false);
                // Este firmware aplica el selector WPS de inmediato con onchange.
                await page.WaitForTimeoutAsync(150).ConfigureAwait(false);
                changed = true;
            }
        }

        return new JsonObject
        {
            ["ssid"] = request.Wifi.Ssid,
            ["ssid_5g"] = ssid5,
            ["security"] = "WPA2-PSK/AES",
            ["changed"] = changed,
        };
    }

    private async Task<JsonObject> ConfigureTimeAsync(IPage page)
    {
        await OpenAsync(page, AuditPages["sntp"]).ConfigureAwait(false);
        var changed = await SelectAsync(page, "#Frm_LocalTimeZoneandName", "38").ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_NtpServer1", "pool.ntp.org").ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_NtpServer2", "time.google.com").ConfigureAwait(false);
        changed |= await FillAsync(page, "#Frm_PollTimeInterval", "86400").ConfigureAwait(false);
        if (changed) await SubmitFunctionAsync(page, "pageSubmit").ConfigureAwait(false);

        return new JsonObject
        {
            ["timezone"] = "GMT-04:00",
            ["ntp"] = new JsonArray("pool.ntp.org", "time.google.com"),
            ["changed"] = changed,
        };
    }

    // ─────────────────────────── Acceso remoto ───────────────────────────

    private async Task<JsonObject> ConfigureRemoteAccessAsync(IPage page, ProvisionRequest request, JsonObject wan)
    {
        await OpenAsync(page, AuditPages["service_control"]).ConfigureAwait(false);
        var wanName = wan["name"]!.GetValue<string>();
        var wanId = wan["id"]!.GetValue<string>();

        var (network, prefix) = Ipv4.ParseCidr(request.RemoteAccess.Source);
        var first = network.ToString();
        var last = Ipv4.BroadcastAddress(network, prefix).ToString();

        var snapshot = await PageSnapshotAsync(page).ConfigureAwait(false);
        if (RemoteSnapshotMatches(snapshot, wanName, first, last))
            return new JsonObject { ["source"] = request.RemoteAccess.Source, ["service"] = "HTTP", ["changed"] = false };

        await SelectAsync(page, "#Frm_SCIPMode", "0").ConfigureAwait(false);
        await CheckAsync(page, "#Frm_Enable", true).ConfigureAwait(false);
        await SelectAsync(page, "#Frm_INCViewName", wanId).ConfigureAwait(false);
        await FillAsync(page, "#Frm_MinSrcIp", first).ConfigureAwait(false);
        await FillAsync(page, "#Frm_MaxSrcIp", last).ConfigureAwait(false);
        await SelectAsync(page, "#Frm_Mode", "1").ConfigureAwait(false);
        await CheckAsync(page, "#ServiceType0", true).ConfigureAwait(false);
        foreach (var selector in new[] { "#ServiceType1", "#ServiceType3", "#ServiceType4" })
            await CheckAsync(page, selector, false).ConfigureAwait(false);

        try
        {
            await SubmitFunctionAsync(page, "Add").ConfigureAwait(false);
        }
        catch (OnuProvisioningException exception) when (exception.Code == "ZTE_DEVICE_REJECTED")
        {
            // La F670L V7 puede aplicar la regla y aun asi devolver FAIL o formulario
            // expirado. Nunca se asume exito: la lectura posterior debe probarla.
        }

        await OpenAsync(page, AuditPages["service_control"]).ConfigureAwait(false);
        var verified = await PageSnapshotAsync(page).ConfigureAwait(false);
        if (!RemoteSnapshotMatches(verified, wanName, first, last))
            throw new OnuProvisioningException("La regla HTTP no aparecio en la lectura posterior", "ZTE_REMOTE_VERIFY_FAILED");

        return new JsonObject { ["source"] = request.RemoteAccess.Source, ["service"] = "HTTP", ["changed"] = true };
    }

    /// <summary>
    /// La tabla V7 recorta las etiquetas largas de la WAN. El rango exacto, el modo
    /// Permit y el servicio HTTP identifican sin ambiguedad la regla restringida.
    /// </summary>
    internal static bool RemoteRuleMatches(string text, string first, string last)
    {
        var lowered = text.ToLowerInvariant();
        return new[] { first, last, "Permit", "HTTP" }.All(value => lowered.Contains(value.ToLowerInvariant()));
    }

    internal static bool RemoteSnapshotMatches(ZteSnapshot snapshot, string wanName, string first, string last)
    {
        for (var index = 0; index < 64; index++)
        {
            string Value(string name) => snapshot.Controls.TryGetValue($"{name}{index}", out var control) ? control.Value : string.Empty;

            if (Value("Enable") == "1" &&
                Value("INCName") == wanName &&
                Value("MinSrcIp") == first &&
                Value("MaxSrcIp") == last &&
                Value("FilterTarget") == "1" &&
                Value("Servise") == "1")
                return true;
        }

        var rowText = string.Join("\n", snapshot.Rows.Select(row => string.Join(" ", row)));
        return RemoteRuleMatches($"{snapshot.Text}\n{rowText}", first, last);
    }

    // ─────────────────────────── Verificacion ───────────────────────────

    private async Task<JsonObject> VerifyAsync(IPage page, ProvisionRequest request, JsonObject wan)
    {
        await OpenAsync(page, AuditPages["wan"]).ConfigureAwait(false);
        var wanId = wan["id"]!.GetValue<string>();
        var wanSelect = await ControlAsync(page, "#Frm_WANCName0").ConfigureAwait(false);
        if (await wanSelect.InputValueAsync().ConfigureAwait(false) != wanId)
            await SelectWanOptionAsync(page, wanId).ConfigureAwait(false);

        async Task<string> Value(string selector) =>
            await (await ControlAsync(page, selector).ConfigureAwait(false)).InputValueAsync().ConfigureAwait(false);

        if (request.ServiceMode == "bridge")
        {
            var bridgeVlan = await Value("#Frm_VLANID").ConfigureAwait(false);
            var bridgeMode = await Value("#Frm_mode").ConfigureAwait(false);
            var bridgeService = await Value("#Frm_ServList").ConfigureAwait(false);
            var bridgeNat = await (await ControlAsync(page, "#Frm_IsNAT").ConfigureAwait(false)).IsCheckedAsync().ConfigureAwait(false);

            var bridgeOk = bridgeVlan == request.Wan.VlanId.ToString()
                && bridgeMode.Equals("bridge", StringComparison.OrdinalIgnoreCase)
                && (bridgeService == "1" || bridgeService == "3")
                && !bridgeNat;
            if (!bridgeOk)
                throw new OnuProvisioningException("La lectura posterior no confirma el perfil Bridge", "ZTE_BRIDGE_VERIFY_FAILED");
            return new JsonObject { ["bridge"] = true, ["vlan"] = true, ["lan_ports"] = true, ["ip_host_absent"] = true };
        }

        var wanOk = await Value("#Frm_VLANID").ConfigureAwait(false) == request.Wan.VlanId.ToString()
            && await Value("#Frm_IPAddress").ConfigureAwait(false) == request.Wan.IpAddress
            && await Value("#Frm_GateWay").ConfigureAwait(false) == request.Wan.Gateway
            && await Value("#Frm_ServList").ConfigureAwait(false) == (request.Tr069.Enabled ? "3" : "1");

        var ssid5 = $"{request.Wifi.Ssid}-5G";
        if (ssid5.Length > 32) ssid5 = ssid5[..32];
        var wifiOk = true;
        foreach (var (key, expected) in new[] { ("wifi24_ssid", request.Wifi.Ssid), ("wifi5_ssid", ssid5) })
        {
            await OpenAsync(page, AuditPages[key]).ConfigureAwait(false);
            wifiOk = wifiOk && await Value("#Frm_ESSID").ConfigureAwait(false) == expected;
        }

        var tr069Ok = true;
        if (request.Tr069.Enabled)
        {
            await OpenAsync(page, AuditPages["tr069"]).ConfigureAwait(false);
            tr069Ok = await Value("#Frm_URL").ConfigureAwait(false) == request.Tr069.AcsUrl
                && await Value("#Frm_DefaultWan").ConfigureAwait(false) == wanId
                && await Value("#Frm_PeriodicInformInterval").ConfigureAwait(false) == request.Tr069.PeriodicInformInterval.ToString();
        }

        await OpenAsync(page, AuditPages["sntp"]).ConfigureAwait(false);
        var timeOk = await Value("#Frm_LocalTimeZoneandName").ConfigureAwait(false) == "38";

        var remoteOk = true;
        if (request.RemoteAccess.Enabled)
        {
            await OpenAsync(page, AuditPages["service_control"]).ConfigureAwait(false);
            var (network, prefix) = Ipv4.ParseCidr(request.RemoteAccess.Source);
            remoteOk = RemoteSnapshotMatches(
                await PageSnapshotAsync(page).ConfigureAwait(false),
                wan["name"]!.GetValue<string>(),
                network.ToString(),
                Ipv4.BroadcastAddress(network, prefix).ToString());
        }

        if (!(wanOk && wifiOk && tr069Ok && timeOk && remoteOk))
            throw new OnuProvisioningException("La lectura posterior no coincide con lo solicitado", "ZTE_VERIFY_FAILED");

        return new JsonObject
        {
            ["wan"] = wanOk, ["wifi"] = wifiOk, ["tr069"] = tr069Ok, ["time"] = timeOk, ["remote_access"] = remoteOk,
        };
    }

    // ─────────────────────────── Respaldo ───────────────────────────

    private async Task<string> DownloadBackupAsync(IPage page, string suffix)
    {
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        Exception? lastError = null;

        for (var attempt = 0; attempt < 2; attempt++)
        {
            await OpenAsync(page, "manager_dev_config_t.gch").ConfigureAwait(false);
            try
            {
                var download = await page.RunAndWaitForDownloadAsync(async () =>
                {
                    await page.Locator("#download").ClickAsync(new LocatorClickOptions { Timeout = 2000 }).ConfigureAwait(false);
                }, new PageRunAndWaitForDownloadOptions { Timeout = 10000 }).ConfigureAwait(false);

                var extension = Path.GetExtension(download.SuggestedFilename);
                if (string.IsNullOrWhiteSpace(extension)) extension = ".bin";
                var destination = Path.Combine(_backupDir, $"F670L-{stamp}-{suffix}{extension}");
                await download.SaveAsAsync(destination).ConfigureAwait(false);

                var info = new FileInfo(destination);
                if (!info.Exists || info.Length == 0)
                    throw new OnuProvisioningException("La ZTE entrego un respaldo vacio", "ZTE_BACKUP_EMPTY");
                return Path.GetFullPath(destination);
            }
            catch (Exception exception) when (exception is PlaywrightException or TimeoutException)
            {
                lastError = exception;
                if (attempt == 0) await page.WaitForTimeoutAsync(500).ConfigureAwait(false);
            }
        }
        throw new OnuProvisioningException("La ZTE no entrego el respaldo", "ZTE_BACKUP_FAILED", innerException: lastError);
    }

    private async Task RestoreBackupAsync(IPage page, string baseUrl, string backupPath)
    {
        if (!File.Exists(backupPath))
            throw new OnuProvisioningException("El respaldo de restauracion no existe", "ZTE_BACKUP_MISSING");

        _baseUrl = baseUrl;
        await OpenAsync(page, "manager_dev_config_t.gch").ConfigureAwait(false);
        var upload = page.Locator("#ConfigUpload");
        try
        {
            await upload.WaitForAsync(new LocatorWaitForOptions { State = WaitForSelectorState.Attached, Timeout = 3000 }).ConfigureAwait(false);
            await upload.SetInputFilesAsync(backupPath, new LocatorSetInputFilesOptions { Timeout = 3000 }).ConfigureAwait(false);
        }
        catch (Exception exception) when (exception is PlaywrightException or TimeoutException)
        {
            throw new OnuProvisioningException(
                "La pagina de restauracion ZTE no mostro el selector de respaldo", "ZTE_RESTORE_FORM_MISMATCH", innerException: exception);
        }
        await SubmitFunctionAsync(page, "msgCallback", 5000).ConfigureAwait(false);
    }

    private async Task CaptureFailureAsync(IPage page)
    {
        try
        {
            Directory.CreateDirectory(_backupDir);
            var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            await page.ScreenshotAsync(new PageScreenshotOptions
            {
                Path = Path.Combine(_backupDir, $"F670L-{stamp}-error.png"),
                FullPage = true,
            }).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // El diagnostico es opcional.
        }
    }

    // ─────────────────────────── Inventario ───────────────────────────

    internal static string NormalizedLabel(string value) =>
        Regex.Replace(value.ToLowerInvariant(), "[^a-z0-9]+", " ").Trim();

    internal static string? FirstValue(IReadOnlyDictionary<string, string> pairs, params string[] labels)
    {
        var normalized = pairs.ToDictionary(pair => NormalizedLabel(pair.Key), pair => pair.Value, StringComparer.Ordinal);
        foreach (var label in labels)
        {
            var wanted = NormalizedLabel(label);
            foreach (var (key, value) in normalized)
            {
                if (key != wanted && !key.Contains(wanted, StringComparison.Ordinal)) continue;
                var clean = value.Trim();
                if (clean.Length > 0 && clean is not ("-" or "--" or "N/A" or "NULL")) return clean;
            }
        }
        return null;
    }

    internal static JsonObject ParseInventorySnapshot(IReadOnlyDictionary<string, string> pairs, string text)
    {
        var serial = FirstValue(pairs, "GPON Serial Number", "PON Serial Number", "Serial Number", "SN");
        if (serial is null)
        {
            var match = Regex.Match(text, @"\b(?:SN\s*[:=]\s*)?([A-Z]{4}[0-9A-F]{8})\b", RegexOptions.IgnoreCase);
            serial = match.Success ? match.Groups[1].Value : null;
        }

        string? normalizedSerial = null;
        if (serial is not null && GponSerial.TryNormalize(serial, out var parsed)) normalizedSerial = parsed;

        var rxPower = FirstValue(pairs, "Optical Module Input Power", "RX Optical Power", "Receive Power", "RX Power");

        return new JsonObject
        {
            ["identity"] = new JsonObject
            {
                ["serial"] = normalizedSerial,
                ["serial_raw"] = serial?.ToUpperInvariant(),
                ["authentication_mode"] = "sn_password",
            },
            ["device"] = new JsonObject
            {
                ["model"] = FirstValue(pairs, "Model Name", "Product Name", "Model") ?? "F670L",
                ["description"] = FirstValue(pairs, "Device Description", "Description"),
                ["hardware_version"] = FirstValue(pairs, "Hardware Version", "Hardware"),
                ["software_version"] = FirstValue(pairs, "Software Version", "Firmware Version", "Software"),
                ["firmware_release"] = FirstValue(pairs, "Build Time", "Release Time"),
                ["manufacturer_info"] = "ZTE",
                ["vendor_id"] = "ZTEG",
                ["mac"] = FirstValue(pairs, "MAC Address", "Device MAC", "LAN MAC"),
                ["registration_status"] = FirstValue(pairs, "PON State", "Registration Status", "GPON Status"),
                ["ont_id"] = FirstValue(pairs, "ONU ID", "ONT ID"),
                ["cpu_usage"] = FirstValue(pairs, "CPU Usage"),
                ["memory_usage"] = FirstValue(pairs, "Memory Usage"),
                ["runtime"] = FirstValue(pairs, "Up Time", "Uptime", "Running Time"),
                ["system_time"] = FirstValue(pairs, "Current Time", "System Time"),
            },
            ["optical"] = new JsonObject
            {
                ["tx_power_dbm"] = FirstValue(pairs, "Optical Module Output Power", "TX Optical Power", "Transmit Power", "TX Power"),
                ["rx_power_dbm"] = rxPower,
                ["voltage_mv"] = FirstValue(pairs, "Optical Module Supply Voltage", "Voltage"),
                ["bias_ma"] = FirstValue(pairs, "Optical Transmitter Bias Current", "Bias Current", "Laser Bias"),
                ["temperature_c"] = FirstValue(pairs, "Operating Temperature of the Optical Module", "Temperature"),
                ["los"] = Regex.IsMatch(text, @"\bLOS\b.*\b(?:on|active|yes)\b", RegexOptions.IgnoreCase),
                ["module_vendor"] = null,
                ["module_serial"] = null,
                ["module_date_code"] = null,
                ["tx_wavelength_nm"] = null,
                ["rx_wavelength_nm"] = null,
                ["max_distance_km"] = null,
                ["signal_available"] = rxPower is not null,
            },
        };
    }

    private static JsonObject BuildInventory(InventorySnapshot snapshot)
    {
        if (snapshot.Pages.Count == 0)
        {
            var empty = ParseInventorySnapshot(new Dictionary<string, string>(), string.Empty);
            var device = BrowserJson.AsObject(empty["device"]);
            return new JsonObject
            {
                ["collected_at"] = Storage.Clock.UtcNow(),
                ["source"] = "onu_local_read_only",
                ["identity"] = empty["identity"]?.DeepClone(),
                ["device"] = device.DeepClone(),
                ["optical"] = empty["optical"]?.DeepClone(),
                ["wan"] = new JsonArray(),
                ["ethernet"] = new JsonObject { ["mac"] = device["mac"]?.DeepClone(), ["ports"] = new JsonArray() },
                ["wifi"] = new JsonObject { ["radios"] = new JsonArray(), ["clients"] = new JsonArray() },
                ["remote_access"] = new JsonObject { ["rules"] = new JsonArray() },
                ["errors"] = new JsonObject
                {
                    ["wan"] = "Pendiente de calibrar con una sesion tecnica valida",
                    ["wifi"] = "Pendiente de calibrar con una sesion tecnica valida",
                    ["remote_access"] = "Pendiente de calibrar con una sesion tecnica valida",
                },
            };
        }

        var devicePage = snapshot.Pages.GetValueOrDefault("device");
        var ponPage = snapshot.Pages.GetValueOrDefault("pon_status");
        var mergedPairs = new Dictionary<string, string>();
        foreach (var pair in devicePage?.Pairs ?? new Dictionary<string, string>()) mergedPairs[pair.Key] = pair.Value;
        foreach (var pair in ponPage?.Pairs ?? new Dictionary<string, string>()) mergedPairs[pair.Key] = pair.Value;
        var parsed = ParseInventorySnapshot(mergedPairs, $"{devicePage?.Text}\n{ponPage?.Text}");

        string? Control(string pageKey, string controlId)
        {
            var page = snapshot.Pages.GetValueOrDefault(pageKey);
            return page is not null && page.Controls.TryGetValue(controlId, out var control) ? control.Value : null;
        }

        bool ControlChecked(string pageKey, string controlId)
        {
            var page = snapshot.Pages.GetValueOrDefault(pageKey);
            return page is not null && page.Controls.TryGetValue(controlId, out var control) && control.Checked;
        }

        List<string> ControlSelected(string pageKey, string controlId)
        {
            var page = snapshot.Pages.GetValueOrDefault(pageKey);
            return page is not null && page.Controls.TryGetValue(controlId, out var control) ? control.Selected : new List<string>();
        }

        string? Pair(string pageKey, params string[] labels)
        {
            var page = snapshot.Pages.GetValueOrDefault(pageKey);
            return page is null ? null : FirstValue(page.Pairs, labels);
        }

        var wan = new JsonArray
        {
            new JsonObject
            {
                ["name"] = Control("wan_status", "TextWANCName0"),
                ["type"] = Control("wan_status", "TextIPMode0"),
                ["ip_version"] = Control("wan_status", "TextIPIpMode0"),
                ["nat"] = Control("wan_status", "TextIPIsNAT0"),
                ["address"] = Control("wan_status", "TextIPAddress0"),
                ["dns"] = Control("wan_status", "TextIPDNS0"),
                ["gateway"] = Control("wan_status", "TextIPGateWay0"),
                ["status"] = Control("wan_status", "TextIPConnStatus0"),
                ["disconnect_reason"] = Control("wan_status", "TextIPConnError0"),
                ["mac"] = Control("wan_status", "TextIPWorkIFMac0"),
            },
        };

        var ethernetPorts = new JsonArray();
        var ethernetText = snapshot.Pages.GetValueOrDefault("ethernet_status")?.Text ?? string.Empty;
        foreach (Match match in Regex.Matches(ethernetText,
            @"Ethernet Port\s+(LAN\d).*?Status\s+(\S+).*?Speed\s+(\S+).*?Mode\s+(\S+).*?" +
            @"Packets Received/Bytes Received\s+([^\s]+).*?Packets Sent/Bytes Sent\s+([^\s]+).*?Error Frames\s+(\d+)",
            RegexOptions.IgnoreCase | RegexOptions.Singleline))
        {
            ethernetPorts.Add(new JsonObject
            {
                ["port"] = match.Groups[1].Value,
                ["status"] = match.Groups[2].Value,
                ["speed"] = match.Groups[3].Value,
                ["duplex"] = match.Groups[4].Value,
                ["received"] = match.Groups[5].Value,
                ["sent"] = match.Groups[6].Value,
                ["errors"] = int.Parse(match.Groups[7].Value),
            });
        }

        var radios = new JsonArray();
        foreach (var (band, statusKey, configKey, ssidKey, securityKey) in new[]
        {
            ("2.4GHz", "wifi24_status", "wifi24", "wifi24_ssid", "wifi24_security"),
            ("5GHz", "wifi5_status", "wifi5", "wifi5_ssid", "wifi5_security"),
        })
        {
            radios.Add(new JsonObject
            {
                ["band"] = band,
                ["enabled"] = ControlChecked(configKey, "Frm_RadioStatus"),
                ["ssid_enabled"] = ControlChecked(ssidKey, "Frm_Enable"),
                ["ssid"] = Control(ssidKey, "Frm_ESSID"),
                ["hidden"] = ControlChecked(ssidKey, "Frm_ESSIDHideEnable"),
                ["isolation"] = ControlChecked(ssidKey, "Frm_VapIsolationEnable"),
                ["max_clients"] = Control(ssidKey, "Frm_MaxUserNum"),
                ["channel"] = Control(configKey, "Frm_Channel"),
                ["bandwidth"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(configKey, "Frm_BandWidth")),
                ["standard"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(configKey, "Frm_Standard")),
                ["country"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(configKey, "Frm_CountryCode")),
                ["tx_power"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(configKey, "Frm_TxPower")),
                ["wmm"] = ControlSelected(configKey, "Frm_QosType").Any(value => value.Contains("WMM", StringComparison.OrdinalIgnoreCase)),
                ["mu_mimo"] = ControlChecked(configKey, "Frm_MUMIMO"),
                ["authentication"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(securityKey, "Frm_Authentication")),
                ["encryption"] = HuaweiEg8141A5.ToJsonArray(ControlSelected(securityKey, "Frm_WPAEncryptType")),
                ["mac"] = Pair(statusKey, "MAC Address"),
            });
        }

        var tr069Url = Control("tr069", "Frm_URL");
        var tr069 = new JsonObject
        {
            ["configured"] = !string.IsNullOrWhiteSpace(tr069Url) && !tr069Url.Contains("0.0.0.0", StringComparison.Ordinal),
            ["acs_url"] = tr069Url,
            ["wan"] = HuaweiEg8141A5.ToJsonArray(ControlSelected("tr069", "Frm_DefaultWan")),
            ["periodic_inform"] = ControlChecked("tr069", "Frm_PeriodicInformEnable"),
            ["periodic_interval"] = Control("tr069", "Frm_PeriodicInformInterval"),
            ["certificate_auth"] = ControlChecked("tr069", "Frm_SupportCertAuth"),
        };

        bool HasConfiguredRows(string pageKey)
        {
            var page = snapshot.Pages.GetValueOrDefault(pageKey);
            if (page is null) return false;

            if (pageKey == "service_control")
            {
                for (var index = 0; index < 64; index++)
                {
                    string Value(string name) => page.Controls.TryGetValue($"{name}{index}", out var control) ? control.Value : string.Empty;
                    if (Value("Enable") == "1" && Value("INCName").Length > 0 && Value("MinSrcIp").Length > 0 && Value("Servise").Length > 0)
                        return true;
                }
                return false;
            }

            if (string.IsNullOrWhiteSpace(page.Text) || page.Text.Contains("There is no data", StringComparison.Ordinal)) return false;
            var ignored = new[] { "add", "modify", "cancel", "enable", "service", "mode" };
            return page.Rows.Any(row =>
                row.Count >= 2 &&
                row.Any(cell => !ignored.Contains(cell.Trim().ToLowerInvariant())) &&
                row.Any(cell => Regex.IsMatch(cell, @"\b(?:\d{1,3}\.){3}\d{1,3}\b|\bHTTP\b|\bPermit\b", RegexOptions.IgnoreCase)));
        }

        var remoteRules = HasConfiguredRows("service_control");
        var security = new JsonObject
        {
            ["anti_hacking"] = ControlChecked("firewall", "Frm_IsProtect"),
            ["firewall_level"] = new[] { "off", "low", "medium", "high" }
                .FirstOrDefault(level => ControlChecked("firewall", $"Frm_level_{level}")),
            ["ip_filter_rules"] = HasConfiguredRows("ip_filter"),
            ["mac_filter_rules"] = HasConfiguredRows("mac_filter"),
            ["url_filter_rules"] = HasConfiguredRows("url_filter"),
            ["remote_access_rules"] = remoteRules,
            ["dmz_enabled"] = ControlChecked("dmz", "Frm_Enable"),
            ["upnp_enabled"] = ControlChecked("upnp", "Frm_EnableUPnPIGD"),
        };

        var errors = new JsonObject();
        foreach (var (key, message) in snapshot.Errors) errors[key] = message;

        return new JsonObject
        {
            ["collected_at"] = Storage.Clock.UtcNow(),
            ["source"] = "onu_local_read_only",
            ["identity"] = parsed["identity"]?.DeepClone(),
            ["device"] = parsed["device"]?.DeepClone(),
            ["optical"] = parsed["optical"]?.DeepClone(),
            ["wan"] = wan,
            ["ethernet"] = new JsonObject { ["mac"] = Control("wan_status", "TextIPWorkIFMac0"), ["ports"] = ethernetPorts },
            ["wifi"] = new JsonObject { ["radios"] = radios, ["clients"] = new JsonArray() },
            ["lan"] = new JsonObject
            {
                ["address"] = Control("lan", "Frm_BasicIPAddr"),
                ["subnet_mask"] = Control("lan", "Frm_SubnetMask"),
                ["dhcp_enabled"] = ControlChecked("lan", "Frm_ServerEnable"),
                ["dhcp_start"] = Control("lan", "Frm_MinAddress"),
                ["dhcp_end"] = Control("lan", "Frm_MaxAddress"),
            },
            ["pon"] = new JsonObject { ["loid_configured"] = !string.IsNullOrWhiteSpace(Control("pon", "Frm_PonLoid")) },
            ["tr069"] = tr069,
            ["security"] = security,
            ["time"] = new JsonObject
            {
                ["current"] = Pair("sntp", "Current Date and Time"),
                ["timezone"] = HuaweiEg8141A5.ToJsonArray(ControlSelected("sntp", "Frm_LocalTimeZoneandName")),
                ["ntp1"] = Control("sntp", "Frm_NtpServer1"),
                ["ntp2"] = Control("sntp", "Frm_NtpServer2"),
            },
            ["remote_access"] = new JsonObject { ["rules"] = new JsonArray(), ["configured"] = remoteRules },
            ["errors"] = errors,
        };
    }
}
