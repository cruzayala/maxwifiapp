using System.Windows.Threading;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Net;

namespace OnuStudio.App.ViewModels;

/// <summary>
/// Modo rapido, el que abre el programa: la ONU se lee sola al conectar el cable, el
/// tecnico escribe el nombre del cliente y elige el plan, y el agente pone la IP, el
/// nombre del WiFi y la clave, abre el expediente e instala en un solo paso. El
/// asistente completo de cinco pasos sigue disponible para bridge, mover de PON y
/// otros casos que necesitan decidir mas cosas.
/// </summary>
public sealed partial class WizardViewModel
{
    private bool _expressMode = true;
    public bool ExpressMode
    {
        get => _expressMode;
        private set
        {
            if (SetProperty(ref _expressMode, value)) Notify(nameof(ModeToggleLabel));
        }
    }

    public string ModeToggleLabel => ExpressMode ? "Usar el asistente completo" : "Volver al modo rapido";

    private void InitExpress()
    {
        ClientResults.CollectionChanged += (_, _) => Notify(nameof(HasExpressMatches));
        BuildSteps();
    }

    private void BuildSteps()
    {
        Steps.Clear();
        if (ExpressMode)
        {
            Steps.Add(new StepChip(1, "1 · ONU"));
            Steps.Add(new StepChip(2, "2 · Cliente"));
            Steps.Add(new StepChip(3, "3 · Instalar"));
        }
        else
        {
            Steps.Add(new StepChip(1, "1 · Conectar"));
            Steps.Add(new StepChip(2, "2 · Cliente"));
            Steps.Add(new StepChip(3, "3 · Internet"));
            Steps.Add(new StepChip(4, "4 · WiFi"));
            Steps.Add(new StepChip(5, "5 · Revisar"));
        }
        UpdateStepChips();
    }

    /// <summary>Cambia de modo. La lectura de la ONU se conserva; lo demas empieza de nuevo.</summary>
    private void ToggleMode()
    {
        if (IsBusy) return;
        ExpressMode = !ExpressMode;
        BuildSteps();
        _cloudJobId = null;
        Finished = false;
        Failed = false;
        MarkProvisionStarted(false);
        Timeline.Clear();
        Progress = 0;
        ProgressLabel = "Listo para comenzar";
        SelectedOperation = null;
        Operation = Operations[0];
        SelectedServiceMode = null;
        ServiceMode = "router";
        SubStep = 1;
        Step = 1;
        if (ExpressMode && DeviceReady)
        {
            Step = 2;
            EnterExpressClientStage();
        }
        NotifyFlow();
    }

    // ─────────── Paso 1: lectura automatica ───────────

    // Con que ONU ya se intento la lectura automatica: la deteccion corre cada pocos
    // segundos y no debe volver a leer (ni reintentar un fallo) hasta que cambie el cable.
    private string? _autoReadKey;
    private DispatcherTimer? _expressAdvance;

    private string _readError = string.Empty;
    /// <summary>Por que no se pudo leer la ONU; vacio cuando la lectura fue bien o no se intento.</summary>
    public string ReadError
    {
        get => _readError;
        private set
        {
            if (SetProperty(ref _readError, value)) Notify(nameof(ReadFailed));
        }
    }

    public bool ReadFailed => !string.IsNullOrWhiteSpace(ReadError);

    /// <summary>La animacion de carga: se esta entrando a la ONU y leyendo su informacion.</summary>
    public bool IsReading => ExpressMode && Step == 1 && IsBusy;

    public bool ShowReadResult => ExpressMode && DeviceReady && !ReadFailed;

    /// <summary>Mientras no se lee ni hay resultado, se muestra que ve la busqueda.</summary>
    public bool ShowDiscoveryCard => ExpressMode && !IsReading && !DeviceReady && !ReadFailed;

    public string ExpressIpText => SelectedClient is null
        ? SelectedIpText
        : string.IsNullOrWhiteSpace(SelectedClient.Ip) ? "Sin IP registrada" : $"{SelectedClient.Ip} · la que ya tiene";

    public string ExpressDeliverySummary =>
        string.Join(" · ", new[] { ClientName, $"IP {Wan.IpAddress}", ModelLabel, Serial }.Where(part => !string.IsNullOrWhiteSpace(part)));

    public string ExpressReadTitle => ReadFailed ? "No pude leer la ONU"
        : DeviceReady ? "ONU lista"
        : IsBusy ? "Leyendo la ONU…"
        : OnuDetected ? "ONU detectada"
        : "Conecta la ONU";

    public string ExpressReadHint => ReadFailed ? "Revisa el aviso, corrige lo que haga falta y vuelve a leerla."
        : DeviceReady ? "Serial y modelo confirmados. Seguimos con el cliente."
        : IsBusy ? "Entro con el usuario tecnico y leo el serial, el firmware y la senal. No cambio nada."
        : OnuDetected ? "La leo en un momento."
        : "Conecta el cable Ethernet entre la PC y la ONU. La busco y la leo sola.";

    private void TryAutoRead(DiscoveredDevice device)
    {
        if (!ExpressMode || Step != 1 || IsBusy || DeviceReady) return;
        var key = $"{device.Host}|{device.AdapterIndex}";
        if (_autoReadKey == key) return;
        _autoReadKey = key;
        _ = RunCheckAsync();
    }

    /// <summary>Se quito el cable: la proxima ONU que aparezca se lee de nuevo desde cero.</summary>
    private void OnCableDisconnected()
    {
        _autoReadKey = null;
        if (!ExpressMode || IsBusy || Step > 2 || !DeviceReady) return;
        DeviceReady = false;
        Serial = string.Empty;
        ReadError = string.Empty;
        if (Step == 2)
        {
            SlideFrom = -56;
            Step = 1;
        }
        _toast("Se desconecto la ONU. Leo la siguiente en cuanto la conectes.", "info");
    }

    /// <summary>Tras leer bien, se ve el check un instante y se pasa solo al cliente.</summary>
    private void ScheduleExpressAdvance()
    {
        _expressAdvance?.Stop();
        _expressAdvance = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(1100) };
        _expressAdvance.Tick += (_, _) =>
        {
            _expressAdvance?.Stop();
            if (!ExpressMode || Step != 1 || !DeviceReady || IsBusy) return;
            SlideFrom = 56;
            Step = 2;
            EnterExpressClientStage();
        };
        _expressAdvance.Start();
    }

    // ─────────── Paso 2: cliente, plan y lo que se pone solo ───────────

    private void EnterExpressClientStage()
    {
        ServiceMode = "router";
        if (SelectedClient is null) Operation = Operations[0];
        EnsureExpressWifi();
        if (!CloudConnected) return;
        if (Zones.Count == 0) _ = LoadCatalogsAsync();
        else if (SelectedIp is null) _ = LoadIpCatalogAsync();
    }

    /// <summary>El nombre del cliente. Busca en ISP Max mientras se escribe, por si ya existe.</summary>
    public string ExpressName
    {
        get => ClientName;
        set
        {
            var name = value ?? string.Empty;
            if (SelectedClient is not null && !string.Equals(name.Trim(), SelectedClient.Nombre.Trim(), StringComparison.Ordinal))
                ClearExpressClient();
            ClientName = name;
            ClientSearch = name;
            OnPropertyChanged();
        }
    }

    public bool HasExpressMatches => ExpressMode && SelectedClient is null && ClientResults.Count > 0;

    public string ExpressClientNote => SelectedClient is null ? string.Empty
        : $"Ya existe en ISP Max · {Operation.Title}"
          + (string.IsNullOrWhiteSpace(SelectedClient.Ip) ? string.Empty : $" · conserva la IP {SelectedClient.Ip}");

    /// <summary>
    /// Que hacer con un cliente que ya existe: si su ONU registrada es la que esta
    /// conectada se restaura; si es otra, se cambia conservando el servicio y la IP.
    /// </summary>
    internal static string ExpressOperationFor(string? registeredSerial, string connectedSerial) =>
        !string.IsNullOrWhiteSpace(registeredSerial) && !string.IsNullOrWhiteSpace(connectedSerial)
        && string.Equals(registeredSerial.Trim(), connectedSerial.Trim(), StringComparison.OrdinalIgnoreCase)
            ? "restore_same_onu"
            : "replace_onu";

    private void SelectExpressClient(CloudClientSummary client)
    {
        SelectClient(client);
        // SelectClient deja el nombre en el buscador, y eso programa otra busqueda.
        _searchTimer.Stop();
        var key = ExpressOperationFor(client.SnOnu, Serial);
        SelectedOperation = Operations.First(option => option.Key == key);
        RefreshAutoSsid();
        OnPropertyChanged(nameof(ExpressName));
        Notify(nameof(HasExpressMatches), nameof(ExpressClientNote));
        NotifyFlow();
    }

    private void ClearExpressClient()
    {
        SelectedClient = null;
        SelectedOperation = Operations[0];
        ClientResults.Clear();
        CloudNote = FreeIps.Count == 0
            ? "No hay IP libres en los rangos configurados. Revisa Ajustes."
            : $"{FreeIps.Count} direcciones libres disponibles.";
        Notify(nameof(HasExpressMatches), nameof(ExpressClientNote));
        NotifyFlow();
    }

    // El ultimo nombre de WiFi que se propuso solo. Mientras el tecnico no lo cambie,
    // sigue al nombre del cliente; en cuanto lo edite, se respeta lo que escribio.
    private string? _autoSsid;

    internal static bool KeepsAutoSsid(string currentSsid, string? lastAutoSsid) =>
        string.IsNullOrWhiteSpace(currentSsid) || currentSsid == lastAutoSsid;

    private void RefreshAutoSsid()
    {
        if (!ExpressMode || !KeepsAutoSsid(Wifi.Ssid, _autoSsid)) return;
        var suggested = SuggestSsid(ClientName);
        if (Wifi.Ssid != suggested)
        {
            Wifi.Ssid = suggested;
            OnPropertyChanged(nameof(WifiSsid));
            RevalidateWifi();
        }
        _autoSsid = suggested;
    }

    private void EnsureExpressWifi()
    {
        if ((Wifi.Password?.Length ?? 0) < 8)
        {
            Wifi.Password = GeneratePassword();
            OnPropertyChanged(nameof(WifiPassword));
        }
        RefreshAutoSsid();
        RevalidateWifi();
    }

    public bool CanInstall => ExpressMode && Step == 2 && CloudConnected && DeviceReady && !IsBusy && HasClientIdentity
        && (!IsNewClient || (HasPlan && SelectedIp is not null))
        && Wifi.Validate().IsValid;

    public string InstallBlocker => !CloudConnected ? "Conecta ONU Studio con ISP Max para instalar."
        : !DeviceReady ? "Primero hay que leer la ONU."
        : !HasClientIdentity ? "Escribe el nombre del cliente."
        : IsNewClient && !HasPlan ? "Elige la zona y el plan."
        : IsNewClient && SelectedIp is null ? "No hay una IP libre para asignar."
        : !Wifi.Validate().IsValid ? Wifi.Validate().Message
        : string.Empty;

    // ─────────── Paso 3: instalar de una vez ───────────

    public bool ShowNextButton => ExpressMode ? Step == 1 && !Finished : !IsStep5;
    public bool ShowInstallButton => ExpressMode && Step == 2;
    public bool ShowRetryInstall => ExpressMode && Step == 3 && Failed && !IsBusy && !Finished;

    public string ExpressInstallTitle => Finished ? "ONU lista para el cliente"
        : Failed ? "La instalacion se detuvo"
        : _cloudJobId is null ? "Abriendo el expediente"
        : "Instalando la ONU";

    public string ExpressInstallHint => Finished ? "Todo quedo configurado, verificado y guardado en ISP Max. Entrega estos datos al cliente."
        : Failed ? "Nada quedo a medias sin registrar. Corrige lo que indica el aviso y reintenta."
        : "Reservo la IP, abro el expediente y configuro la ONU. No desconectes el cable.";

    /// <summary>
    /// Reserva la IP y abre el expediente (si aun no esta), y configura la ONU. Al
    /// reintentar tras un fallo no se vuelve a reservar: se retoma con el expediente abierto.
    /// </summary>
    private async Task RunExpressInstallAsync()
    {
        if (_cloudJobId is null && !CanInstall) return;
        RememberZone();
        SlideFrom = 56;
        Step = 3;
        Failed = false;
        MarkProvisionStarted(true);
        Timeline.Clear();
        Progress = 0;
        NotifyFlow();

        if (_cloudJobId is null)
        {
            ProgressLabel = "Reservando la IP y abriendo el expediente…";
            AddTimeline("running", IsNewClient
                ? $"Reservando la IP {SelectedIp?.Ip} y abriendo el expediente en ISP Max"
                : "Abriendo el expediente en ISP Max");
            var opened = await ReserveAndOpenJobAsync().ConfigureAwait(true);
            if (!opened || _cloudJobId is null)
            {
                Failed = true;
                ProgressLabel = "No se pudo preparar el expediente en ISP Max";
                AddTimeline("error", "ISP Max no completo la reserva o el expediente. Revisa el aviso y reintenta.");
                NotifyFlow();
                return;
            }
            AddTimeline("success", $"Expediente {_cloudJobId} abierto · IP {Wan.IpAddress}");
            if (IsNewClient) AddTimeline("success", "Cliente creado en WispHub y preparado en MikroTik");
        }

        BuildReview();
        await RunProvisionAsync(resetTimeline: false).ConfigureAwait(true);
        NotifyFlow();
    }

    private void AddTimeline(string status, string message) => Timeline.Add(new TimelineEntry
    {
        Time = DateTime.Now.ToString("HH:mm:ss"),
        Message = message,
        Status = status,
    });

    /// <summary>La zona casi siempre se repite entre clientes: queda propuesta la ultima usada.</summary>
    private void RememberZone()
    {
        if (SelectedZone is null || _host.Settings.LastZoneId == SelectedZone.Id) return;
        try
        {
            var settings = _host.Settings.Clone();
            settings.LastZoneId = SelectedZone.Id;
            _host.SaveSettings(settings);
        }
        catch (Exception)
        {
            // Es una preferencia: si no se puede guardar, la instalacion sigue igual.
        }
    }

    private void ResetExpress()
    {
        _autoReadKey = null;
        _autoSsid = null;
        ReadError = string.Empty;
        OnPropertyChanged(nameof(ExpressName));
        Notify(nameof(HasExpressMatches), nameof(ExpressClientNote));
    }
}
