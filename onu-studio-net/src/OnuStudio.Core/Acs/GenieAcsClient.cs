using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace OnuStudio.Core.Acs;

public sealed class GenieAcsException : Exception
{
    public GenieAcsException(string message, string code = "TR069_ERROR", JsonNode? rollback = null, JsonNode? verification = null)
        : base(message)
    {
        Code = code;
        Rollback = rollback;
        Verification = verification;
    }

    public string Code { get; }
    public JsonNode? Rollback { get; }
    public JsonNode? Verification { get; }
}

/// <summary>
/// Cliente del ACS (GenieACS) que atiende las tareas TR-069 que llegan desde ISP Max.
/// Cada cambio se aplica, se vuelve a leer y, si no coincide, se deshace.
/// </summary>
public sealed class GenieAcsClient
{
    private static readonly Regex SecretPath = new("password|passphrase|secret|credential|key", RegexOptions.IgnoreCase);

    public const string Root = "InternetGatewayDevice";
    private const string DeviceInfo = $"{Root}.DeviceInfo";
    private const string WifiRoot = $"{Root}.LANDevice.1.WLANConfiguration.1";
    private const string LanRoot = $"{Root}.LANDevice.1";
    private const string DhcpRoot = $"{LanRoot}.LANHostConfigManagement";
    private const string WanRoot = $"{Root}.WANDevice.1.WANConnectionDevice.1.WANIPConnection";
    private const string FiberRoot = $"{Root}.WANDevice.1.X_GponInterafceConfig";
    private const string TimeRoot = $"{Root}.Time";
    private const string ManagementRoot = $"{Root}.ManagementServer";

    private static readonly string Projection = string.Join(",", new[]
    {
        "_id", "_deviceId", "_lastInform", DeviceInfo, WifiRoot,
        $"{LanRoot}.LANEthernetInterfaceConfig", DhcpRoot, $"{LanRoot}.Hosts",
        $"{Root}.WANDevice", $"{Root}.IPPingDiagnostics", $"{Root}.TraceRouteDiagnostics",
        $"{Root}.DownloadDiagnostics", $"{Root}.UploadDiagnostics", TimeRoot,
        ManagementRoot, $"{Root}.Layer3Forwarding", $"{Root}.QueueManagement",
        $"{Root}.Services", $"{Root}.X_HW_Security", $"{Root}.UserInterface",
    });

    /// <summary>Que tan certificada esta cada operacion en este firmware.</summary>
    public static readonly IReadOnlyDictionary<string, string> ActionStatus = new Dictionary<string, string>
    {
        ["refresh"] = "verified", ["set_wifi"] = "detected", ["reboot"] = "verified",
        ["set_lan_port"] = "detected", ["set_dhcp"] = "detected", ["set_time"] = "detected",
        ["run_ping"] = "detected", ["run_traceroute"] = "detected",
        ["run_download_diagnostic"] = "detected", ["run_upload_diagnostic"] = "detected",
        ["upsert_dhcp_reservation"] = "blocked", ["delete_dhcp_reservation"] = "blocked",
        ["set_wan"] = "blocked", ["upsert_port_mapping"] = "blocked", ["delete_port_mapping"] = "blocked",
        ["set_security"] = "blocked", ["set_acs"] = "blocked", ["factory_reset"] = "blocked",
        ["firmware_download"] = "blocked",
    };

    private readonly HttpClient _http = new();
    private readonly string _baseUrl;
    private readonly double _timeoutSeconds;
    private readonly Dictionary<string, Dictionary<string, string>> _identityHints = new();

    public GenieAcsClient(string? baseUrl = null, double timeoutSeconds = 20)
    {
        var configured = baseUrl ?? Environment.GetEnvironmentVariable("GENIEACS_NBI_URL");
        _baseUrl = (string.IsNullOrWhiteSpace(configured) ? "http://127.0.0.1:7557" : configured).TrimEnd('/');
        _timeoutSeconds = timeoutSeconds;
        RefreshConfirmTimeoutSeconds = 45;
    }

    public double RefreshConfirmTimeoutSeconds { get; set; }

    /// <summary>Pistas que manda ISP Max para enlazar una ONU cuyo serial no coincide literalmente.</summary>
    public void SetIdentityHints(string serial, JsonNode? hints)
    {
        var key = Regex.Replace((serial ?? string.Empty).ToUpperInvariant(), "[^A-Z0-9]", string.Empty);
        if (key.Length == 0) return;

        var clean = new Dictionary<string, string>();
        if (hints is JsonObject node)
        {
            foreach (var field in new[] { "acsDeviceId", "ip", "mac", "model" })
            {
                var value = node[field]?.ToString().Trim();
                if (!string.IsNullOrWhiteSpace(value)) clean[field] = value;
            }
        }
        if (clean.Count > 0) _identityHints[key] = clean;
    }

    // ─────────────────────────── Navegacion del documento ───────────────────────────

    internal static JsonObject? LeafNode(JsonNode? node, string path)
    {
        var current = node;
        foreach (var part in path.Split('.'))
        {
            if (current is not JsonObject obj || !obj.ContainsKey(part)) return null;
            current = obj[part];
        }
        return current is JsonObject leaf && leaf.ContainsKey("_value") ? leaf : null;
    }

    internal static JsonObject ObjectNode(JsonNode? node, string path)
    {
        var current = node;
        foreach (var part in path.Split('.'))
        {
            if (current is not JsonObject obj || !obj.ContainsKey(part)) return new JsonObject();
            current = obj[part];
        }
        return current as JsonObject ?? new JsonObject();
    }

    internal static JsonNode? LeafValue(JsonNode? node, string path, JsonNode? fallback = null)
    {
        var leaf = LeafNode(node, path);
        var value = leaf?["_value"];
        return value is null ? fallback : value.DeepClone();
    }

    private static bool LeafBool(JsonNode? node, string path, bool fallback = false)
    {
        var value = LeafValue(node, path);
        return value switch
        {
            null => fallback,
            JsonValue jsonValue when jsonValue.TryGetValue<bool>(out var boolean) => boolean,
            _ => value.ToString() is "1" or "true" or "True",
        };
    }

    internal static DateTime? ParseTimestamp(JsonNode? value)
    {
        var text = value?.ToString();
        if (string.IsNullOrWhiteSpace(text)) return null;
        return DateTime.TryParse(text, null, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed
            : null;
    }

    /// <summary>Formas en que el serial puede aparecer en el ACS (ASCII o hexadecimal).</summary>
    internal static HashSet<string> SerialCandidates(string value)
    {
        var serial = Regex.Replace((value ?? string.Empty).ToUpperInvariant(), "[^A-Z0-9]", string.Empty);
        var result = new HashSet<string>(StringComparer.Ordinal);
        if (serial.Length == 0) return result;
        result.Add(serial);

        if (Regex.IsMatch(serial, "^[A-Z]{4}[A-F0-9]+$"))
        {
            var hex = string.Concat(Encoding.ASCII.GetBytes(serial[..4]).Select(item => item.ToString("X2")));
            result.Add(hex + serial[4..]);
        }
        if (Regex.IsMatch(serial, "^[A-F0-9]{8}[A-F0-9]+$"))
        {
            try
            {
                var bytes = new byte[4];
                for (var index = 0; index < 4; index++) bytes[index] = Convert.ToByte(serial.Substring(index * 2, 2), 16);
                var vendor = Encoding.ASCII.GetString(bytes);
                if (Regex.IsMatch(vendor, "^[A-Z0-9]{4}$")) result.Add(vendor + serial[8..]);
            }
            catch (Exception)
            {
                // No era un prefijo de fabricante valido.
            }
        }
        return result;
    }

    // ─────────────────────────── HTTP ───────────────────────────

    private async Task<JsonNode?> RequestAsync(string path, HttpMethod? method = null, object? body = null, CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(method ?? HttpMethod.Get, $"{_baseUrl}{path}");
        request.Headers.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));
        if (body is not null)
            request.Content = new StringContent(JsonDefaults.ToJson(body, camelCase: true), Encoding.UTF8, "application/json");

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_timeoutSeconds));

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new GenieAcsException("GenieACS local no responde: tiempo agotado", "GENIEACS_UNAVAILABLE");
        }
        catch (HttpRequestException exception)
        {
            throw new GenieAcsException($"GenieACS local no responde: {exception.Message}", "GENIEACS_UNAVAILABLE");
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
            {
                var detail = text.Length > 800 ? text[..800] : text;
                var code = new[] { "9002", "9003", "9005", "9007", "9010" }.Any(detail.Contains) ? "CWMP_FAULT" : "GENIEACS_HTTP";
                throw new GenieAcsException($"GenieACS respondio HTTP {(int)response.StatusCode}: {detail}", code);
            }

            if (string.IsNullOrWhiteSpace(text)) return new JsonObject { ["_httpStatus"] = (int)response.StatusCode };
            var node = JsonNode.Parse(text);
            if (node is JsonObject obj && !obj.ContainsKey("_httpStatus")) obj["_httpStatus"] = (int)response.StatusCode;
            return node;
        }
    }

    public async Task<JsonObject> FindDeviceAsync(string serial, CancellationToken cancellationToken = default)
    {
        var devices = await RequestAsync($"/devices/?projection={Uri.EscapeDataString(Projection)}", cancellationToken: cancellationToken).ConfigureAwait(false);
        var rows = devices as JsonArray ?? new JsonArray();
        var candidates = SerialCandidates(serial);

        foreach (var row in rows)
        {
            if (row is not JsonObject device) continue;
            var identity = JsonDefaults.ToJson(new { id = device["_id"]?.ToString(), device = device["_deviceId"]?.ToJsonString() }).ToUpperInvariant();
            var compact = Regex.Replace(identity, "[^A-Z0-9]", string.Empty);
            if (candidates.Any(candidate => candidate.Length > 0 && compact.Contains(candidate, StringComparison.Ordinal)))
                return device;
        }

        var key = Regex.Replace((serial ?? string.Empty).ToUpperInvariant(), "[^A-Z0-9]", string.Empty);
        var hints = _identityHints.GetValueOrDefault(key) ?? new Dictionary<string, string>();
        var matches = rows.OfType<JsonObject>().Where(device => MatchesIdentityHints(device, hints)).ToList();

        if (matches.Count == 1) return matches[0];
        if (matches.Count > 1)
            throw new GenieAcsException(
                $"La ONU {serial} coincide con varios dispositivos CWMP; no se enlazo automaticamente", "DEVICE_IDENTITY_AMBIGUOUS");
        throw new GenieAcsException($"La ONU {serial} no aparece en GenieACS", "DEVICE_NOT_FOUND");
    }

    private static List<string> LeafValues(JsonNode? node)
    {
        var values = new List<string>();
        Walk(node);
        return values;

        void Walk(JsonNode? current)
        {
            if (current is not JsonObject obj) return;
            if (obj.TryGetPropertyValue("_value", out var value) && value is not null)
            {
                values.Add(value.ToString().Trim());
                return;
            }
            foreach (var (name, child) in obj)
                if (!name.StartsWith('_')) Walk(child);
        }
    }

    private static bool MatchesIdentityHints(JsonObject device, IReadOnlyDictionary<string, string> hints)
    {
        if (hints.TryGetValue("acsDeviceId", out var acsDeviceId) && device["_id"]?.ToString() == acsDeviceId) return true;

        var values = LeafValues(device);
        if (hints.TryGetValue("ip", out var expectedIp) && !string.IsNullOrWhiteSpace(expectedIp))
            return values.Contains(expectedIp);

        if (hints.TryGetValue("mac", out var mac))
        {
            var expectedMac = Regex.Replace(mac.ToUpperInvariant(), "[^A-F0-9]", string.Empty);
            if (expectedMac.Length > 0)
                return values.Select(value => Regex.Replace(value.ToUpperInvariant(), "[^A-F0-9]", string.Empty)).Contains(expectedMac);
        }
        // El modelo solo no identifica un equipo: no basta para enlazar.
        return false;
    }

    private Task<JsonNode?> TaskAsync(string deviceId, object body, CancellationToken cancellationToken = default) =>
        RequestAsync($"/devices/{Uri.EscapeDataString(deviceId)}/tasks?connection_request", HttpMethod.Post, body, cancellationToken);

    internal static List<(int Index, JsonObject Row)> Rows(JsonNode? node, string path)
    {
        var current = node;
        foreach (var part in path.Split('.'))
            current = current is JsonObject obj ? obj[part] : null;

        if (current is not JsonObject table) return new List<(int, JsonObject)>();
        return table
            .Where(pair => int.TryParse(pair.Key, out _) && pair.Value is JsonObject)
            .Select(pair => (int.Parse(pair.Key), (JsonObject)pair.Value!))
            .OrderBy(item => item.Item1)
            .ToList();
    }

    /// <summary>Parametros legibles del equipo, sin ninguna clave.</summary>
    internal static JsonArray SafeParameters(JsonObject device, int maximum = 2000)
    {
        var result = new JsonArray();
        Walk(device[Root], Root);
        return result;

        void Walk(JsonNode? node, string path)
        {
            if (result.Count >= maximum || node is not JsonObject obj) return;

            if (obj.ContainsKey("_value"))
            {
                if (SecretPath.IsMatch(path)) return;
                var raw = obj["_value"];
                JsonNode? value = raw switch
                {
                    null => null,
                    JsonObject or JsonArray => JsonValue.Create(Truncate(raw.ToJsonString())),
                    _ => raw.ToString().Length > 256 ? JsonValue.Create(raw.ToString()[..256]) : raw.DeepClone(),
                };
                result.Add(new JsonObject
                {
                    ["path"] = path,
                    ["value"] = value,
                    ["type"] = obj["_type"]?.DeepClone(),
                    ["writable"] = obj["_writable"]?.GetValue<bool>() == true,
                });
                return;
            }

            foreach (var (name, child) in obj)
                if (!name.StartsWith('_')) Walk(child, path.Length == 0 ? name : $"{path}.{name}");
        }

        static string Truncate(string value) => value.Length > 256 ? value[..256] : value;
    }

    public JsonObject Capabilities(JsonObject device)
    {
        var manufacturer = (LeafValue(device, $"{DeviceInfo}.Manufacturer")?.ToString()
            ?? device["_deviceId"]?["_Manufacturer"]?.ToString() ?? string.Empty).ToLowerInvariant();
        var model = (LeafValue(device, $"{DeviceInfo}.ModelName")?.ToString()
            ?? LeafValue(device, $"{DeviceInfo}.ProductClass")?.ToString()
            ?? device["_deviceId"]?["_ProductClass"]?.ToString() ?? string.Empty).ToLowerInvariant();

        var required = new Dictionary<string, string>
        {
            ["set_lan_port"] = $"{LanRoot}.LANEthernetInterfaceConfig.1.Enable",
            ["set_dhcp"] = $"{DhcpRoot}.DHCPServerEnable",
            ["set_time"] = $"{TimeRoot}.Enable",
            ["run_ping"] = $"{Root}.IPPingDiagnostics.DiagnosticsState",
            ["run_traceroute"] = $"{Root}.TraceRouteDiagnostics.DiagnosticsState",
            ["run_download_diagnostic"] = $"{Root}.DownloadDiagnostics.DiagnosticsState",
            ["run_upload_diagnostic"] = $"{Root}.UploadDiagnostics.DiagnosticsState",
        };

        var actions = new JsonObject();
        foreach (var (name, defaultStatus) in ActionStatus)
        {
            var status = defaultStatus;
            if (name == "set_wifi" && manufacturer.Contains("huawei") && model.Contains("eg8141a5")) status = "verified";
            if (required.TryGetValue(name, out var path) && LeafNode(device, path) is null) status = "blocked";
            actions[name] = new JsonObject { ["status"] = status, ["verifiedAt"] = null, ["lastError"] = null };
        }

        return new JsonObject
        {
            ["actions"] = actions,
            ["parameterCount"] = SafeParameters(device).Count,
            ["collectedAt"] = Storage.Clock.UtcNow(),
        };
    }

    // ─────────────────────────── Lectura completa ───────────────────────────

    public async Task<JsonObject> SnapshotAsync(string serial, bool includeParameters = true, CancellationToken cancellationToken = default)
    {
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        var wifi = ObjectNode(device, WifiRoot);
        var wanRows = Rows(device, WanRoot);
        var activeWan = wanRows.FirstOrDefault(row => LeafValue(row.Row, "ConnectionStatus")?.ToString() == "Connected").Row
            ?? (wanRows.Count > 0 ? wanRows[0].Row : new JsonObject());

        var clients = new JsonArray();
        if (wifi["AssociatedDevice"] is JsonObject associated)
        {
            foreach (var (key, row) in associated)
            {
                if (!int.TryParse(key, out var index) || row is not JsonObject entry) continue;
                clients.Add(new JsonObject
                {
                    ["source"] = "wifi",
                    ["index"] = index,
                    ["mac"] = LeafValue(entry, "AssociatedDeviceMACAddress"),
                    ["ip"] = LeafValue(entry, "AssociatedDeviceIPAddress"),
                    ["signal"] = LeafValue(entry, "X_HW_RSSI"),
                });
            }
        }
        foreach (var (index, row) in Rows(device, $"{LanRoot}.Hosts.Host"))
        {
            clients.Add(new JsonObject
            {
                ["source"] = "dhcp", ["index"] = index,
                ["mac"] = LeafValue(row, "MACAddress"), ["ip"] = LeafValue(row, "IPAddress"),
                ["hostName"] = LeafValue(row, "HostName"), ["interface"] = LeafValue(row, "InterfaceType"),
                ["active"] = LeafValue(row, "Active"),
            });
        }

        var lanPorts = new JsonArray();
        foreach (var (index, row) in Rows(device, $"{LanRoot}.LANEthernetInterfaceConfig"))
        {
            lanPorts.Add(new JsonObject
            {
                ["port"] = index,
                ["enabled"] = LeafBool(row, "Enable"),
                ["status"] = LeafValue(row, "Status"),
                ["speed"] = LeafValue(row, "MaxBitRate"),
                ["duplex"] = LeafValue(row, "DuplexMode"),
                ["flowControl"] = LeafBool(row, "X_HW_FlowCtrlEnable"),
                ["l3Enabled"] = LeafBool(row, "X_HW_L3Enable"),
                ["bytesReceived"] = LeafValue(row, "Stats.BytesReceived"),
                ["bytesSent"] = LeafValue(row, "Stats.BytesSent"),
                ["errorsReceived"] = LeafValue(row, "Stats.ErrorsReceived"),
                ["errorsSent"] = LeafValue(row, "Stats.ErrorsSent"),
            });
        }

        var mappings = new JsonArray();
        foreach (var (index, row) in Rows(activeWan, "PortMapping"))
        {
            mappings.Add(new JsonObject
            {
                ["instance"] = index,
                ["enabled"] = LeafBool(row, "PortMappingEnabled"),
                ["protocol"] = LeafValue(row, "PortMappingProtocol"),
                ["externalPort"] = LeafValue(row, "ExternalPort"),
                ["internalPort"] = LeafValue(row, "InternalPort"),
                ["internalClient"] = LeafValue(row, "InternalClient"),
                ["description"] = LeafValue(row, "PortMappingDescription"),
            });
        }

        var lastInform = device["_lastInform"];
        var lastInformAt = ParseTimestamp(lastInform);
        var ageSeconds = lastInformAt is null ? (double?)null : (DateTime.UtcNow - lastInformAt.Value).TotalSeconds;

        var snapshot = new JsonObject
        {
            ["deviceId"] = device["_id"]?.DeepClone(),
            ["manufacturer"] = LeafValue(device, $"{DeviceInfo}.Manufacturer") ?? device["_deviceId"]?["_Manufacturer"]?.DeepClone(),
            ["model"] = LeafValue(device, $"{DeviceInfo}.ModelName")
                ?? LeafValue(device, $"{DeviceInfo}.ProductClass")
                ?? device["_deviceId"]?["_ProductClass"]?.DeepClone(),
            ["softwareVersion"] = LeafValue(device, $"{DeviceInfo}.SoftwareVersion"),
            ["lastInformAt"] = lastInform?.DeepClone(),
            ["online"] = ageSeconds is not null && ageSeconds < 3600,
            ["overview"] = new JsonObject
            {
                ["uptime"] = LeafValue(device, $"{DeviceInfo}.UpTime"),
                ["cpuUsage"] = LeafValue(device, $"{DeviceInfo}.ProcessStatus.CPUUsage") ?? LeafValue(device, $"{DeviceInfo}.X_HW_CpuUsed"),
                ["memoryFree"] = LeafValue(device, $"{DeviceInfo}.MemoryStatus.Free"),
                ["memoryTotal"] = LeafValue(device, $"{DeviceInfo}.MemoryStatus.Total"),
            },
            ["fiber"] = new JsonObject
            {
                ["status"] = LeafValue(device, $"{FiberRoot}.Status"),
                ["rxPower"] = LeafValue(device, $"{FiberRoot}.RXPower"),
                ["txPower"] = LeafValue(device, $"{FiberRoot}.TXPower"),
                ["temperature"] = LeafValue(device, $"{FiberRoot}.TransceiverTemperature"),
                ["voltage"] = LeafValue(device, $"{FiberRoot}.SupplyVoltage"),
                ["biasCurrent"] = LeafValue(device, $"{FiberRoot}.BiasCurrent"),
                ["fecErrors"] = LeafValue(device, $"{FiberRoot}.Stats.FECError"),
                ["hecErrors"] = LeafValue(device, $"{FiberRoot}.Stats.HECError"),
                ["dropPackets"] = LeafValue(device, $"{FiberRoot}.Stats.DropPackets"),
                ["bytesReceived"] = LeafValue(device, $"{FiberRoot}.Stats.BytesReceived"),
                ["bytesSent"] = LeafValue(device, $"{FiberRoot}.Stats.BytesSent"),
            },
            ["wifi"] = new JsonObject
            {
                ["enabled"] = LeafBool(wifi, "Enable"),
                ["ssid"] = LeafValue(wifi, "SSID"),
                ["channel"] = LeafValue(wifi, "Channel"),
                ["broadcast"] = LeafBool(wifi, "SSIDAdvertisementEnabled", true) && LeafBool(wifi, "BeaconAdvertisementEnabled", true),
                ["clients"] = clients.Count(row => row?["source"]?.ToString() == "wifi"),
                ["transmitPower"] = LeafValue(wifi, "TransmitPower"),
                ["standard"] = LeafValue(wifi, "X_HW_Standard") ?? LeafValue(wifi, "Standard"),
                ["maxClients"] = LeafValue(wifi, "X_HW_AssociateNum") ?? LeafValue(wifi, "X_ZTE-COM_MaxUserNum"),
                ["wmm"] = LeafBool(wifi, "WMMEnable"),
                ["wps"] = LeafBool(wifi, "WPS.Enable"),
            },
            ["wan"] = new JsonObject
            {
                ["ip"] = LeafValue(activeWan, "ExternalIPAddress"),
                ["status"] = LeafValue(activeWan, "ConnectionStatus"),
                ["vlan"] = LeafValue(activeWan, "X_HW_VLAN") ?? LeafValue(activeWan, "X_ZTE-COM_VLANID"),
                ["addressingType"] = LeafValue(activeWan, "AddressingType"),
                ["gateway"] = LeafValue(activeWan, "DefaultGateway"),
                ["dnsServers"] = LeafValue(activeWan, "DNSServers"),
                ["natEnabled"] = LeafBool(activeWan, "NATEnabled"),
                ["mtu"] = LeafValue(activeWan, "MaxMTUSize"),
                ["serviceList"] = LeafValue(activeWan, "X_HW_SERVICELIST") ?? LeafValue(activeWan, "X_ZTE-COM_ServiceList"),
            },
            ["dhcp"] = new JsonObject
            {
                ["enabled"] = LeafBool(device, $"{DhcpRoot}.DHCPServerEnable"),
                ["minAddress"] = LeafValue(device, $"{DhcpRoot}.MinAddress"),
                ["maxAddress"] = LeafValue(device, $"{DhcpRoot}.MaxAddress"),
                ["subnetMask"] = LeafValue(device, $"{DhcpRoot}.SubnetMask"),
                ["router"] = LeafValue(device, $"{DhcpRoot}.IPRouters"),
                ["dnsServers"] = LeafValue(device, $"{DhcpRoot}.DNSServers"),
                ["leaseTime"] = LeafValue(device, $"{DhcpRoot}.DHCPLeaseTime"),
            },
            ["system"] = new JsonObject
            {
                ["timeEnabled"] = LeafBool(device, $"{TimeRoot}.Enable"),
                ["timeStatus"] = LeafValue(device, $"{TimeRoot}.Status"),
                ["timeZone"] = LeafValue(device, $"{TimeRoot}.LocalTimeZone"),
                ["timeZoneName"] = LeafValue(device, $"{TimeRoot}.LocalTimeZoneName"),
                ["periodicInformEnabled"] = LeafBool(device, $"{ManagementRoot}.PeriodicInformEnable"),
                ["periodicInformInterval"] = LeafValue(device, $"{ManagementRoot}.PeriodicInformInterval"),
            },
            ["lanPorts"] = lanPorts,
            ["clients"] = clients,
            ["portMappings"] = mappings,
            ["diagnostics"] = DiagnosticSnapshot(device),
            ["collectedAt"] = Storage.Clock.UtcNow(),
        };

        if (includeParameters) snapshot["parameters"] = SafeParameters(device);
        return snapshot;
    }

    private static JsonObject DiagnosticSnapshot(JsonObject device)
    {
        var definitions = new (string Name, string Root, string[] Fields)[]
        {
            ("ping", $"{Root}.IPPingDiagnostics", new[] { "DiagnosticsState", "Host", "SuccessCount", "FailureCount", "AverageResponseTime", "MinimumResponseTime", "MaximumResponseTime" }),
            ("traceroute", $"{Root}.TraceRouteDiagnostics", new[] { "DiagnosticsState", "Host", "ResponseTime", "RouteHopsNumberOfEntries" }),
            ("download", $"{Root}.DownloadDiagnostics", new[] { "DiagnosticsState", "ROMTime", "BOMTime", "EOMTime", "TestBytesReceived", "TotalBytesReceived" }),
            ("upload", $"{Root}.UploadDiagnostics", new[] { "DiagnosticsState", "ROMTime", "BOMTime", "EOMTime", "TotalBytesSent" }),
        };

        var result = new JsonObject();
        foreach (var (name, root, fields) in definitions)
        {
            var entry = new JsonObject();
            foreach (var field in fields) entry[field] = LeafValue(device, $"{root}.{field}");
            result[name] = entry;
        }
        return result;
    }

    // ─────────────────────────── Aplicacion de cambios ───────────────────────────

    public async Task<JsonObject> RefreshAsync(string serial, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        var previousInform = device["_lastInform"]?.ToString();
        progress?.Invoke("refreshing", 20);

        var requestTimedOut = false;
        try
        {
            await TaskAsync(device["_id"]!.ToString(), new { name = "refreshObject", objectName = "" }, cancellationToken).ConfigureAwait(false);
        }
        catch (GenieAcsException exception)
        {
            if (!exception.Message.ToLowerInvariant().Contains("tiempo agotado")) throw;
            requestTimedOut = true;
        }

        var snapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
        var deadline = Stopwatch.StartNew();
        var limit = TimeSpan.FromSeconds(requestTimedOut ? RefreshConfirmTimeoutSeconds : 1);

        while (requestTimedOut && snapshot["lastInformAt"]?.ToString() == previousInform && deadline.Elapsed < limit)
        {
            progress?.Invoke("waiting_for_inform", 70);
            await Task.Delay(1000, cancellationToken).ConfigureAwait(false);
            snapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
        }

        if (requestTimedOut && snapshot["lastInformAt"]?.ToString() == previousInform)
            throw new GenieAcsException("La ONU no confirmo el refresco antes del tiempo limite", "REFRESH_TIMEOUT");

        progress?.Invoke("verified", 95);
        return snapshot;
    }

    public sealed record ParameterValue(string Path, JsonNode? Value, string Type);

    private static Dictionary<string, JsonNode?> AssertWritable(JsonObject device, IReadOnlyList<ParameterValue> values)
    {
        var originals = new Dictionary<string, JsonNode?>();
        foreach (var value in values)
        {
            var leaf = LeafNode(device, value.Path)
                ?? throw new GenieAcsException($"El firmware no expone {value.Path}", "PARAMETER_NOT_FOUND");
            if (leaf["_writable"]?.GetValue<bool>() != true)
                throw new GenieAcsException($"El firmware no permite modificar {value.Path}", "PARAMETER_READ_ONLY");
            originals[value.Path] = leaf["_value"]?.DeepClone();
        }
        return originals;
    }

    private async Task<(JsonObject Snapshot, JsonObject Verification)> WaitForValuesAsync(
        string serial, IReadOnlyDictionary<string, JsonNode?> expected, double timeoutSeconds = 20,
        Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var deadline = Stopwatch.StartNew();
        var actual = new JsonObject();

        while (deadline.Elapsed < TimeSpan.FromSeconds(timeoutSeconds))
        {
            var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
            actual = new JsonObject();
            foreach (var path in expected.Keys) actual[path] = LeafValue(device, path);

            var matches = expected.All(pair =>
                (actual[pair.Key]?.ToJsonString() ?? "null") == (pair.Value?.ToJsonString() ?? "null"));
            if (matches)
            {
                var snapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
                return (snapshot, new JsonObject
                {
                    ["expected"] = ToJsonObject(expected),
                    ["actual"] = actual,
                    ["verified"] = true,
                });
            }

            progress?.Invoke("verifying", 75);
            await Task.Delay(1000, cancellationToken).ConfigureAwait(false);
        }

        return (new JsonObject(), new JsonObject
        {
            ["expected"] = ToJsonObject(expected),
            ["actual"] = actual,
            ["verified"] = false,
        });
    }

    private static JsonObject ToJsonObject(IReadOnlyDictionary<string, JsonNode?> values)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values) result[key] = value?.DeepClone();
        return result;
    }

    private static JsonObject Protect(JsonObject values)
    {
        var result = new JsonObject();
        foreach (var (key, value) in values)
            result[key] = SecretPath.IsMatch(key) ? "[protected]" : value?.DeepClone();
        return result;
    }

    private async Task<(JsonObject Snapshot, JsonObject Verification, JsonObject Rollback)> ApplyParametersAsync(
        string serial, IReadOnlyList<ParameterValue> values, bool reversible = true,
        Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        var originals = AssertWritable(device, values);

        progress?.Invoke("backup", 15);
        progress?.Invoke("applying", 45);

        var payload = values.Select(value => new JsonArray(value.Path, value.Value?.DeepClone(), value.Type)).ToArray();
        var task = await TaskAsync(device["_id"]!.ToString(),
            new { name = "setParameterValues", parameterValues = payload }, cancellationToken).ConfigureAwait(false);

        var expected = values.ToDictionary(value => value.Path, value => value.Value);
        var (snapshot, verification) = await WaitForValuesAsync(serial, expected, progress: progress, cancellationToken: cancellationToken).ConfigureAwait(false);

        var safeVerification = new JsonObject
        {
            ["verified"] = verification["verified"]?.DeepClone(),
            ["expected"] = Protect(verification["expected"] as JsonObject ?? new JsonObject()),
            ["actual"] = Protect(verification["actual"] as JsonObject ?? new JsonObject()),
        };
        var rollback = new JsonObject
        {
            ["attempted"] = false,
            ["succeeded"] = null,
            ["originalValues"] = Protect(ToJsonObject(originals)),
        };

        if (verification["verified"]?.GetValue<bool>() == true)
        {
            safeVerification["genieAcsHttpStatus"] = (task as JsonObject)?["_httpStatus"]?.DeepClone();
            return (snapshot, safeVerification, rollback);
        }

        if (reversible)
        {
            rollback["attempted"] = true;
            var types = values.ToDictionary(value => value.Path, value => value.Type);
            var rollbackValues = originals.Select(pair => new JsonArray(pair.Key, pair.Value?.DeepClone(), types[pair.Key])).ToArray();
            try
            {
                await TaskAsync(device["_id"]!.ToString(),
                    new { name = "setParameterValues", parameterValues = rollbackValues }, cancellationToken).ConfigureAwait(false);
                var (_, rollbackCheck) = await WaitForValuesAsync(serial, originals, 12, cancellationToken: cancellationToken).ConfigureAwait(false);
                rollback["succeeded"] = rollbackCheck["verified"]?.DeepClone();
            }
            catch (Exception exception)
            {
                rollback["succeeded"] = false;
                var text = exception.Message;
                rollback["error"] = text.Length > 300 ? text[..300] : text;
            }
        }

        throw new GenieAcsException("La ONU no confirmo los valores solicitados", "READBACK_MISMATCH", rollback, safeVerification);
    }

    private static JsonObject Result(string message, JsonObject snapshot, JsonObject? verification, JsonObject? rollback) => new()
    {
        ["message"] = message,
        ["snapshot"] = snapshot,
        ["verification"] = verification,
        ["rollback"] = rollback,
    };

    // ─────────────────────────── Acciones ───────────────────────────

    public async Task<JsonObject> SetWifiAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        var values = new List<ParameterValue>();

        var mapping = new (string Key, string Parameter, string Type)[]
        {
            ("ssid", "SSID", "xsd:string"),
            ("transmitPower", "TransmitPower", "xsd:unsignedInt"),
            ("wmm", "WMMEnable", "xsd:boolean"),
            ("wps", "WPS.Enable", "xsd:boolean"),
        };
        foreach (var (key, parameter, type) in mapping)
            if (payload[key] is not null) values.Add(new ParameterValue($"{WifiRoot}.{parameter}", payload[key]!.DeepClone(), type));

        var vendorFields = new (string Key, (string Parameter, string Type)[] Candidates)[]
        {
            ("standard", new[] { ("X_HW_Standard", "xsd:string"), ("Standard", "xsd:string") }),
            ("maxClients", new[] { ("X_HW_AssociateNum", "xsd:unsignedInt"), ("X_ZTE-COM_MaxUserNum", "xsd:unsignedInt") }),
        };
        foreach (var (key, candidates) in vendorFields)
        {
            if (payload[key] is null) continue;
            (string Parameter, string Type)? selected = null;
            JsonNode? current = null;
            foreach (var candidate in candidates)
            {
                var leaf = LeafNode(device, $"{WifiRoot}.{candidate.Item1}");
                if (leaf is null) continue;
                current = leaf["_value"];
                if (leaf["_writable"]?.GetValue<bool>() == true)
                {
                    selected = candidate;
                    break;
                }
            }
            if (selected is not null)
                values.Add(new ParameterValue($"{WifiRoot}.{selected.Value.Parameter}", payload[key]!.DeepClone(), selected.Value.Type));
            else if (current?.ToJsonString() != payload[key]!.ToJsonString())
                throw new GenieAcsException($"Este firmware no permite modificar {key} por TR-069", "PARAMETER_READ_ONLY");
        }

        if (payload["channel"] is not null)
        {
            var channel = int.Parse(payload["channel"]!.ToString());
            values.Add(new ParameterValue($"{WifiRoot}.AutoChannelEnable", JsonValue.Create(channel == 0), "xsd:boolean"));
            if (channel != 0) values.Add(new ParameterValue($"{WifiRoot}.Channel", JsonValue.Create(channel), "xsd:unsignedInt"));
        }

        if (payload["enabled"] is not null)
        {
            var enabled = payload["enabled"]!.GetValue<bool>();
            values.Add(new ParameterValue($"{WifiRoot}.Enable", JsonValue.Create(enabled), "xsd:boolean"));
            values.Add(new ParameterValue($"{WifiRoot}.RadioEnabled", JsonValue.Create(enabled), "xsd:boolean"));
        }

        if (payload["broadcast"] is not null)
        {
            values.Add(new ParameterValue($"{WifiRoot}.SSIDAdvertisementEnabled", JsonValue.Create(payload["broadcast"]!.GetValue<bool>()), "xsd:boolean"));
            var beacon = LeafNode(device, $"{WifiRoot}.BeaconAdvertisementEnabled");
            if (beacon?["_writable"]?.GetValue<bool>() == true)
                values.Add(new ParameterValue($"{WifiRoot}.BeaconAdvertisementEnabled", JsonValue.Create(true), "xsd:boolean"));
        }

        if (payload["password"] is not null)
        {
            var preSharedKey = LeafNode(device, $"{WifiRoot}.PreSharedKey.1.KeyPassphrase");
            var rootKey = LeafNode(device, $"{WifiRoot}.KeyPassphrase");
            var parameter = preSharedKey?["_writable"]?.GetValue<bool>() == true
                ? "PreSharedKey.1.KeyPassphrase"
                : rootKey?["_writable"]?.GetValue<bool>() == true
                    ? "KeyPassphrase"
                    : throw new GenieAcsException("Este firmware no expone una clave WiFi editable por TR-069", "PARAMETER_READ_ONLY");
            values.Add(new ParameterValue($"{WifiRoot}.{parameter}", payload["password"]!.DeepClone(), "xsd:string"));
        }

        if (values.Count == 0) throw new GenieAcsException("La tarea WiFi no contiene cambios", "EMPTY_TASK");

        var (snapshot, verification, rollback) = await ApplyParametersAsync(serial, values, progress: progress, cancellationToken: cancellationToken).ConfigureAwait(false);
        return Result("Configuracion WiFi aplicada y verificada", snapshot, verification, rollback);
    }

    private async Task<JsonObject> ApplyMappingAsync(
        string serial, JsonObject payload, string rootPath, (string Key, string Field, string Type)[] mapping,
        string message, bool reversible, Action<string, int>? progress, CancellationToken cancellationToken,
        params ParameterValue[] extra)
    {
        var values = mapping
            .Where(item => payload[item.Key] is not null)
            .Select(item => new ParameterValue($"{rootPath}.{item.Field}", payload[item.Key]!.DeepClone(), item.Type))
            .Concat(extra)
            .ToList();

        var (snapshot, verification, rollback) = await ApplyParametersAsync(serial, values, reversible, progress, cancellationToken).ConfigureAwait(false);
        return Result(message, snapshot, verification, rollback);
    }

    public Task<JsonObject> SetLanPortAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default) =>
        ApplyMappingAsync(serial, payload, $"{LanRoot}.LANEthernetInterfaceConfig.{payload["port"]}", new[]
        {
            ("enabled", "Enable", "xsd:boolean"),
            ("speed", "MaxBitRate", "xsd:string"),
            ("duplex", "DuplexMode", "xsd:string"),
            ("flowControl", "X_HW_FlowCtrlEnable", "xsd:boolean"),
            ("l3Enabled", "X_HW_L3Enable", "xsd:boolean"),
        }, "Puerto LAN aplicado y verificado", true, progress, cancellationToken);

    public Task<JsonObject> SetDhcpAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default) =>
        ApplyMappingAsync(serial, payload, DhcpRoot, new[]
        {
            ("enabled", "DHCPServerEnable", "xsd:boolean"),
            ("minAddress", "MinAddress", "xsd:string"),
            ("maxAddress", "MaxAddress", "xsd:string"),
            ("subnetMask", "SubnetMask", "xsd:string"),
            ("router", "IPRouters", "xsd:string"),
            ("dnsServers", "DNSServers", "xsd:string"),
            ("leaseTime", "DHCPLeaseTime", "xsd:int"),
        }, "LAN y DHCP aplicados y verificados", true, progress, cancellationToken);

    public async Task<JsonObject> SetTimeAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var mapping = new (string Key, string Path, string Type)[]
        {
            ("enabled", $"{TimeRoot}.Enable", "xsd:boolean"),
            ("ntpServer1", $"{TimeRoot}.NTPServer1", "xsd:string"),
            ("ntpServer2", $"{TimeRoot}.NTPServer2", "xsd:string"),
            ("timeZone", $"{TimeRoot}.LocalTimeZone", "xsd:string"),
            ("timeZoneName", $"{TimeRoot}.LocalTimeZoneName", "xsd:string"),
            ("informInterval", $"{ManagementRoot}.PeriodicInformInterval", "xsd:unsignedInt"),
        };
        var values = mapping
            .Where(item => payload[item.Key] is not null)
            .Select(item => new ParameterValue(item.Path, payload[item.Key]!.DeepClone(), item.Type))
            .ToList();
        if (payload["informInterval"] is not null)
            values.Add(new ParameterValue($"{ManagementRoot}.PeriodicInformEnable", JsonValue.Create(true), "xsd:boolean"));

        var (snapshot, verification, rollback) = await ApplyParametersAsync(serial, values, true, progress, cancellationToken).ConfigureAwait(false);
        return Result("Hora e intervalo TR-069 aplicados", snapshot, verification, rollback);
    }

    public Task<JsonObject> SetWanAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default) =>
        ApplyMappingAsync(serial, payload, $"{WanRoot}.{payload["connection"] ?? 1}", new[]
        {
            ("enabled", "Enable", "xsd:boolean"),
            ("addressingType", "AddressingType", "xsd:string"),
            ("ipAddress", "ExternalIPAddress", "xsd:string"),
            ("subnetMask", "SubnetMask", "xsd:string"),
            ("gateway", "DefaultGateway", "xsd:string"),
            ("dnsServers", "DNSServers", "xsd:string"),
            ("vlan", "X_HW_VLAN", "xsd:unsignedInt"),
            ("mtu", "MaxMTUSize", "xsd:unsignedInt"),
            ("natEnabled", "NATEnabled", "xsd:boolean"),
            ("serviceList", "X_HW_SERVICELIST", "xsd:string"),
        }, "WAN aplicada y verificada", true, progress, cancellationToken);

    public Task<JsonObject> SetSecurityAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default) =>
        ApplyMappingAsync(serial, payload, $"{WanRoot}.{payload["connection"] ?? 1}.X_HW_DMZ", new[]
        {
            ("dmzEnabled", "DMZEnable", "xsd:boolean"),
            ("dmzHost", "DMZHostAddress", "xsd:string"),
        }, "Seguridad aplicada y verificada", true, progress, cancellationToken);

    public async Task<JsonObject> SetAcsAsync(string serial, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var mapping = new (string Key, string Field, string Type)[]
        {
            ("enabled", "X_HW_EnableCWMP", "xsd:boolean"),
            ("acsUrl", "URL", "xsd:string"),
            ("username", "Username", "xsd:string"),
            ("password", "Password", "xsd:string"),
            ("connectionRequestUsername", "ConnectionRequestUsername", "xsd:string"),
            ("connectionRequestPassword", "ConnectionRequestPassword", "xsd:string"),
            ("informInterval", "PeriodicInformInterval", "xsd:unsignedInt"),
        };
        var extra = payload["informInterval"] is not null
            ? new[] { new ParameterValue($"{ManagementRoot}.PeriodicInformEnable", JsonValue.Create(true), "xsd:boolean") }
            : Array.Empty<ParameterValue>();
        return await ApplyMappingAsync(serial, payload, ManagementRoot, mapping, "ACS aplicado y verificado", true, progress, cancellationToken, extra).ConfigureAwait(false);
    }

    private async Task<JsonObject> RunDiagnosticAsync(string serial, string kind, JsonObject payload, Action<string, int>? progress, CancellationToken cancellationToken)
    {
        var definitions = new Dictionary<string, (string Root, (string Key, string Field, string Type)[] Mapping, string ResultKey)>
        {
            ["run_ping"] = ($"{Root}.IPPingDiagnostics", new[]
            {
                ("host", "Host", "xsd:string"), ("interface", "Interface", "xsd:string"),
                ("repetitions", "NumberOfRepetitions", "xsd:unsignedInt"), ("timeout", "Timeout", "xsd:unsignedInt"),
                ("blockSize", "DataBlockSize", "xsd:unsignedInt"),
            }, "ping"),
            ["run_traceroute"] = ($"{Root}.TraceRouteDiagnostics", new[]
            {
                ("host", "Host", "xsd:string"), ("interface", "Interface", "xsd:string"),
                ("maxHops", "MaxHopCount", "xsd:unsignedInt"), ("timeout", "Timeout", "xsd:unsignedInt"),
            }, "traceroute"),
            ["run_download_diagnostic"] = ($"{Root}.DownloadDiagnostics", new[]
            {
                ("url", "DownloadURL", "xsd:string"), ("interface", "Interface", "xsd:string"),
            }, "download"),
            ["run_upload_diagnostic"] = ($"{Root}.UploadDiagnostics", new[]
            {
                ("url", "UploadURL", "xsd:string"), ("interface", "Interface", "xsd:string"),
                ("testFileLength", "TestFileLength", "xsd:unsignedInt"),
            }, "upload"),
        };

        var (root, mapping, resultKey) = definitions[kind];
        var values = mapping
            .Where(item => payload[item.Key] is not null && payload[item.Key]!.ToString().Length > 0)
            .Select(item => new ParameterValue($"{root}.{item.Field}", payload[item.Key]!.DeepClone(), item.Type))
            .ToList();
        values.Add(new ParameterValue($"{root}.DiagnosticsState", JsonValue.Create("Requested"), "xsd:string"));

        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        AssertWritable(device, values);
        progress?.Invoke("diagnostic_requested", 35);

        var payloadValues = values.Select(value => new JsonArray(value.Path, value.Value?.DeepClone(), value.Type)).ToArray();
        await TaskAsync(device["_id"]!.ToString(), new { name = "setParameterValues", parameterValues = payloadValues }, cancellationToken).ConfigureAwait(false);

        var deadline = Stopwatch.StartNew();
        JsonNode? last = new JsonObject();
        while (deadline.Elapsed < TimeSpan.FromSeconds(90))
        {
            var current = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
            var state = LeafValue(current, $"{root}.DiagnosticsState")?.ToString() ?? string.Empty;
            last = DiagnosticSnapshot(current)[resultKey]?.DeepClone();

            if (state is not ("" or "None" or "Requested"))
            {
                if (state != "Complete" && !state.StartsWith("Completed", StringComparison.Ordinal))
                    throw new GenieAcsException($"El diagnostico termino con estado {state}", "DIAGNOSTIC_FAILED", verification: last);

                var snapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
                return new JsonObject
                {
                    ["message"] = "Diagnostico completado",
                    ["snapshot"] = snapshot,
                    ["diagnostic"] = last,
                    ["verification"] = new JsonObject { ["state"] = state, ["verified"] = true },
                    ["rollback"] = null,
                };
            }

            progress?.Invoke("diagnostic_running", 60);
            await Task.Delay(2000, cancellationToken).ConfigureAwait(false);
        }
        throw new GenieAcsException("La ONU no reporto el resultado del diagnostico", "DIAGNOSTIC_TIMEOUT", verification: last);
    }

    private async Task<JsonObject> TableActionAsync(string serial, string action, JsonObject payload, Action<string, int>? progress, CancellationToken cancellationToken)
    {
        var isDhcp = action.Contains("dhcp", StringComparison.Ordinal);
        var parent = isDhcp
            ? $"{DhcpRoot}.DHCPStaticAddress"
            : $"{WanRoot}.{payload["connection"] ?? 1}.PortMapping";

        var instance = payload["instance"]?.GetValue<int>();
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        string message;

        if (action.StartsWith("delete_", StringComparison.Ordinal))
        {
            if (instance is null) throw new GenieAcsException("Falta la instancia que se eliminara", "INSTANCE_REQUIRED");
            await TaskAsync(device["_id"]!.ToString(), new { name = "deleteObject", objectName = $"{parent}.{instance}" }, cancellationToken).ConfigureAwait(false);
            message = "Objeto eliminado";
        }
        else
        {
            if (instance is null)
            {
                var before = Rows(device, parent).Select(row => row.Index).ToHashSet();
                await TaskAsync(device["_id"]!.ToString(), new { name = "addObject", objectName = parent }, cancellationToken).ConfigureAwait(false);
                await Task.Delay(1000, cancellationToken).ConfigureAwait(false);

                var refreshed = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
                var created = Rows(refreshed, parent).Select(row => row.Index).Where(index => !before.Contains(index)).OrderBy(index => index).ToList();
                if (created.Count == 0) throw new GenieAcsException("La ONU no confirmo la nueva instancia", "ADD_OBJECT_FAILED");
                instance = created[^1];
            }

            var root = $"{parent}.{instance}";
            var mapping = isDhcp
                ? new (string Key, string Field, string Type)[]
                {
                    ("enabled", "Enable", "xsd:boolean"),
                    ("macAddress", "Chaddr", "xsd:string"),
                    ("ipAddress", "Yiaddr", "xsd:string"),
                }
                : new (string Key, string Field, string Type)[]
                {
                    ("enabled", "PortMappingEnabled", "xsd:boolean"),
                    ("protocol", "PortMappingProtocol", "xsd:string"),
                    ("externalPort", "ExternalPort", "xsd:unsignedInt"),
                    ("internalPort", "InternalPort", "xsd:unsignedInt"),
                    ("internalClient", "InternalClient", "xsd:string"),
                    ("description", "PortMappingDescription", "xsd:string"),
                };

            var values = mapping
                .Where(item => payload[item.Key] is not null)
                .Select(item => new ParameterValue($"{root}.{item.Field}", payload[item.Key]!.DeepClone(), item.Type))
                .ToList();
            await ApplyParametersAsync(serial, values, true, progress, cancellationToken).ConfigureAwait(false);
            message = "Objeto creado o actualizado";
        }

        var finalSnapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
        return new JsonObject
        {
            ["message"] = message,
            ["snapshot"] = finalSnapshot,
            ["verification"] = new JsonObject { ["verified"] = true, ["instance"] = instance },
            ["rollback"] = null,
        };
    }

    public async Task<JsonObject> RebootAsync(string serial, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
        var previousInform = device["_lastInform"]?.ToString();
        var previousUptime = LeafValue(device, $"{DeviceInfo}.UpTime")?.ToString();
        progress?.Invoke("rebooting", 50);

        var response = await TaskAsync(device["_id"]!.ToString(), new { name = "reboot" }, cancellationToken).ConfigureAwait(false);
        var deadline = Stopwatch.StartNew();

        while (deadline.Elapsed < TimeSpan.FromSeconds(180))
        {
            var current = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
            var currentInform = current["_lastInform"]?.ToString();
            var currentUptime = LeafValue(current, $"{DeviceInfo}.UpTime")?.ToString();

            var informChanged = !string.IsNullOrEmpty(currentInform) && currentInform != previousInform;
            var uptimeRestarted = previousUptime is null || currentUptime is null;
            if (long.TryParse(previousUptime, out var previousValue) && long.TryParse(currentUptime, out var currentValue))
                uptimeRestarted = currentValue < previousValue;

            if (informChanged && uptimeRestarted)
            {
                var snapshot = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
                return new JsonObject
                {
                    ["message"] = "ONU reiniciada y reconectada a GenieACS",
                    ["snapshot"] = snapshot,
                    ["verification"] = new JsonObject
                    {
                        ["verified"] = true, ["informChanged"] = true, ["uptimeRestarted"] = true,
                        ["previousUptime"] = previousUptime, ["currentUptime"] = currentUptime,
                        ["genieAcsHttpStatus"] = (response as JsonObject)?["_httpStatus"]?.DeepClone(),
                    },
                    ["rollback"] = null,
                };
            }

            progress?.Invoke("waiting_for_inform", 75);
            await Task.Delay(2000, cancellationToken).ConfigureAwait(false);
        }

        throw new GenieAcsException(
            "GenieACS acepto el reinicio, pero la ONU no confirmo su regreso", "REBOOT_NOT_CONFIRMED",
            verification: new JsonObject
            {
                ["verified"] = false, ["previousInform"] = previousInform, ["previousUptime"] = previousUptime,
            });
    }

    /// <summary>Punto de entrada que usan las tareas que llegan desde ISP Max.</summary>
    public async Task<JsonObject> ExecuteAsync(string serial, string action, JsonObject payload, Action<string, int>? progress = null, CancellationToken cancellationToken = default)
    {
        if (ActionStatus.GetValueOrDefault(action) == "blocked")
            throw new GenieAcsException("Operacion bloqueada hasta certificar este firmware", "ACTION_BLOCKED");

        switch (action)
        {
            case "refresh":
                var snapshot = await RefreshAsync(serial, progress, cancellationToken).ConfigureAwait(false);
                return Result("Inventario TR-069 actualizado", snapshot, new JsonObject { ["verified"] = true }, null);
            case "set_wifi": return await SetWifiAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_lan_port": return await SetLanPortAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_dhcp": return await SetDhcpAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_time": return await SetTimeAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_wan": return await SetWanAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_security": return await SetSecurityAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "set_acs": return await SetAcsAsync(serial, payload, progress, cancellationToken).ConfigureAwait(false);
            case "reboot": return await RebootAsync(serial, progress, cancellationToken).ConfigureAwait(false);
        }

        if (action.StartsWith("run_", StringComparison.Ordinal))
            return await RunDiagnosticAsync(serial, action, payload, progress, cancellationToken).ConfigureAwait(false);

        if (action is "upsert_dhcp_reservation" or "delete_dhcp_reservation" or "upsert_port_mapping" or "delete_port_mapping")
            return await TableActionAsync(serial, action, payload, progress, cancellationToken).ConfigureAwait(false);

        if (action == "factory_reset")
        {
            var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
            var response = await TaskAsync(device["_id"]!.ToString(), new { name = "factoryReset" }, cancellationToken).ConfigureAwait(false);
            return new JsonObject
            {
                ["message"] = "Restauracion de fabrica aceptada",
                ["snapshot"] = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false),
                ["verification"] = new JsonObject
                {
                    ["accepted"] = true,
                    ["genieAcsHttpStatus"] = (response as JsonObject)?["_httpStatus"]?.DeepClone(),
                },
                ["rollback"] = null,
            };
        }

        if (action == "firmware_download")
        {
            var device = await FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);
            var response = await TaskAsync(device["_id"]!.ToString(),
                new { name = "download", file = payload["fileName"]?.ToString() }, cancellationToken).ConfigureAwait(false);
            return new JsonObject
            {
                ["message"] = "Transferencia de firmware aceptada",
                ["snapshot"] = await SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false),
                ["verification"] = new JsonObject
                {
                    ["accepted"] = true,
                    ["sha256"] = payload["sha256"]?.DeepClone(),
                    ["genieAcsHttpStatus"] = (response as JsonObject)?["_httpStatus"]?.DeepClone(),
                },
                ["rollback"] = null,
            };
        }

        throw new GenieAcsException("Operacion TR-069 no permitida", "ACTION_NOT_ALLOWED");
    }
}
