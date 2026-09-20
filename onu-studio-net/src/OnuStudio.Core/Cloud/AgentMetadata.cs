using OnuStudio.Core.Net;

namespace OnuStudio.Core.Cloud;

/// <summary>Datos de esta PC que ISP Max muestra en su lista de agentes.</summary>
public static class AgentMetadata
{
    public static string DisplayName()
    {
        var configured = Environment.GetEnvironmentVariable("ONU_AGENT_DISPLAY_NAME");
        return string.IsNullOrWhiteSpace(configured) ? Environment.MachineName : configured.Trim();
    }

    public static object Build() => new
    {
        displayName = DisplayName(),
        hostname = Environment.MachineName,
        windowsUser = Environment.UserName,
        osName = $"Windows {Environment.OSVersion.Version}",
        architecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
        isAdmin = NetworkTools.IsWindowsAdmin(),
    };
}
