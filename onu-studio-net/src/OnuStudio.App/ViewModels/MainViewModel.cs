using System.Windows;
using System.Windows.Threading;
using OnuStudio.Core;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Net;

namespace OnuStudio.App.ViewModels;

public enum AppPage
{
    Wizard,
    Device,
    History,
    Settings,
}

/// <summary>Estado general de la ventana: navegacion, conexion y avisos.</summary>
public sealed class MainViewModel : ObservableObject
{
    private readonly Dispatcher _dispatcher;
    private AppPage _page = AppPage.Wizard;
    private string _toast = string.Empty;
    private string _toastTone = "info";
    private DispatcherTimer? _toastTimer;

    public MainViewModel(AgentHost host)
    {
        Host = host;
        _dispatcher = Application.Current?.Dispatcher ?? Dispatcher.CurrentDispatcher;

        Wizard = new WizardViewModel(host, ShowToast);
        Device = new DeviceViewModel(host, Wizard);
        History = new HistoryViewModel(host);
        Settings = new SettingsViewModel(host, ShowToast);

        host.Session.Changed += _ => OnUi(NotifyConnection);
        host.CloudWorker.StatusChanged += _ => OnUi(NotifyConnection);
        host.Tr069.StatusChanged += _ => OnUi(NotifyConnection);
        host.Discovery.Changed += _ => OnUi(NotifyConnection);

        History.RetryRequested += jobId =>
        {
            if (Wizard.LoadRetryTemplate(jobId)) Page = AppPage.Wizard;
            else ShowToast("Ese trabajo ya no tiene datos para retomar.", "warn");
        };

        // Permite abrir el programa directamente en una pantalla; util para soporte.
        var startPage = Environment.GetEnvironmentVariable("ONU_START_PAGE");
        if (!string.IsNullOrWhiteSpace(startPage) && Enum.TryParse<AppPage>(startPage, true, out var initial))
            Page = initial;

        GoToCommand = new RelayCommand(parameter =>
        {
            if (parameter is AppPage target) Page = target;
            else if (parameter is string name && Enum.TryParse<AppPage>(name, out var parsed)) Page = parsed;
        });
    }

    public AgentHost Host { get; }
    public WizardViewModel Wizard { get; }
    public DeviceViewModel Device { get; }
    public HistoryViewModel History { get; }
    public SettingsViewModel Settings { get; }

    public RelayCommand GoToCommand { get; }

    public AppPage Page
    {
        get => _page;
        set
        {
            if (!SetProperty(ref _page, value)) return;
            Notify(nameof(IsWizard), nameof(IsDevice), nameof(IsHistory), nameof(IsSettings), nameof(PageTitle), nameof(PageSubtitle));
            if (value == AppPage.History) History.Refresh();
            if (value == AppPage.Settings) Settings.Reload();
        }
    }

    public bool IsWizard => Page == AppPage.Wizard;
    public bool IsDevice => Page == AppPage.Device;
    public bool IsHistory => Page == AppPage.History;
    public bool IsSettings => Page == AppPage.Settings;

    public string PageTitle => Page switch
    {
        AppPage.Device => "Equipo del cliente",
        AppPage.History => "Historial de trabajos",
        AppPage.Settings => "Ajustes del agente",
        _ => "Configurar una ONU",
    };

    public string PageSubtitle => Page switch
    {
        AppPage.Device => "Todo lo que la ONU reporta ahora mismo.",
        AppPage.History => "Lo que se configuro desde esta computadora.",
        AppPage.Settings => "Credenciales tecnicas, rangos de IP y conexion con ISP Max.",
        _ => "Cinco pasos: detectar, cliente, internet, WiFi y revisar.",
    };

    // ─────────────────────────── Estado de conexion ───────────────────────────

    public string CloudState => Host.Session.Current.SessionState switch
    {
        "connected" => "Conectado a ISP Max",
        "connecting" => "Conectando con ISP Max…",
        "offline" => "Sin internet hacia ISP Max",
        "revoked" => "Acceso revocado",
        _ => "Sin conectar",
    };

    public string CloudTone => Host.Session.Current.SessionState switch
    {
        "connected" => "ok",
        "connecting" => "info",
        "revoked" => "error",
        "offline" => "warn",
        _ => "muted",
    };

    public string CloudUser => Host.Session.Current.User?.Username ?? "Sin sesion";

    public string AgentState
    {
        get
        {
            var worker = Host.CloudWorker.Status;
            if (!Host.Session.Current.AgentPaired) return "Agente sin emparejar";
            if (worker.CurrentTaskId is not null) return "Ejecutando una tarea de ISP Max";
            return worker.Running ? "Disponible para ISP Max" : "Agente detenido";
        }
    }

    public string DeviceState
    {
        get
        {
            var discovery = Host.Discovery.Current;
            if (discovery.Detected && discovery.Device is not null)
                return $"{discovery.Device.Vendor} · {discovery.Device.Host}";
            return discovery.Status switch
            {
                "cable_disconnected" => "Conecta la ONU por Ethernet",
                "network_setup_required" => "Falta preparar la tarjeta de red",
                "scanning" => "Buscando una ONU…",
                _ => "Sin ONU detectada",
            };
        }
    }

    public string DeviceTone => Host.Discovery.Current.Detected ? "ok" : "muted";

    public bool IsAdministrator => NetworkTools.IsWindowsAdmin();

    public string AdminState => IsAdministrator
        ? "Permisos de administrador activos"
        : "Sin permisos de administrador";

    private void NotifyConnection() => Notify(
        nameof(CloudState), nameof(CloudTone), nameof(CloudUser), nameof(AgentState),
        nameof(DeviceState), nameof(DeviceTone));

    // ─────────────────────────── Avisos ───────────────────────────

    public string Toast
    {
        get => _toast;
        private set
        {
            SetProperty(ref _toast, value);
            OnPropertyChanged(nameof(HasToast));
        }
    }

    public string ToastTone
    {
        get => _toastTone;
        private set => SetProperty(ref _toastTone, value);
    }

    public bool HasToast => !string.IsNullOrWhiteSpace(Toast);

    /// <summary>Mensaje breve en la esquina; desaparece solo.</summary>
    public void ShowToast(string message, string tone = "info")
    {
        OnUi(() =>
        {
            ToastTone = tone;
            Toast = message;

            _toastTimer?.Stop();
            _toastTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(tone == "error" ? 8 : 4) };
            _toastTimer.Tick += (_, _) =>
            {
                _toastTimer?.Stop();
                Toast = string.Empty;
            };
            _toastTimer.Start();
        });
    }

    public void OnUi(Action action)
    {
        if (_dispatcher.CheckAccess()) action();
        else _dispatcher.BeginInvoke(action);
    }
}
