using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Windows.Threading;

namespace OnuStudio.App.ViewModels;

/// <summary>
/// Cada paso se recorre como una serie de tarjetas: en el centro de la pantalla hay
/// una sola pregunta a la vez. Al responderla se pasa a la siguiente (sola, si era
/// elegir una opcion; con Continuar, si habia que escribir), y arriba queda el
/// resumen de lo ya respondido para que el tecnico no se pierda.
/// </summary>
public sealed partial class WizardViewModel
{
    /// <summary>Propiedades que, al cambiar, pueden cambiar lo que se muestra o si se puede seguir.</summary>
    private static readonly HashSet<string> FlowSources = new()
    {
        nameof(DiscoveryTone), nameof(Serial), nameof(DeviceReady), nameof(ShowConnectionSettings),
        nameof(CloudConnected), nameof(Operation), nameof(SelectedServiceMode), nameof(SelectedClient),
        nameof(ClientName), nameof(SelectedZone), nameof(SelectedPlan), nameof(SelectedIp),
        nameof(WifiSsid), nameof(WifiPassword), nameof(IsBusy), nameof(Finished), nameof(Step),
        nameof(InternetError), nameof(ServiceMode), nameof(WanIp), nameof(WanVlan),
        nameof(Failed), nameof(ReadError), nameof(ExpressMode),
    };

    private static readonly string[] FlowProperties =
    {
        nameof(OnuDetected), nameof(HasOperation), nameof(HasServiceMode), nameof(HasClientIdentity),
        nameof(HasPlan), nameof(IsReserved), nameof(ReserveLabel), nameof(ClientSectionTitle),
        nameof(ClientSectionHint), nameof(IsBridgeMode), nameof(HasWanData), nameof(HasSsid),
        nameof(HasWifiPassword), nameof(ShowProgressSection), nameof(ReviewReady),
        nameof(SubStepCount), nameof(SubStepDots), nameof(SubStepLabel), nameof(HasSubSteps),
        nameof(StepAnswers), nameof(HasStepAnswers), nameof(CanGoNext), nameof(CanGoBack), nameof(NextLabel),
        nameof(ShowProvisionButton), nameof(ShowNextButton), nameof(ShowInstallButton), nameof(ShowRetryInstall),
        nameof(CanInstall), nameof(InstallBlocker), nameof(IsReading), nameof(ShowReadResult),
        nameof(ExpressReadTitle), nameof(ExpressReadHint), nameof(ExpressInstallTitle), nameof(ExpressInstallHint),
        nameof(HasExpressMatches), nameof(ExpressClientNote), nameof(StepTitle), nameof(StepHint),
        nameof(ShowDiscoveryCard), nameof(ExpressIpText), nameof(ExpressDeliverySummary),
    };

    private DispatcherTimer? _advanceTimer;

    private void InitFlow()
    {
        PropertyChanged += OnFlowSourceChanged;
    }

    private void OnFlowSourceChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName is not null && FlowSources.Contains(args.PropertyName)) NotifyFlow();
    }

    private void NotifyFlow()
    {
        Notify(FlowProperties);
        NextCommand.RaiseCanExecuteChanged();
        BackCommand.RaiseCanExecuteChanged();
        InstallCommand.RaiseCanExecuteChanged();
        RetryInstallCommand.RaiseCanExecuteChanged();
        ToggleModeCommand.RaiseCanExecuteChanged();
    }

    // ─────────── Tarjeta actual dentro del paso ───────────

    private int _subStep = 1;
    public int SubStep
    {
        get => _subStep;
        private set
        {
            if (SetProperty(ref _subStep, Math.Max(1, value))) NotifyFlow();
        }
    }

    private double _slideFrom = 56;
    /// <summary>Desde donde entra la tarjeta nueva: derecha al avanzar, izquierda al volver.</summary>
    public double SlideFrom
    {
        get => _slideFrom;
        private set => SetProperty(ref _slideFrom, value);
    }

    public int SubStepCount => ExpressMode ? 1 : Step switch
    {
        1 => 2,
        2 => CloudConnected ? 5 : 1,
        3 => IsRouterMode ? 3 : 1,
        4 => IsRouterMode ? 3 : 1,
        _ => 1,
    };

    public bool HasSubSteps => SubStepCount > 1;
    public string SubStepLabel => $"Parte {SubStep} de {SubStepCount}";

    /// <summary>Un punto por tarjeta del paso: hecho, actual o pendiente.</summary>
    public IReadOnlyList<string> SubStepDots => Enumerable.Range(1, SubStepCount)
        .Select(index => index < SubStep ? "ok" : index == SubStep ? "info" : "muted")
        .ToList();

    /// <summary>La tarjeta actual ya esta respondida y se puede pasar a la siguiente.</summary>
    private bool SubStepDone => (Step, SubStep) switch
    {
        (1, 1) => OnuDetected || ShowConnectionSettings || DeviceReady,
        (1, _) => DeviceReady,
        (2, 1) => HasOperation,
        (2, 2) => HasServiceMode,
        (2, 3) => HasClientIdentity,
        (2, 4) => !IsNewClient || HasPlan,
        (2, _) => IsReserved,
        (3, _) => HasWanData,
        (4, 1) => HasSsid,
        (4, 2) => HasWifiPassword,
        _ => true,
    };

    /// <summary>Tras elegir una tarjeta, espera un instante (se ve el check) y pasa a la siguiente.</summary>
    private void AdvanceSoon(int step, int subStep)
    {
        if (Step != step || SubStep != subStep) return;
        _advanceTimer?.Stop();
        _advanceTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(420) };
        _advanceTimer.Tick += (_, _) =>
        {
            _advanceTimer?.Stop();
            if (Step == step && SubStep == subStep && SubStepDone && SubStep < SubStepCount)
            {
                SlideFrom = 56;
                SubStep++;
            }
        };
        _advanceTimer.Start();
    }

    /// <summary>Lo ya respondido en este paso, en una linea.</summary>
    public string StepAnswers
    {
        get
        {
            var parts = new List<string>();
            if (ExpressMode)
            {
                if (Step >= 2 && DeviceReady) parts.Add(HasSerial ? $"{ModelLabel} · {Serial}" : ModelLabel);
                if (Step == 3)
                {
                    parts.Add(ClientName);
                    if (!string.IsNullOrWhiteSpace(Wan.IpAddress)) parts.Add(Wan.IpAddress);
                    if (HasSsid) parts.Add($"WiFi {WifiSsid}");
                }
                return string.Join("   ›   ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
            }
            switch (Step)
            {
                case 1:
                    if (OnuDetected) parts.Add(DiscoveryTitle.Replace("ONU detectada: ", string.Empty));
                    if (HasSerial) parts.Add(Serial);
                    break;
                case 2:
                    if (HasOperation) parts.Add(Operation.Title);
                    if (HasServiceMode) parts.Add(SelectedServiceMode!.Title);
                    if (HasClientIdentity && SubStep > 3) parts.Add(SelectedClient?.Nombre ?? ClientName);
                    if (HasPlan && SubStep > 4) parts.Add($"{SelectedZone!.Name} · {SelectedPlan!.Name}");
                    if (IsReserved) parts.Add(Wan.IpAddress);
                    break;
                case 3:
                    if (SubStep > 1) parts.Add(IsRouterMode ? $"{WanIp} · VLAN {WanVlan}" : $"Bridge · VLAN {WanVlan}");
                    break;
                case 4:
                    if (IsRouterMode && SubStep > 1 && HasSsid) parts.Add($"WiFi {WifiSsid}");
                    break;
            }
            return string.Join("   ›   ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
        }
    }

    public bool HasStepAnswers => !string.IsNullOrWhiteSpace(StepAnswers);

    // ─────────── Paso 1 ───────────

    public bool OnuDetected => DiscoveryTone == "ok";

    private bool _showConnectionSettings;
    /// <summary>El tecnico abrio los ajustes manuales: puede leer la ONU aunque no se haya detectado.</summary>
    public bool ShowConnectionSettings
    {
        get => _showConnectionSettings;
        set => SetProperty(ref _showConnectionSettings, value);
    }

    // ─────────── Paso 2 ───────────

    public bool HasOperation => SelectedOperation is not null;

    public ObservableCollection<OperationOption> ServiceModes { get; } = new()
    {
        new OperationOption("router", "Router con WiFi", "La ONU entrega internet, WiFi y puertos LAN. Lo mas comun."),
        new OperationOption("bridge", "Bridge", "La ONU solo pasa la VLAN; el router del cliente hace el resto."),
    };

    private OperationOption? _selectedServiceMode;
    public OperationOption? SelectedServiceMode
    {
        get => _selectedServiceMode;
        set
        {
            if (!SetProperty(ref _selectedServiceMode, value) || value is null) return;
            ServiceMode = value.Key;
            if (value.Key == "bridge") EnsureBridgeWifi();
            AdvanceSoon(2, 2);
        }
    }

    public bool HasServiceMode => SelectedServiceMode is not null;
    public bool IsBridgeMode => !IsRouterMode;

    public bool HasClientIdentity => HasSelectedClient || !string.IsNullOrWhiteSpace(ClientName);

    public string ClientSectionTitle => IsNewClient ? "Como se llama el cliente nuevo" : "Busca al cliente";
    public string ClientSectionHint => IsNewClient
        ? "Asi quedara el servicio en WispHub. Tambien se usa para proponer el nombre del WiFi."
        : "Escribe su nombre, usuario, telefono o IP y eligelo de la lista.";

    public bool HasPlan => SelectedZone is not null && SelectedPlan is not null;

    public bool IsReserved => !string.IsNullOrWhiteSpace(_cloudJobId);

    public string ReserveLabel => IsNewClient ? "Reservar la IP y abrir el expediente" : "Abrir el expediente";

    // ─────────── Paso 3 ───────────

    public bool HasWanData => !HasInternetError;

    // ─────────── Paso 4 ───────────

    public bool HasSsid => !string.IsNullOrWhiteSpace(WifiSsid);
    public bool HasWifiPassword => (WifiPassword?.Length ?? 0) >= 8;

    /// <summary>En bridge la ONU no emite WiFi, pero el perfil igual debe ser valido.</summary>
    private void EnsureBridgeWifi()
    {
        if (string.IsNullOrWhiteSpace(Wifi.Ssid)) Wifi.Ssid = SuggestSsid(ClientName);
        if (string.IsNullOrWhiteSpace(Wifi.Ssid)) Wifi.Ssid = "ISPMax_Bridge";
        if ((Wifi.Password?.Length ?? 0) < 8)
            Wifi.Password = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant();
        Notify(nameof(WifiSsid), nameof(WifiPassword));
        RevalidateWifi();
    }

    // ─────────── Paso 5 ───────────

    private bool _provisionStarted;
    public bool ShowProgressSection => _provisionStarted || IsBusy || Finished;
    public bool ReviewReady => Step == 5;
    public bool ShowProvisionButton => !ExpressMode && Step == 5 && !Finished;

    private void MarkProvisionStarted(bool started)
    {
        _provisionStarted = started;
        NotifyFlow();
    }
}
