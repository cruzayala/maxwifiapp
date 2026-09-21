namespace OnuStudio.Core;

/// <summary>
/// Carpetas de trabajo. Se conservan las mismas rutas del agente anterior para que
/// el historial, los respaldos y la sesion guardada sigan sirviendo tras actualizar.
/// </summary>
public static class AppPaths
{
    public static string DataDir { get; } = ResolveDataDir();
    public static string BackupDir { get; } = Path.Combine(DataDir, "backups");
    public static string LogDir { get; } = Path.Combine(DataDir, "logs");
    public static string DatabasePath { get; } = Path.Combine(DataDir, "provisioner.db");
    public static string CloudSessionPath { get; } = Path.Combine(DataDir, "cloud-session.dat");
    public static string EnvPath { get; } = Path.Combine(DataDir, ".env");
    public static string BrowserDir { get; } = Path.Combine(DataDir, "browsers");

    private static string ResolveDataDir()
    {
        var configured = Environment.GetEnvironmentVariable("ONU_DATA_DIR");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            var custom = Path.GetFullPath(configured.Trim());
            return AgentRuntime.IsDemo ? Path.Combine(custom, "Modo de prueba") : custom;
        }
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var root = Path.Combine(localAppData, "ISP Max", "ONU Studio");
        // El modo de prueba guarda aparte para no mezclarse con el historial real.
        return AgentRuntime.IsDemo ? Path.Combine(root, "Modo de prueba") : root;
    }

    public static void EnsureRuntimeDirectories()
    {
        foreach (var directory in new[] { DataDir, BackupDir, LogDir, BrowserDir })
            Directory.CreateDirectory(directory);
    }
}
