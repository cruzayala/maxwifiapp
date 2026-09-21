using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;
using OnuStudio.Core;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using OnuStudio.Core.Onu;

namespace OnuStudio.App.ViewModels;

/// <summary>
/// Asistente de cinco pasos. Guarda el mismo orden de seguridad del agente anterior:
/// primero se reserva la IP y se prepara el cliente en la nube, y la ONU solo se
/// toca al confirmar el ultimo paso.
/// </summary>
public sealed partial class WizardViewModel : ObservableObject
{
    private readonly AgentHost _host;
    private readonly Action<string, string> _toast;
    private readonly Dispatcher _dispatcher;
    private readonly DispatcherTimer _searchTimer;

    private int _step = 1;
    private string _busyMessage = string.Empty;
    private JsonObject? _inventory;
    private string? _cloudJobId;
    private string _activeJobId = string.Empty;

    public WizardViewModel(AgentHost host, Action<string, string> toast)
    {
        _host = host;
        _toast = toast;
        _dispatcher = Application.Current?.Dispatcher ?? Dispatcher.CurrentDispatcher;

        Wan = new WanSettings();
        Wifi = new WifiSettings { Ssid = string.Empty, Password = string.Empty };
        RemoteAccess = new RemoteAccessSettings { Source = host.Settings.DefaultRemoteSource };
        Tr069Enabled = host.Settings.Tr069Enabled;

        _searchTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(450) };
        _searchTimer.Tick += async (_, _) =>
        {
            _searchTimer.Stop();
            await SearchClientsAsync().ConfigureAwait(true);
        };

        host.Discovery.Changed += state => OnUi(() => ApplyDiscovery(state));
        host.Jobs.JobChanged += job => OnUi(() => ApplyJob(job));
        host.Session.Changed += _ => OnUi(() => Notify(nameof(CloudConnected), nameof(CloudSummary)));

        Steps = new ObservableCollection<StepChip>
        {
            new(1, "1 · Conectar"),
            new(2, "2 · Cliente"),
            new(3, "3 · Internet"),
            new(4, "4 · WiFi"),
            new(5, "5 · Revisar"),
        };
        UpdateStepChips();

        RefreshAdapters();
        ApplyDiscovery(host.Discovery.Current);

        CheckCommand = new AsyncCommand(RunCheckAsync, () => CanCheck);
        // La busqueda toca la red: va fuera del hilo de la ventana para no congelarla.
        ScanCommand = new AsyncCommand(() => Task.Run(() => _host.Discovery.Scan()));
        LoginCommand = new AsyncCommand(LoginAsync);
        LogoutCommand = new AsyncCommand(() => _host.Session.LogoutAsync());
        LoadCatalogCommand = new AsyncCommand(LoadCatalogsAsync);
        SelectClientCommand = new RelayCommand(parameter =>
        {
            if (parameter is CloudClientSummary client) SelectClient(client);
        });
        ReserveCommand = new AsyncCommand(ReserveAndOpenJobAsync, () => CanReserve);
        PickIpCommand = new RelayCommand(parameter =>
        {
            if (parameter is CloudIpRow row) SelectedIp = row;
        });
        GenerateWifiCommand = new RelayCommand(GenerateWifi);
        NextCommand = new RelayCommand(GoNext, () => CanGoNext);
        BackCommand = new RelayCommand(GoBack, () => Step > 1 && !IsBusy);
        ProvisionCommand = new AsyncCommand(RunProvisionAsync, () => CanProvision);
        RestartCommand = new RelayCommand(ResetForNextClient);
        RefreshIpsCommand = new AsyncCommand(LoadIpCatalogAsync);
    }

    // ─────────────────────────── Comandos ───────────────────────────

    public AsyncCommand CheckCommand { get; }
    public AsyncCommand ScanCommand { get; }
    public AsyncCommand LoginCommand { get; }
    public AsyncCommand LogoutCommand { get; }
    public AsyncCommand LoadCatalogCommand { get; }
    public RelayCommand SelectClientCommand { get; }
    public AsyncCommand ReserveCommand { get; }
    public RelayCommand PickIpCommand { get; }
    public RelayCommand GenerateWifiCommand { get; }
    public RelayCommand NextCommand { get; }
    public RelayCommand BackCommand { get; }
    public AsyncCommand ProvisionCommand { get; }
    public RelayCommand RestartCommand { get; }
    public AsyncCommand RefreshIpsCommand { get; }

    // ─────────────────────────── Paso actual ───────────────────────────

    public int Step
    {
        get => _step;
        private set
        {
            if (!SetProperty(ref _step, value)) return;
            UpdateStepChips();
            Notify(nameof(IsStep1), nameof(IsStep2), nameof(IsStep3), nameof(IsStep4), nameof(IsStep5),
                nameof(StepTitle), nameof(StepHint), nameof(NextLabel), nameof(CanGoNext), nameof(CanProvision));
            NextCommand.RaiseCanExecuteChanged();
            BackCommand.RaiseCanExecuteChanged();
            ProvisionCommand.RaiseCanExecuteChanged();
        }
    }

    public ObservableCollection<StepChip> Steps { get; }

    private void UpdateStepChips()
    {
        foreach (var chip in Steps)
            chip.Tone = chip.Number < Step ? "ok" : chip.Number == Step ? "info" : "muted";
    }

    public bool IsStep1 => Step == 1;
    public bool IsStep2 => Step == 2;
    public bool IsStep3 => Step == 3;
    public bool IsStep4 => Step == 4;
    public bool IsStep5 => Step == 5;

    public string StepTitle => Step switch
    {
        1 => "1. Conecta la ONU",
        2 => "2. Cliente e IP",
        3 => "3. Internet",
        4 => "4. Red WiFi",
        _ => "5. Revisar y aplicar",
    };

    public string StepHint => Step switch
    {
        1 => "Conecta el cable Ethernet a la ONU. La busco sola y leo su informacion.",
        2 => "Elige el cliente y la IP que va a usar. Se reserva en ISP Max antes de tocar la ONU.",
        3 => "Asi quedara la conexion a internet. Ya viene con los datos de la reserva.",
        4 => "Nombre y clave del WiFi del cliente. Puedes cambiar lo que propongo.",
        _ => "Revisa el resumen. Nada se cambia en la ONU hasta que pulses Aprovisionar.",
    };

    public string NextLabel => Step switch
    {
        1 => "Continuar con el cliente",
        2 => "Continuar con internet",
        3 => "Continuar con el WiFi",
        4 => "Revisar antes de aplicar",
        _ => "Aprovisionar",
    };

    private void GoNext()
    {
        if (!CanGoNext) return;
        if (Step == 4)
        {
            BuildReview();
            // La revision arranca limpia: el avance de la lectura del paso 1 no es el de la configuracion.
            if (!Finished)
            {
                Timeline.Clear();
                Progress = 0;
                ProgressLabel = "Listo para comenzar";
            }
        }
        Step = Math.Min(5, Step + 1);

        // Al llegar al paso del cliente se traen zonas, planes e IP libres si la
        // sesion ya venia guardada de la vez anterior.
        if (Step == 2 && CloudConnected && Zones.Count == 0) _ = LoadCatalogsAsync();
    }

    private void GoBack() => Step = Math.Max(1, Step - 1);

    public bool CanGoNext => Step switch
    {
        1 => DeviceReady && !IsBusy,
        2 => !string.IsNullOrWhiteSpace(_cloudJobId) && !IsBusy,
        3 => ValidateInternet().IsValid && !IsBusy,
        4 => Wifi.Validate().IsValid && !IsBusy,
        _ => false,
    };

    // ─────────────────────────── Estado compartido ───────────────────────────

    private bool _isBusy;
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (!SetProperty(ref _isBusy, value)) return;
            Notify(nameof(CanCheck), nameof(CanReserve), nameof(CanGoNext), nameof(CanProvision));
            CheckCommand.RaiseCanExecuteChanged();
            ReserveCommand.RaiseCanExecuteChanged();
            NextCommand.RaiseCanExecuteChanged();
            BackCommand.RaiseCanExecuteChanged();
            ProvisionCommand.RaiseCanExecuteChanged();
        }
    }

    public string BusyMessage
    {
        get => _busyMessage;
        private set => SetProperty(ref _busyMessage, value);
    }

    private void OnUi(Action action)
    {
        if (_dispatcher.CheckAccess()) action();
        else _dispatcher.BeginInvoke(action);
    }
}
