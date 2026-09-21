using OnuStudio.Core.Acs;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Jobs;
using OnuStudio.Core.Net;
using OnuStudio.Core.Onu;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core;

/// <summary>
/// Arranca y mantiene todo el agente: base local, sesion con ISP Max, deteccion
/// de ONU y los dos trabajadores que lo mantienen disponible desde la nube.
/// </summary>
public sealed class AgentHost : IAsyncDisposable
{
    private readonly AgentSettingsStore _settingsStore;
    private AgentSettings _settings;

    public AgentHost()
    {
        AppPaths.EnsureRuntimeDirectories();
        BrowserLauncher.ConfigureEnvironment();

        _settingsStore = new AgentSettingsStore();
        _settings = _settingsStore.Load();
        BrowserLauncher.Headless = _settings.Headless;

        Store = new JobStore(AppPaths.DatabasePath);
        InterruptedJobs = Store.InterruptIncomplete();
        if (AgentRuntime.IsDemo && Store.NetworkRanges().Count == 0)
            Store.ReplaceNetworkRanges(new[] { Demo.DemoData.Range() });

        Jobs = new JobManager(Store);
        Session = new CloudSessionManager(new SecureJsonStore(AppPaths.CloudSessionPath));
        Catalog = new CloudCatalog(Session, Store);
        Discovery = new DiscoveryService();
        Provisioning = new ProvisioningService(Jobs, Session, () => _settings);

        Acs = new GenieAcsClient(_settings.GenieAcsUrl);
        Tr069 = new Tr069Worker(Session, Acs);
        CloudWorker = new OnuCloudWorker(Session, Provisioning, Jobs, Store, Discovery, () => Tr069.Status);
    }

    public JobStore Store { get; }
    public JobManager Jobs { get; }
    public CloudSessionManager Session { get; }
    public CloudCatalog Catalog { get; }
    public DiscoveryService Discovery { get; }
    public ProvisioningService Provisioning { get; }
    public GenieAcsClient Acs { get; }
    public Tr069Worker Tr069 { get; }
    public OnuCloudWorker CloudWorker { get; }

    /// <summary>Trabajos que quedaron a medias en un cierre anterior y se marcaron para reanudar.</summary>
    public int InterruptedJobs { get; }

    public AgentSettings Settings => _settings;

    public event Action<AgentSettings>? SettingsChanged;

    public void SaveSettings(AgentSettings settings)
    {
        settings.Validate().ThrowIfInvalid();
        _settings = settings;
        _settingsStore.Save(settings);
        BrowserLauncher.Headless = settings.Headless;
        SettingsChanged?.Invoke(settings);
    }

    /// <summary>Arranca la deteccion y la conexion permanente con ISP Max.</summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        Discovery.Start();
        await Session.RestoreAsync(cancellationToken).ConfigureAwait(false);
        // En modo de prueba no se atienden tareas reales de la nube.
        if (AgentRuntime.IsDemo) return;
        Tr069.Start();
        CloudWorker.Start();
    }

    public async ValueTask DisposeAsync()
    {
        Discovery.Dispose();
        await CloudWorker.DisposeAsync().ConfigureAwait(false);
        await Tr069.DisposeAsync().ConfigureAwait(false);
    }
}
