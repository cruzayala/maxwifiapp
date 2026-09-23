using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using OnuStudio.Core.Onu;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Net;

public sealed class DiscoveredDevice
{
    public string Host { get; set; } = string.Empty;
    public bool Reachable { get; set; }
    public int? LatencyMs { get; set; }
    public int? AdapterIndex { get; set; }
    public string? AdapterName { get; set; }
    public string? Transport { get; set; }
    public int? HttpStatus { get; set; }
    public string Vendor { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Server { get; set; } = string.Empty;
    /// <summary>huawei-webui, zte-webui o http-management.</summary>
    public string Fingerprint { get; set; } = string.Empty;
    public string? IdentityError { get; set; }

    /// <summary>Modelo soportado que corresponde a la huella detectada, si lo hay.</summary>
    /// <remarks>
    /// Varios Huawei (por ejemplo la HS8545M5 de Powertech) no dicen el modelo antes de
    /// iniciar sesion; en ese caso se sugiere la EG8141A5 y la lectura del equipo corrige
    /// el modelo con el nombre real que muestra el panel.
    /// </remarks>
    public string? SuggestedModel => OnuModels.Canonical(Model) ?? Fingerprint switch
    {
        "huawei-webui" => "EG8141A5",
        "zte-webui" => "F670L",
        _ => Model.StartsWith("EG", StringComparison.OrdinalIgnoreCase) ? "EG8141A5"
            : Model.StartsWith("HS", StringComparison.OrdinalIgnoreCase) ? "HS8545M5"
            : Model.StartsWith("F6", StringComparison.OrdinalIgnoreCase) ? "F670L"
            : null,
    };
}

public sealed class DiscoveryState
{
    /// <summary>scanning, detected, not_detected, network_setup_required, cable_disconnected o error.</summary>
    public string Status { get; set; } = "scanning";
    public bool Detected { get; set; }
    public DiscoveredDevice? Device { get; set; }
    public List<DiscoveredDevice> Candidates { get; set; } = new();
    public List<NetworkAdapter> WiredAdapters { get; set; } = new();
    public string? LastScanAt { get; set; }
    public string NextAction { get; set; } = "Buscando una ONU conectada.";
    public string? Error { get; set; }
}

/// <summary>
/// Busca la ONU sola, sin que el tecnico tenga que escribir nada: prueba las IP de
/// fabrica y, cuando la ZTE trae una IPv4 en conflicto, la encuentra por IPv6 link-local.
/// </summary>
public sealed class DiscoveryService : IDisposable
{
    private static readonly string[] DefaultHosts = { "192.168.100.1", "192.168.1.1" };
    private const string LinkLocalHost = "fe80::1";

    private static readonly Regex[] ModelPatterns =
    {
        new("ProductName\\s*=\\s*['\"]([^'\"]+)", RegexOptions.IgnoreCase),
        new("\\b(EG\\d{4}[A-Z0-9-]*)\\b", RegexOptions.IgnoreCase),
        new("\\b(HG\\d{4}[A-Z0-9-]*)\\b", RegexOptions.IgnoreCase),
        new("\\b(HS\\d{4}[A-Z0-9-]*)\\b", RegexOptions.IgnoreCase),
        new("\\b(F6\\d{2}[A-Z0-9-]*)\\b", RegexOptions.IgnoreCase),
        new("\\b(AN\\d{3,5}[A-Z0-9-]*)\\b", RegexOptions.IgnoreCase),
    };

    private readonly object _lock = new();
    private readonly SemaphoreSlim _scanGate = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private readonly TimeSpan _interval;
    private DiscoveryState _state = new();
    private Task? _loop;

    public DiscoveryService(double intervalSeconds = 5.0) => _interval = TimeSpan.FromSeconds(intervalSeconds);

    public event Action<DiscoveryState>? Changed;

    public DiscoveryState Current
    {
        get { lock (_lock) return _state; }
    }

    public void Start()
    {
        if (_loop is { IsCompleted: false }) return;
        _loop = Task.Run(RunAsync);
    }

    public void Stop() => _stop.Cancel();

    public void Dispose()
    {
        Stop();
        _stop.Dispose();
        _scanGate.Dispose();
    }

    private async Task RunAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            Scan();
            try
            {
                await Task.Delay(_interval, _stop.Token).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                return;
            }
        }
    }

    /// <summary>Una pasada de busqueda. Si ya hay una en curso, devuelve el ultimo resultado.</summary>
    public DiscoveryState Scan()
    {
        if (!_scanGate.Wait(0)) return Current;
        DiscoveryState state;
        try
        {
            state = ScanOnce();
        }
        catch (Exception exception)
        {
            state = Current;
            state.Status = "error";
            state.LastScanAt = Clock.UtcNow();
            state.Error = exception.Message;
            state.NextAction = "No se pudo consultar la red local. Revisa los permisos del agente.";
        }
        finally
        {
            _scanGate.Release();
        }

        lock (_lock) _state = state;
        Changed?.Invoke(state);
        return state;
    }

    private static DiscoveryState ScanOnce()
    {
        if (AgentRuntime.IsDemo) return Demo.DemoData.Discovery();

        var adapters = NetworkTools.ListAdapters();
        var wiredUp = adapters.Where(item => item.Supported && item.IsUp).ToList();
        var candidates = new List<DiscoveredDevice>();

        foreach (var host in DefaultHosts)
        {
            var address = IPAddress.Parse(host);
            var adapter = AdapterForHost(adapters, address);
            if (adapter is null) continue;

            var source = adapter.Addresses.FirstOrDefault(value =>
                Ipv4.TryParse(value, out var parsed) && Ipv4.SameNetwork(parsed, address, 24));
            candidates.Add(Probe(host, adapter, source, null));
        }

        foreach (var adapter in wiredUp)
        {
            var source = adapter.Ipv6Addresses.FirstOrDefault();
            if (source is null) continue;
            candidates.Add(Probe($"{LinkLocalHost}%{adapter.Index}", adapter, source, "ipv6_link_local"));
        }

        var detected = candidates.FirstOrDefault(item => item.Reachable && item.Fingerprint is "huawei-webui" or "zte-webui")
            ?? candidates.FirstOrDefault(item => item.Reachable);

        var (status, nextAction) = detected is not null
            ? ("detected", "La ONU esta lista para comprobar credenciales o aprovisionar.")
            : candidates.Count > 0
                ? ("not_detected", "Verifica el cable, la alimentacion y que la ONU use una IP de gestion compatible.")
                : wiredUp.Count > 0
                    ? ("network_setup_required", "Selecciona la tarjeta Ethernet y usa Preparar red y comprobar.")
                    : ("cable_disconnected", "Conecta la ONU por Ethernet y espera la deteccion automatica.");

        return new DiscoveryState
        {
            Status = status,
            Detected = detected is not null,
            Device = detected,
            Candidates = candidates,
            WiredAdapters = wiredUp,
            LastScanAt = Clock.UtcNow(),
            NextAction = nextAction,
        };
    }

    private static DiscoveredDevice Probe(string host, NetworkAdapter adapter, string? source, string? transport)
    {
        var probe = NetworkTools.ProbeHttp(host, 0.8, adapter.Index, source);
        var candidate = new DiscoveredDevice
        {
            Host = host,
            Reachable = probe.Reachable,
            LatencyMs = probe.LatencyMs,
            AdapterIndex = adapter.Index,
            AdapterName = adapter.Name,
            Transport = transport,
        };
        if (!probe.Reachable) return candidate;

        try
        {
            FetchIdentity(candidate, host, adapter.Index, source);
        }
        catch (Exception exception)
        {
            candidate.Vendor = "ONU compatible";
            candidate.Model = "Panel HTTP detectado";
            candidate.Fingerprint = "http-management";
            candidate.IdentityError = exception.Message;
        }
        return candidate;
    }

    private static NetworkAdapter? AdapterForHost(IReadOnlyList<NetworkAdapter> adapters, IPAddress host)
    {
        foreach (var adapter in adapters)
        {
            if (!adapter.Supported || !adapter.IsUp) continue;
            foreach (var value in adapter.Addresses)
                if (Ipv4.TryParse(value, out var address) && Ipv4.SameNetwork(address, host, 24))
                    return adapter;
        }
        return null;
    }

    /// <summary>Pide la portada del panel con una peticion HTTP minima y deduce el modelo.</summary>
    private static void FetchIdentity(DiscoveredDevice candidate, string host, int adapterIndex, string? source)
    {
        using var socket = NetworkTools.OpenHttpSocket(host, 2.5, adapterIndex, source);
        var hostHeader = host.Split('%')[0];
        var request =
            $"GET / HTTP/1.1\r\nHost: {hostHeader}\r\n" +
            "User-Agent: ISP-Max-ONU-Discovery/2.0\r\n" +
            "Accept: text/html,*/*;q=0.8\r\nConnection: close\r\n\r\n";
        socket.Send(Encoding.ASCII.GetBytes(request));

        var buffer = new byte[65_536];
        using var raw = new MemoryStream();
        while (raw.Length < 524_288)
        {
            int read;
            try
            {
                read = socket.Receive(buffer);
            }
            catch (Exception)
            {
                break;
            }
            if (read <= 0) break;
            raw.Write(buffer, 0, read);
        }

        var text = Encoding.Latin1.GetString(raw.ToArray());
        var separator = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
        var headerText = separator >= 0 ? text[..separator] : text;
        var body = separator >= 0 ? text[(separator + 4)..] : string.Empty;

        var statusMatch = Regex.Match(headerText, @"^HTTP/\d(?:\.\d)?\s+(\d+)");
        candidate.HttpStatus = statusMatch.Success ? int.Parse(statusMatch.Groups[1].Value) : null;

        var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in headerText.Split("\r\n").Skip(1))
        {
            var colon = line.IndexOf(':');
            if (colon > 0) headers[line[..colon].Trim()] = line[(colon + 1)..].Trim();
        }

        InferDevice(candidate, body, headers);
    }

    internal static void InferDevice(DiscoveredDevice candidate, string html, IDictionary<string, string> headers)
    {
        var compact = html.Length > 262_144 ? html[..262_144] : html;

        string? model = null;
        foreach (var pattern in ModelPatterns)
        {
            var match = pattern.Match(compact);
            if (!match.Success) continue;
            model = match.Groups[1].Value.Trim().ToUpperInvariant();
            break;
        }

        var lowered = compact.ToLowerInvariant();
        headers.TryGetValue("server", out var server);
        server ??= string.Empty;
        var vendorText = $"{lowered} {server.ToLowerInvariant()}";

        var vendor = vendorText.Contains("huawei") || (model?.StartsWith("EG") ?? false) || (model?.StartsWith("HG") ?? false) || (model?.StartsWith("HS") ?? false)
            ? "Huawei / Novatech"
            : vendorText.Contains("zte") || (model?.StartsWith("F6") ?? false)
                ? "ZTE"
                : lowered.Contains("fiberhome") || (model?.StartsWith("AN") ?? false)
                    ? "FiberHome"
                    : "ONU compatible";

        var titleMatch = Regex.Match(compact, "<title[^>]*>(.*?)</title>", RegexOptions.IgnoreCase | RegexOptions.Singleline);
        var title = titleMatch.Success ? Regex.Replace(titleMatch.Groups[1].Value, @"\s+", " ").Trim() : string.Empty;

        var isHuawei = compact.Contains("txt_Username") && compact.Contains("loginbutton");
        var isZte = compact.Contains("Frm_Username") && compact.Contains("Frm_Password");

        candidate.Vendor = vendor;
        candidate.Model = model ?? (string.IsNullOrWhiteSpace(title) ? "Modelo no identificado" : title);
        candidate.Title = title;
        candidate.Server = server;
        candidate.Fingerprint = isHuawei ? "huawei-webui" : isZte ? "zte-webui" : "http-management";
    }
}
