using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Principal;

namespace OnuStudio.Core.Net;

public sealed class NetworkException : Exception
{
    public NetworkException(string message) : base(message) { }
}

public sealed class NetworkAdapter
{
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int Index { get; set; }
    public string Status { get; set; } = "Down";
    public string LinkSpeed { get; set; } = string.Empty;
    public string Mac { get; set; } = string.Empty;
    public List<string> Addresses { get; set; } = new();
    public List<string> Ipv6Addresses { get; set; } = new();
    /// <summary>true cuando es una tarjeta Ethernet fisica: las demas no se tocan.</summary>
    public bool Supported { get; set; }

    public bool IsUp => string.Equals(Status, "Up", StringComparison.OrdinalIgnoreCase);
    public string DisplayName => string.IsNullOrWhiteSpace(Description) || Description == Name
        ? Name
        : $"{Name} · {Description}";
}

public sealed record AdapterChange(bool Changed, NetworkAdapter Adapter, string Address, int PrefixLength);

public sealed record HttpProbe(bool Reachable, int? LatencyMs, int Port, string? Error);

/// <summary>Consulta y preparacion de la tarjeta de red local.</summary>
public static class NetworkTools
{
    private static readonly string[] BlockedTerms =
    {
        "wi-fi", "wifi", "wireless", "bluetooth", "vpn", "tunnel", "hyper-v", "vethernet", "tap-",
    };

    public static bool IsWiredAdapter(string name, string description)
    {
        var label = $"{name} {description}".ToLowerInvariant();
        return !BlockedTerms.Any(label.Contains);
    }

    public static bool IsWindowsAdmin()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch (Exception)
        {
            return false;
        }
    }

    public static List<NetworkAdapter> ListAdapters()
    {
        var adapters = new List<NetworkAdapter>();
        foreach (var candidate in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (candidate.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            if (candidate.OperationalStatus == OperationalStatus.Unknown) continue;

            int index;
            try
            {
                index = candidate.GetIPProperties().GetIPv4Properties()?.Index ?? 0;
            }
            catch (NetworkInformationException)
            {
                continue;
            }
            if (index <= 0) continue;

            var unicast = candidate.GetIPProperties().UnicastAddresses;
            var adapter = new NetworkAdapter
            {
                Name = candidate.Name,
                Description = candidate.Description,
                Index = index,
                Status = candidate.OperationalStatus == OperationalStatus.Up ? "Up" : candidate.OperationalStatus.ToString(),
                LinkSpeed = FormatSpeed(candidate.Speed),
                Mac = candidate.GetPhysicalAddress().ToString(),
                Addresses = unicast
                    .Where(item => item.Address.AddressFamily == AddressFamily.InterNetwork)
                    .Select(item => item.Address.ToString())
                    .Where(value => !value.StartsWith("169.254", StringComparison.Ordinal))
                    .ToList(),
                Ipv6Addresses = unicast
                    .Where(item => item.Address.AddressFamily == AddressFamily.InterNetworkV6 && item.Address.IsIPv6LinkLocal)
                    .Select(item => item.Address.ToString())
                    .ToList(),
            };
            adapter.Supported = IsWiredAdapter(adapter.Name, adapter.Description);
            adapters.Add(adapter);
        }

        return adapters
            .OrderBy(item => item.Supported ? 0 : 1)
            .ThenBy(item => item.IsUp ? 0 : 1)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static string FormatSpeed(long bitsPerSecond)
    {
        if (bitsPerSecond <= 0) return string.Empty;
        if (bitsPerSecond >= 1_000_000_000) return $"{bitsPerSecond / 1_000_000_000d:0.#} Gbps";
        if (bitsPerSecond >= 1_000_000) return $"{bitsPerSecond / 1_000_000d:0.#} Mbps";
        return $"{bitsPerSecond} bps";
    }

    /// <summary>
    /// Agrega la IP de administracion a la tarjeta Ethernet si falta. No toca WiFi ni
    /// adaptadores virtuales, y nunca quita direcciones existentes.
    /// </summary>
    public static AdapterChange EnsureIpv4Address(int adapterIndex, string address, int prefixLength)
    {
        if (!OperatingSystem.IsWindows())
            throw new NetworkException("La preparacion automatica de la tarjeta esta disponible en Windows");

        var adapters = ListAdapters();
        var adapter = adapters.FirstOrDefault(item => item.Index == adapterIndex)
            ?? throw new NetworkException("La tarjeta de red seleccionada ya no esta disponible");
        if (!adapter.Supported)
            throw new NetworkException("Selecciona una tarjeta Ethernet fisica; WiFi, VPN y adaptadores virtuales estan bloqueados");

        foreach (var item in adapters)
        {
            if (!item.Addresses.Contains(address)) continue;
            if (item.Index != adapterIndex)
                throw new NetworkException($"La IP {address} ya esta asignada a {item.Name}");
            return new AdapterChange(false, adapter, address, prefixLength);
        }

        if (!IsWindowsAdmin())
            throw new NetworkException("Ejecuta ONU Studio como administrador para agregar la IP local a Ethernet");

        RunPowerShell(
            $"New-NetIPAddress -InterfaceIndex {adapterIndex} -IPAddress '{address}' " +
            $"-PrefixLength {prefixLength} -AddressFamily IPv4 -Type Unicast " +
            "-SkipAsSource $true -ErrorAction Stop | Out-Null");
        return new AdapterChange(true, adapter, address, prefixLength);
    }

    public static string RunPowerShell(string script, int timeoutSeconds = 20)
    {
        var info = new ProcessStartInfo("powershell")
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script })
            info.ArgumentList.Add(argument);

        using var process = Process.Start(info) ?? throw new NetworkException("No se pudo ejecutar PowerShell");
        var output = process.StandardOutput.ReadToEnd();
        var error = process.StandardError.ReadToEnd();
        if (!process.WaitForExit(timeoutSeconds * 1000))
        {
            try { process.Kill(true); } catch (Exception) { /* ya termino */ }
            throw new NetworkException("PowerShell no respondio a tiempo");
        }
        if (process.ExitCode != 0)
            throw new NetworkException(string.IsNullOrWhiteSpace(error) ? output.Trim() : error.Trim());
        return output.Trim();
    }

    /// <summary>Abre un socket al puerto 80 de la ONU, con soporte de IPv6 link-local.</summary>
    public static Socket OpenHttpSocket(string host, double timeoutSeconds = 2.5, int? adapterIndex = null, string? sourceAddress = null)
    {
        var (address, scopeId) = ParseHost(host, adapterIndex);
        var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        try
        {
            if (address.AddressFamily == AddressFamily.InterNetworkV6)
            {
                address.ScopeId = scopeId;
                if (!string.IsNullOrWhiteSpace(sourceAddress) && IPAddress.TryParse(sourceAddress.Split('%')[0], out var source))
                {
                    source.ScopeId = scopeId;
                    socket.Bind(new IPEndPoint(source, 0));
                }
            }
            else if (!string.IsNullOrWhiteSpace(sourceAddress) && IPAddress.TryParse(sourceAddress, out var source4))
            {
                socket.Bind(new IPEndPoint(source4, 0));
            }

            var connect = socket.ConnectAsync(new IPEndPoint(address, 80));
            if (!connect.Wait(TimeSpan.FromSeconds(timeoutSeconds)))
                throw new SocketException((int)SocketError.TimedOut);
            socket.ReceiveTimeout = (int)(timeoutSeconds * 1000);
            socket.SendTimeout = (int)(timeoutSeconds * 1000);
            return socket;
        }
        catch (Exception)
        {
            socket.Dispose();
            throw;
        }
    }

    public static (IPAddress Address, long ScopeId) ParseHost(string host, int? adapterIndex)
    {
        var text = (host ?? string.Empty).Trim().Trim('[', ']');
        var parts = text.Split('%');
        if (!IPAddress.TryParse(parts[0], out var address))
            throw new NetworkException($"La direccion {host} no es valida");

        if (address.AddressFamily != AddressFamily.InterNetworkV6) return (address, 0);

        long scope = adapterIndex ?? 0;
        if (scope == 0 && parts.Length > 1 && long.TryParse(parts[1], out var parsed)) scope = parsed;
        if (scope == 0)
            throw new NetworkException("La direccion IPv6 local requiere el indice de la tarjeta Ethernet");
        return (address, scope);
    }

    /// <summary>URL utilizable por el navegador, con el scope IPv6 ya codificado.</summary>
    public static string HostForUrl(string host, int? adapterIndex = null)
    {
        var (address, scope) = ParseHost(host, adapterIndex);
        if (address.AddressFamily != AddressFamily.InterNetworkV6) return address.ToString();
        return $"[{address.ToString().Split('%')[0]}%25{scope}]";
    }

    public static HttpProbe ProbeHttp(string host, double timeoutSeconds = 2.5, int? adapterIndex = null, string? sourceAddress = null)
    {
        var started = Stopwatch.StartNew();
        try
        {
            using var socket = OpenHttpSocket(host, timeoutSeconds, adapterIndex, sourceAddress);
            return new HttpProbe(true, (int)Math.Round(started.Elapsed.TotalMilliseconds), 80, null);
        }
        catch (Exception exception)
        {
            return new HttpProbe(false, null, 80, exception.Message);
        }
    }
}
