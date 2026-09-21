namespace OnuStudio.Core;

/// <summary>Datos de identidad del agente, compartidos por la nube y la interfaz.</summary>
public static class AppInfo
{
    public const string Version = "2.1.0";
    public const string ProductName = "ONU Studio | ISP Max";
    public const string ShortName = "ONU Studio";

    /// <summary>Identificador estable de esta PC, igual que el del agente anterior.</summary>
    public static string DeviceId { get; } = ResolveDeviceId();

    private static string ResolveDeviceId()
    {
        var configured = Environment.GetEnvironmentVariable("ONU_AGENT_ID");
        if (!string.IsNullOrWhiteSpace(configured)) return configured.Trim()[..Math.Min(100, configured.Trim().Length)];

        // Igual que uuid.getnode() en Python: la MAC de la primera tarjeta fisica.
        var mac = System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces()
            .Where(n => n.NetworkInterfaceType != System.Net.NetworkInformation.NetworkInterfaceType.Loopback)
            .Select(n => n.GetPhysicalAddress().ToString())
            .FirstOrDefault(value => !string.IsNullOrWhiteSpace(value) && value != "000000000000");
        var suffix = (mac ?? Environment.MachineName).ToLowerInvariant().Replace(":", "").Replace("-", "");
        return $"onu-studio-{suffix}";
    }
}
