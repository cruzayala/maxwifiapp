using Microsoft.Playwright;

namespace OnuStudio.Core.Onu;

/// <summary>
/// Motor de automatizacion. ONU Studio maneja los paneles de la ONU con un navegador
/// sin ventana. Usa el Microsoft Edge que ya trae Windows, y solo si no hubiera
/// ninguno descarga su propio Chromium (una sola vez).
/// </summary>
public static class BrowserLauncher
{
    private static readonly SemaphoreSlim InstallGate = new(1, 1);
    private static string? _resolvedChannel;
    private static bool _ownBrowserReady;

    public static bool Headless { get; set; } =
        (Environment.GetEnvironmentVariable("ONU_HEADLESS") ?? "true").ToLowerInvariant() is not ("0" or "false" or "no");

    /// <summary>Carpeta propia para no depender de instalaciones de otros programas.</summary>
    public static void ConfigureEnvironment()
    {
        AppPaths.EnsureRuntimeDirectories();
        Environment.SetEnvironmentVariable("PLAYWRIGHT_BROWSERS_PATH", AppPaths.BrowserDir);
    }

    /// <summary>true cuando ya hay un Chromium propio descargado en esta PC.</summary>
    public static bool HasOwnBrowser()
    {
        ConfigureEnvironment();
        if (!Directory.Exists(AppPaths.BrowserDir)) return false;
        return Directory.EnumerateDirectories(AppPaths.BrowserDir, "chromium*", SearchOption.TopDirectoryOnly).Any();
    }

    /// <summary>Rutas habituales de Edge y Chrome en Windows.</summary>
    private static string? FindInstalledBrowser()
    {
        var programFiles = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        };
        var candidates = new[]
        {
            @"Microsoft\Edge\Application\msedge.exe",
            @"Google\Chrome\Application\chrome.exe",
        };

        foreach (var root in programFiles)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            foreach (var candidate in candidates)
            {
                var path = Path.Combine(root, candidate);
                if (File.Exists(path)) return path;
            }
        }
        return null;
    }

    /// <summary>
    /// Deja listo el motor antes de tocar la ONU. Si Windows ya trae Edge, no
    /// descarga nada; si no, baja el navegador interno una sola vez.
    /// </summary>
    public static async Task EnsureInstalledAsync(Action<string>? report = null, CancellationToken cancellationToken = default)
    {
        ConfigureEnvironment();

        var configured = Environment.GetEnvironmentVariable("ONU_BROWSER_EXECUTABLE");
        if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return;
        if (_ownBrowserReady || HasOwnBrowser()) return;
        if (FindInstalledBrowser() is not null) return;

        await InstallGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            if (_ownBrowserReady || HasOwnBrowser()) return;

            report?.Invoke("Preparando el motor de automatizacion (solo la primera vez)…");
            var exitCode = await Task.Run(() => Microsoft.Playwright.Program.Main(new[] { "install", "chromium" }), cancellationToken)
                .ConfigureAwait(false);
            if (exitCode != 0 && !HasOwnBrowser())
                throw new OnuProvisioningException(
                    "Esta PC no tiene Microsoft Edge ni Google Chrome, y no se pudo descargar el navegador interno. " +
                    "Instala Edge o revisa la conexion a internet.",
                    "ONU_BROWSER_INSTALL_FAILED");

            _ownBrowserReady = true;
            report?.Invoke("Motor de automatizacion listo.");
        }
        finally
        {
            InstallGate.Release();
        }
    }

    public static async Task<IBrowser> LaunchAsync(IPlaywright playwright)
    {
        ConfigureEnvironment();
        var options = new BrowserTypeLaunchOptions
        {
            Headless = Headless,
            Args = new[] { "--no-first-run", "--disable-default-apps", "--disable-gpu" },
        };

        var configured = Environment.GetEnvironmentVariable("ONU_BROWSER_EXECUTABLE");
        if (!string.IsNullOrWhiteSpace(configured))
        {
            options.ExecutablePath = configured;
            return await playwright.Chromium.LaunchAsync(options).ConfigureAwait(false);
        }

        // Primero el navegador que ya esta en la PC: arranca al instante y no ocupa disco extra.
        foreach (var channel in ChannelOrder())
        {
            try
            {
                options.Channel = channel;
                options.ExecutablePath = null;
                var browser = await playwright.Chromium.LaunchAsync(options).ConfigureAwait(false);
                _resolvedChannel = channel;
                return browser;
            }
            catch (Exception)
            {
                options.Channel = null;
            }
        }

        try
        {
            options.Channel = null;
            return await playwright.Chromium.LaunchAsync(options).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            throw new OnuProvisioningException(
                "No se pudo iniciar el navegador que usa ONU Studio para configurar la ONU. " +
                "Instala Microsoft Edge o vuelve a abrir el programa con internet disponible.",
                "ONU_BROWSER_UNAVAILABLE", retryable: true, exception);
        }
    }

    /// <summary>Se recuerda el navegador que funciono para no reintentar en vano.</summary>
    private static IEnumerable<string> ChannelOrder()
    {
        if (_resolvedChannel is not null)
        {
            yield return _resolvedChannel;
            yield break;
        }
        yield return "msedge";
        yield return "chrome";
    }
}
