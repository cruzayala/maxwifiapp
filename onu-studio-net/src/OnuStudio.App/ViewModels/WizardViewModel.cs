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

public sealed class NamedOption
{
    public NamedOption(int id, string name)
    {
        Id = id;
        Name = name;
    }

    public int Id { get; }
    public string Name { get; }
    public override string ToString() => Name;
}

public sealed class OperationOption
{
    public OperationOption(string key, string title, string detail)
    {
        Key = key;
        Title = title;
        Detail = detail;
    }

    public string Key { get; }
    public string Title { get; }
    public string Detail { get; }
}

/// <summary>Una etapa del asistente en la barra superior.</summary>
public sealed class StepChip : ObservableObject
{
    private string _tone = "muted";

    public StepChip(int number, string label)
    {
        Number = number;
        Label = label;
    }

    public int Number { get; }
    public string Label { get; }

    public string Tone
    {
        get => _tone;
        set => SetProperty(ref _tone, value);
    }
}

public sealed class TimelineEntry
{
    public string Time { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Status { get; set; } = "running";
}

/// <summary>
/// Asistente de cinco pasos. Guarda el mismo orden de seguridad del agente anterior:
/// primero se reserva la IP y se prepara el cliente en la nube, y la ONU solo se
/// toca al confirmar el ultimo paso.
/// </summary>
public sealed class WizardViewModel : ObservableObject
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
                nameof(StepTitle), nameof(StepHint), nameof(NextLabel), nameof(CanGoNext));
            NextCommand.RaiseCanExecuteChanged();
            BackCommand.RaiseCanExecuteChanged();
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
        if (Step == 4) BuildReview();
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

    // ─────────────────────────── Paso 1: deteccion ───────────────────────────

    public ObservableCollection<NetworkAdapter> Adapters { get; } = new();

    private NetworkAdapter? _selectedAdapter;
    public NetworkAdapter? SelectedAdapter
    {
        get => _selectedAdapter;
        set
        {
            if (SetProperty(ref _selectedAdapter, value)) Notify(nameof(AdapterSummary));
        }
    }

    private string _host_ = "192.168.100.1";
    public string DeviceHost
    {
        get => _host_;
        set => SetProperty(ref _host_, value);
    }

    private string _model = "EG8141A5";
    public string DeviceModel
    {
        get => _model;
        set
        {
            if (SetProperty(ref _model, value)) Notify(nameof(ModelLabel));
        }
    }

    public string[] Models { get; } = { "EG8141A5", "F670L" };

    public string ModelLabel => DeviceModel == "F670L" ? "ZTE F670L" : "Huawei / Novatech EG8141A5";

    private string _localAddress = "192.168.100.10";
    public string LocalAddress
    {
        get => _localAddress;
        set => SetProperty(ref _localAddress, value);
    }

    private int _prefixLength = 24;
    public int PrefixLength
    {
        get => _prefixLength;
        set => SetProperty(ref _prefixLength, value);
    }

    private string _deviceUser = string.Empty;
    public string DeviceUser
    {
        get => _deviceUser;
        set => SetProperty(ref _deviceUser, value);
    }

    private string _devicePassword = string.Empty;
    public string DevicePassword
    {
        get => _devicePassword;
        set => SetProperty(ref _devicePassword, value);
    }

    private string _discoveryTitle = "Buscando una ONU…";
    public string DiscoveryTitle
    {
        get => _discoveryTitle;
        private set => SetProperty(ref _discoveryTitle, value);
    }

    private string _discoveryDetail = "Conecta el cable Ethernet entre la PC y la ONU.";
    public string DiscoveryDetail
    {
        get => _discoveryDetail;
        private set => SetProperty(ref _discoveryDetail, value);
    }

    private string _discoveryTone = "info";
    public string DiscoveryTone
    {
        get => _discoveryTone;
        private set => SetProperty(ref _discoveryTone, value);
    }

    private bool _deviceReady;
    public bool DeviceReady
    {
        get => _deviceReady;
        private set
        {
            if (!SetProperty(ref _deviceReady, value)) return;
            Notify(nameof(CanGoNext));
            NextCommand.RaiseCanExecuteChanged();
        }
    }

    public string AdapterSummary => SelectedAdapter is null
        ? "Sin tarjeta seleccionada"
        : $"{SelectedAdapter.DisplayName} · {(SelectedAdapter.IsUp ? "conectada" : "sin enlace")}";

    private string _serial = string.Empty;
    public string Serial
    {
        get => _serial;
        private set
        {
            if (SetProperty(ref _serial, value)) Notify(nameof(HasSerial));
        }
    }

    public bool HasSerial => !string.IsNullOrWhiteSpace(Serial);

    private string _firmware = string.Empty;
    public string Firmware
    {
        get => _firmware;
        private set => SetProperty(ref _firmware, value);
    }

    private string _opticalSummary = string.Empty;
    public string OpticalSummary
    {
        get => _opticalSummary;
        private set => SetProperty(ref _opticalSummary, value);
    }

    public JsonObject? Inventory
    {
        get => _inventory;
        private set
        {
            _inventory = value;
            OnPropertyChanged(nameof(Inventory));
            InventoryChanged?.Invoke(value);
        }
    }

    public event Action<JsonObject?>? InventoryChanged;

    public bool CanCheck => SelectedAdapter is not null && !IsBusy;

    private void RefreshAdapters()
    {
        var adapters = NetworkTools.ListAdapters();
        Adapters.Clear();
        foreach (var adapter in adapters) Adapters.Add(adapter);
        SelectedAdapter ??= adapters.FirstOrDefault(item => item.Supported && item.IsUp) ?? adapters.FirstOrDefault();
    }

    private void ApplyDiscovery(DiscoveryState state)
    {
        if (state.Detected && state.Device is not null)
        {
            var device = state.Device;
            DiscoveryTitle = $"ONU detectada: {device.Vendor}";
            DiscoveryDetail = $"{device.Model} · {device.Host} · {device.AdapterName} · {device.LatencyMs} ms";
            DiscoveryTone = "ok";
            DeviceHost = device.Host;
            if (device.SuggestedModel is { } suggested) DeviceModel = suggested;
            if (device.AdapterIndex is { } index)
            {
                var adapter = Adapters.FirstOrDefault(item => item.Index == index);
                if (adapter is null)
                {
                    RefreshAdapters();
                    adapter = Adapters.FirstOrDefault(item => item.Index == index);
                }
                if (adapter is not null) SelectedAdapter = adapter;
            }
        }
        else
        {
            DiscoveryTitle = state.Status switch
            {
                "cable_disconnected" => "Conecta la ONU por Ethernet",
                "network_setup_required" => "Falta preparar la tarjeta de red",
                "not_detected" => "No se ve ninguna ONU",
                "error" => "No se pudo revisar la red local",
                _ => "Buscando una ONU…",
            };
            DiscoveryDetail = state.NextAction;
            DiscoveryTone = state.Status == "error" ? "error" : "info";
        }
    }

    private ConnectionCheckRequest BuildCheckRequest() => new()
    {
        Device = new DeviceSettings
        {
            Host = DeviceHost.Trim(),
            Model = DeviceModel,
            Username = string.IsNullOrWhiteSpace(DeviceUser) ? _host.Settings.UsernameFor(DeviceModel) : DeviceUser.Trim(),
            Password = string.IsNullOrEmpty(DevicePassword) ? null : DevicePassword,
        },
        LocalNetwork = new LocalNetworkSettings
        {
            AdapterIndex = SelectedAdapter?.Index ?? 0,
            Address = LocalAddress.Trim(),
            PrefixLength = PrefixLength,
        },
        PrepareAdapter = true,
    };

    private async Task RunCheckAsync()
    {
        var request = BuildCheckRequest();
        var validation = request.Validate();
        if (!validation.IsValid)
        {
            _toast(validation.Message, "error");
            return;
        }

        IsBusy = true;
        BusyMessage = "Entrando a la ONU y leyendo su informacion…";
        try
        {
            var job = _host.Jobs.Create("check", request.SafeCopy(), request.Device.Host);
            _activeJobId = job.Id;
            Timeline.Clear();
            await Task.Run(() => _host.Provisioning.ExecuteCheckAsync(job.Id, request)).ConfigureAwait(true);

            var finished = _host.Jobs.Get(job.Id);
            if (finished?.Status == "success" && finished.Result is not null)
            {
                Inventory = finished.Result["inventory"] as JsonObject;
                ReadInventorySummary(finished.Result);
                DeviceReady = true;
                _toast("ONU leida correctamente.", "ok");
            }
            else
            {
                DeviceReady = false;
                _toast(finished?.Error ?? "No se pudo leer la ONU.", "error");
            }
        }
        catch (Exception exception)
        {
            DeviceReady = false;
            _toast(exception.Message, "error");
        }
        finally
        {
            IsBusy = false;
            BusyMessage = string.Empty;
        }
    }

    private void ReadInventorySummary(JsonObject result)
    {
        Serial = result["serial"]?.ToString() ?? string.Empty;
        var inventory = result["inventory"] as JsonObject;
        var device = inventory?["device"] as JsonObject;
        var optical = inventory?["optical"] as JsonObject;

        Firmware = device?["software_version"]?.ToString() ?? string.Empty;
        var rx = optical?["rx_power_dbm"]?.ToString();
        var tx = optical?["tx_power_dbm"]?.ToString();
        OpticalSummary = string.IsNullOrWhiteSpace(rx) && string.IsNullOrWhiteSpace(tx)
            ? "Sin lectura optica"
            : $"Recibe {rx ?? "—"} dBm · Envia {tx ?? "—"} dBm";

        if (string.IsNullOrWhiteSpace(Wifi.Ssid) && !string.IsNullOrWhiteSpace(ClientName))
            Wifi.Ssid = SuggestSsid(ClientName);
    }

    // ─────────────────────────── Paso 2: nube ───────────────────────────

    public bool CloudConnected => _host.Session.Current.Connected;

    public string CloudSummary
    {
        get
        {
            var session = _host.Session.Current;
            if (!session.Connected) return "ONU Studio no esta conectado a ISP Max.";
            return $"Conectado como {session.User?.Username} · {session.BaseUrl}";
        }
    }

    private string _cloudUrl = CloudSessionState.DefaultBaseUrl();
    public string CloudUrl
    {
        get => _cloudUrl;
        set => SetProperty(ref _cloudUrl, value);
    }

    private string _cloudUsername = string.Empty;
    public string CloudUsername
    {
        get => _cloudUsername;
        set => SetProperty(ref _cloudUsername, value);
    }

    private string _cloudPassword = string.Empty;
    public string CloudPassword
    {
        get => _cloudPassword;
        set => SetProperty(ref _cloudPassword, value);
    }

    private async Task LoginAsync()
    {
        IsBusy = true;
        BusyMessage = "Conectando con ISP Max…";
        try
        {
            await _host.Session.LoginAsync(CloudUrl, CloudUsername, CloudPassword).ConfigureAwait(true);
            CloudPassword = string.Empty;
            _toast("ONU Studio quedo conectado a ISP Max.", "ok");
            await LoadCatalogsAsync().ConfigureAwait(true);
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
        finally
        {
            IsBusy = false;
            BusyMessage = string.Empty;
            Notify(nameof(CloudConnected), nameof(CloudSummary));
        }
    }

    public ObservableCollection<OperationOption> Operations { get; } = new()
    {
        new OperationOption("new_client", "Cliente nuevo", "Se reserva una IP y se crea el servicio en WispHub y MikroTik."),
        new OperationOption("restore_same_onu", "Restaurar la misma ONU", "El cliente ya existe; solo se reconfigura su equipo."),
        new OperationOption("replace_onu", "Cambiar la ONU", "Se reemplaza el equipo conservando el servicio y la IP."),
        new OperationOption("migrate_pon", "Mover de PON", "El cliente se pasa a otro puerto optico."),
    };

    private OperationOption _operation = new("new_client", "Cliente nuevo", string.Empty);
    public OperationOption Operation
    {
        get => _operation;
        set
        {
            if (!SetProperty(ref _operation, value)) return;
            Notify(nameof(IsNewClient), nameof(NeedsPon), nameof(CanReserve));
            ReserveCommand.RaiseCanExecuteChanged();
        }
    }

    public bool IsNewClient => Operation.Key == "new_client";
    public bool NeedsPon => Operation.Key == "migrate_pon";

    private string _targetPon = string.Empty;
    public string TargetPon
    {
        get => _targetPon;
        set => SetProperty(ref _targetPon, value);
    }

    private string _operationReason = string.Empty;
    public string OperationReason
    {
        get => _operationReason;
        set => SetProperty(ref _operationReason, value);
    }

    public ObservableCollection<CloudClientSummary> ClientResults { get; } = new();

    private string _clientSearch = string.Empty;
    public string ClientSearch
    {
        get => _clientSearch;
        set
        {
            if (!SetProperty(ref _clientSearch, value)) return;
            _searchTimer.Stop();
            if (value.Trim().Length >= 2) _searchTimer.Start();
            else ClientResults.Clear();
        }
    }

    private CloudClientSummary? _selectedClient;
    public CloudClientSummary? SelectedClient
    {
        get => _selectedClient;
        private set
        {
            if (!SetProperty(ref _selectedClient, value)) return;
            Notify(nameof(HasSelectedClient), nameof(CanReserve));
            ReserveCommand.RaiseCanExecuteChanged();
        }
    }

    public bool HasSelectedClient => SelectedClient is not null;

    private string _clientName = string.Empty;
    public string ClientName
    {
        get => _clientName;
        set
        {
            if (!SetProperty(ref _clientName, value)) return;
            Notify(nameof(CanReserve));
            ReserveCommand.RaiseCanExecuteChanged();
            if (string.IsNullOrWhiteSpace(Wifi.Ssid)) Wifi.Ssid = SuggestSsid(value);
        }
    }

    public ObservableCollection<NamedOption> Zones { get; } = new();
    public ObservableCollection<NamedOption> Plans { get; } = new();

    private NamedOption? _selectedZone;
    public NamedOption? SelectedZone
    {
        get => _selectedZone;
        set
        {
            if (SetProperty(ref _selectedZone, value)) ReserveCommand.RaiseCanExecuteChanged();
        }
    }

    private NamedOption? _selectedPlan;
    public NamedOption? SelectedPlan
    {
        get => _selectedPlan;
        set
        {
            if (!SetProperty(ref _selectedPlan, value)) return;
            if (value is not null) ApplyPlanSpeed(value.Name);
            ReserveCommand.RaiseCanExecuteChanged();
        }
    }

    private double _downloadMbps = 10;
    public double DownloadMbps
    {
        get => _downloadMbps;
        set => SetProperty(ref _downloadMbps, value);
    }

    private double _uploadMbps = 10;
    public double UploadMbps
    {
        get => _uploadMbps;
        set => SetProperty(ref _uploadMbps, value);
    }

    public ObservableCollection<CloudIpRow> FreeIps { get; } = new();

    private CloudIpRow? _selectedIp;
    public CloudIpRow? SelectedIp
    {
        get => _selectedIp;
        set
        {
            if (!SetProperty(ref _selectedIp, value)) return;
            Notify(nameof(SelectedIpText), nameof(CanReserve));
            ReserveCommand.RaiseCanExecuteChanged();
        }
    }

    public string SelectedIpText => SelectedIp is null ? "Sin IP elegida" : $"{SelectedIp.Ip} · {SelectedIp.RangeName}";

    private string _cloudNote = string.Empty;
    public string CloudNote
    {
        get => _cloudNote;
        private set => SetProperty(ref _cloudNote, value);
    }

    public bool CanReserve => CloudConnected && !IsBusy &&
        (HasSelectedClient || !string.IsNullOrWhiteSpace(ClientName)) &&
        (!IsNewClient || SelectedIp is not null);

    private async Task SearchClientsAsync()
    {
        if (!CloudConnected) return;
        try
        {
            var results = await _host.Catalog.SearchClientsAsync(ClientSearch).ConfigureAwait(true);
            ClientResults.Clear();
            foreach (var client in results) ClientResults.Add(client);
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
    }

    private void SelectClient(CloudClientSummary client)
    {
        SelectedClient = client;
        ClientName = client.Nombre;
        if (client.ZonaId is { } zoneId) SelectedZone = Zones.FirstOrDefault(zone => zone.Id == zoneId) ?? SelectedZone;
        if (client.PlanInternetId is { } planId) SelectedPlan = Plans.FirstOrDefault(plan => plan.Id == planId) ?? SelectedPlan;
        if (client.DownloadMbps is { } download and > 0) DownloadMbps = download;
        if (client.UploadMbps is { } upload and > 0) UploadMbps = upload;
        if (!string.IsNullOrWhiteSpace(client.Ip)) CloudNote = $"Este cliente ya usa la IP {client.Ip}.";
        ClientResults.Clear();
        ClientSearch = client.Nombre;
    }

    public async Task LoadCatalogsAsync()
    {
        if (!CloudConnected) return;
        try
        {
            var catalog = await _host.Catalog.CommercialCatalogAsync().ConfigureAwait(true);
            Zones.Clear();
            foreach (var node in catalog["zones"] as JsonArray ?? new JsonArray())
            {
                if (node is not JsonObject zone) continue;
                var id = zone["id"]?.GetValue<int>() ?? zone["id_zona"]?.GetValue<int>() ?? 0;
                var name = zone["nombre"]?.ToString() ?? zone["name"]?.ToString() ?? $"Zona {id}";
                if (id > 0) Zones.Add(new NamedOption(id, name));
            }

            Plans.Clear();
            foreach (var node in catalog["plans"] as JsonArray ?? new JsonArray())
            {
                if (node is not JsonObject plan) continue;
                var id = plan["id"]?.GetValue<int>() ?? 0;
                var name = plan["nombre"]?.ToString() ?? plan["name"]?.ToString() ?? $"Plan {id}";
                if (id > 0) Plans.Add(new NamedOption(id, name));
            }

            await LoadIpCatalogAsync().ConfigureAwait(true);
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
    }

    public async Task LoadIpCatalogAsync()
    {
        if (!CloudConnected) return;
        try
        {
            var catalog = await _host.Catalog.IpCatalogAsync().ConfigureAwait(true);
            FreeIps.Clear();
            foreach (var row in catalog.Rows.Where(row => row.IsFree).Take(200)) FreeIps.Add(row);
            SelectedIp = catalog.Recommended is not null
                ? FreeIps.FirstOrDefault(row => row.Ip == catalog.Recommended.Ip)
                : FreeIps.FirstOrDefault();
            CloudNote = FreeIps.Count == 0
                ? "No hay IP libres en los rangos configurados. Revisa Ajustes."
                : $"{FreeIps.Count} direcciones libres disponibles.";
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
    }

    private void ApplyPlanSpeed(string planName)
    {
        var match = System.Text.RegularExpressions.Regex.Match(planName, @"(\d+(?:\.\d+)?)\s*([kKmM])");
        if (!match.Success) return;
        var value = double.Parse(match.Groups[1].Value, System.Globalization.CultureInfo.InvariantCulture);
        var mbps = match.Groups[2].Value.ToLowerInvariant() == "k" ? value / 1000 : value;
        if (mbps <= 0) return;
        DownloadMbps = Math.Round(mbps, 2);
        UploadMbps = Math.Round(mbps, 2);
    }

    /// <summary>Reserva la IP y abre el expediente en ISP Max. La ONU aun no se toca.</summary>
    private async Task ReserveAndOpenJobAsync()
    {
        IsBusy = true;
        BusyMessage = "Reservando la IP y preparando el expediente…";
        try
        {
            string? token = null;
            string? ip = SelectedIp?.Ip ?? SelectedClient?.Ip;

            if (IsNewClient && SelectedIp is not null)
            {
                var reservation = await _host.Catalog.ReserveIpAsync(SelectedIp.Ip, ClientName, Serial).ConfigureAwait(true);
                token = reservation["token"]?.ToString();
                ip = reservation["ip"]?.ToString() ?? SelectedIp.Ip;
            }

            // La VLAN y la puerta de enlace salen del rango al que pertenece la IP,
            // asi que se aplican antes de abrir el expediente.
            if (!string.IsNullOrWhiteSpace(ip)) ApplyReservedIp(ip!);

            var job = await _host.Catalog.CreateJobAsync(new CloudCatalog.JobRequest
            {
                Mode = Operation.Key,
                ServiceMode = ServiceMode,
                ReservationToken = token,
                ClientId = SelectedClient?.IdServicio,
                Ip = ip,
                ClientName = string.IsNullOrWhiteSpace(ClientName) ? SelectedClient?.Nombre : ClientName,
                Serial = string.IsNullOrWhiteSpace(Serial) ? null : Serial,
                Model = DeviceModel,
                ZoneId = SelectedZone?.Id,
                PlanId = SelectedPlan?.Id,
                UploadMbps = UploadMbps,
                DownloadMbps = DownloadMbps,
                Vlan = Wan.VlanId,
                Inventory = Inventory,
                Host = DeviceHost,
                TargetPonIndex = NeedsPon ? TargetPon : null,
                OperationReason = string.IsNullOrWhiteSpace(OperationReason) ? null : OperationReason,
            }).ConfigureAwait(true);

            _cloudJobId = job["id"]?.ToString();
            CloudNote = $"Expediente {_cloudJobId} abierto en ISP Max.";

            if (IsNewClient && _cloudJobId is not null && SelectedZone is not null && SelectedPlan is not null && ip is not null)
            {
                BusyMessage = "Creando el cliente en WispHub y preparando MikroTik…";
                await _host.Catalog.ProvisionClientAsync(
                    _cloudJobId, ip, string.IsNullOrWhiteSpace(ClientName) ? "Cliente nuevo" : ClientName,
                    SelectedZone.Id, SelectedPlan.Id, UploadMbps, DownloadMbps).ConfigureAwait(true);
                CloudNote = "Cliente creado en WispHub y preparado en MikroTik.";
            }

            _toast("IP reservada y expediente listo.", "ok");
            Notify(nameof(CanGoNext));
            NextCommand.RaiseCanExecuteChanged();
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
        finally
        {
            IsBusy = false;
            BusyMessage = string.Empty;
        }
    }

    /// <summary>Deriva mascara, gateway y origen remoto del rango al que pertenece la IP.</summary>
    private void ApplyReservedIp(string ip)
    {
        Wan.IpAddress = ip;
        var range = _host.Store.NetworkRanges().FirstOrDefault(item =>
            Ipv4.TryParse(ip, out var address) && Ipv4.CidrContains(item.Cidr, address));
        if (range is not null)
        {
            var (_, prefix) = Ipv4.ParseCidr(range.Cidr);
            Wan.SubnetMask = Ipv4.MaskFromPrefix(prefix).ToString();
            Wan.Gateway = range.Gateway;
            Wan.PrimaryDns = range.PrimaryDns;
            Wan.SecondaryDns = string.IsNullOrWhiteSpace(range.SecondaryDns) ? null : range.SecondaryDns;
            Wan.VlanId = range.Vlan;
            RemoteAccess.Source = $"{range.Gateway}/32";
        }
        Notify(nameof(Wan), nameof(RemoteAccess));
        NotifyWan();
    }

    // ─────────────────────────── Paso 3: internet ───────────────────────────

    public WanSettings Wan { get; }
    public RemoteAccessSettings RemoteAccess { get; }

    private string _serviceMode = "router";
    public string ServiceMode
    {
        get => _serviceMode;
        set
        {
            if (SetProperty(ref _serviceMode, value)) Notify(nameof(IsRouterMode));
        }
    }

    public bool IsRouterMode => ServiceMode == "router";

    private bool _tr069Enabled = true;
    public bool Tr069Enabled
    {
        get => _tr069Enabled;
        set => SetProperty(ref _tr069Enabled, value);
    }

    // Enlaces individuales para que la vista pueda editar la WAN con validacion.
    public string WanIp
    {
        get => Wan.IpAddress;
        set { Wan.IpAddress = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public string WanMask
    {
        get => Wan.SubnetMask;
        set { Wan.SubnetMask = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public string WanGateway
    {
        get => Wan.Gateway;
        set { Wan.Gateway = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public string WanDns
    {
        get => Wan.PrimaryDns;
        set { Wan.PrimaryDns = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public string WanDnsSecondary
    {
        get => Wan.SecondaryDns ?? string.Empty;
        set { Wan.SecondaryDns = string.IsNullOrWhiteSpace(value) ? null : value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public int WanVlan
    {
        get => Wan.VlanId;
        set { Wan.VlanId = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public int WanMtu
    {
        get => Wan.Mtu;
        set { Wan.Mtu = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public bool WanNat
    {
        get => Wan.NatEnabled;
        set { Wan.NatEnabled = value; OnPropertyChanged(); }
    }

    public bool BindSsid1
    {
        get => Wan.BindSsid1;
        set { Wan.BindSsid1 = value; OnPropertyChanged(); }
    }

    public bool Lan1 { get => HasPort(1); set => SetPort(1, value); }
    public bool Lan2 { get => HasPort(2); set => SetPort(2, value); }
    public bool Lan3 { get => HasPort(3); set => SetPort(3, value); }
    public bool Lan4 { get => HasPort(4); set => SetPort(4, value); }

    private bool HasPort(int port) => Wan.BindLanPorts.Contains(port);

    private void SetPort(int port, bool enabled)
    {
        if (enabled && !Wan.BindLanPorts.Contains(port)) Wan.BindLanPorts.Add(port);
        if (!enabled) Wan.BindLanPorts.Remove(port);
        Wan.BindLanPorts.Sort();
        OnPropertyChanged($"Lan{port}");
        RevalidateInternet();
    }

    public string RemoteSource
    {
        get => RemoteAccess.Source;
        set { RemoteAccess.Source = value; OnPropertyChanged(); RevalidateInternet(); }
    }

    public bool RemoteEnabled
    {
        get => RemoteAccess.Enabled;
        set { RemoteAccess.Enabled = value; OnPropertyChanged(); }
    }

    private string _internetError = string.Empty;
    public string InternetError
    {
        get => _internetError;
        private set
        {
            if (SetProperty(ref _internetError, value)) OnPropertyChanged(nameof(HasInternetError));
        }
    }

    public bool HasInternetError => !string.IsNullOrWhiteSpace(InternetError);

    private void NotifyWan() => Notify(nameof(WanIp), nameof(WanMask), nameof(WanGateway), nameof(WanDns),
        nameof(WanDnsSecondary), nameof(WanVlan), nameof(WanMtu), nameof(RemoteSource));

    private ValidationResult ValidateInternet()
    {
        var result = new ValidationResult();
        result.Merge(Wan.Validate());
        result.Merge(RemoteAccess.Validate());
        return result;
    }

    private void RevalidateInternet()
    {
        var result = ValidateInternet();
        InternetError = result.IsValid ? string.Empty : result.Message;
        Notify(nameof(CanGoNext));
        NextCommand.RaiseCanExecuteChanged();
    }

    // ─────────────────────────── Paso 4: WiFi ───────────────────────────

    public WifiSettings Wifi { get; }

    public string WifiSsid
    {
        get => Wifi.Ssid;
        set { Wifi.Ssid = value; OnPropertyChanged(); RevalidateWifi(); }
    }

    public string WifiPassword
    {
        get => Wifi.Password;
        set { Wifi.Password = value; OnPropertyChanged(); RevalidateWifi(); }
    }

    public bool WifiEnabled
    {
        get => Wifi.Enabled;
        set { Wifi.Enabled = value; OnPropertyChanged(); }
    }

    public bool WifiBroadcast
    {
        get => Wifi.Broadcast;
        set { Wifi.Broadcast = value; OnPropertyChanged(); }
    }

    public bool WifiWmm
    {
        get => Wifi.WmmEnabled;
        set { Wifi.WmmEnabled = value; OnPropertyChanged(); }
    }

    public bool WifiWps
    {
        get => Wifi.WpsEnabled;
        set { Wifi.WpsEnabled = value; OnPropertyChanged(); }
    }

    public int WifiMaxClients
    {
        get => Wifi.MaxClients;
        set { Wifi.MaxClients = value; OnPropertyChanged(); RevalidateWifi(); }
    }

    private string _wifiError = string.Empty;
    public string WifiError
    {
        get => _wifiError;
        private set
        {
            if (SetProperty(ref _wifiError, value)) OnPropertyChanged(nameof(HasWifiError));
        }
    }

    public bool HasWifiError => !string.IsNullOrWhiteSpace(WifiError);

    private void RevalidateWifi()
    {
        var result = Wifi.Validate();
        WifiError = result.IsValid ? string.Empty : result.Message;
        Notify(nameof(CanGoNext));
        NextCommand.RaiseCanExecuteChanged();
    }

    /// <summary>Propone un nombre WiFi con el nombre del cliente, sin acentos ni espacios raros.</summary>
    internal static string SuggestSsid(string clientName)
    {
        var clean = new string(clientName
            .Normalize(NormalizationForm.FormD)
            .Where(character => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(character)
                != System.Globalization.UnicodeCategory.NonSpacingMark)
            .ToArray());
        clean = System.Text.RegularExpressions.Regex.Replace(clean, "[^A-Za-z0-9]+", "-").Trim('-');
        if (clean.Length == 0) return "ISPMax";
        return clean.Length > 28 ? clean[..28] : clean;
    }

    /// <summary>Clave WiFi segura y facil de dictar por telefono.</summary>
    internal static string GeneratePassword()
    {
        const string alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var bytes = RandomNumberGenerator.GetBytes(12);
        return new string(bytes.Select(value => alphabet[value % alphabet.Length]).ToArray());
    }

    private void GenerateWifi()
    {
        if (string.IsNullOrWhiteSpace(WifiSsid) && !string.IsNullOrWhiteSpace(ClientName))
            WifiSsid = SuggestSsid(ClientName);
        WifiPassword = GeneratePassword();
        _toast("Clave WiFi generada.", "ok");
    }

    // ─────────────────────────── Paso 5: revision y ejecucion ───────────────────────────

    public ObservableCollection<TimelineEntry> Timeline { get; } = new();

    private string _reviewClient = string.Empty;
    public string ReviewClient
    {
        get => _reviewClient;
        private set => SetProperty(ref _reviewClient, value);
    }

    private string _reviewOnu = string.Empty;
    public string ReviewOnu
    {
        get => _reviewOnu;
        private set => SetProperty(ref _reviewOnu, value);
    }

    private string _reviewInternet = string.Empty;
    public string ReviewInternet
    {
        get => _reviewInternet;
        private set => SetProperty(ref _reviewInternet, value);
    }

    private string _reviewWifi = string.Empty;
    public string ReviewWifi
    {
        get => _reviewWifi;
        private set => SetProperty(ref _reviewWifi, value);
    }

    private string _reviewCloud = string.Empty;
    public string ReviewCloud
    {
        get => _reviewCloud;
        private set => SetProperty(ref _reviewCloud, value);
    }

    public bool CreateBackups { get; set; } = true;
    public bool SaveConfiguration { get; set; } = true;
    public bool ReplaceConflictingWan { get; set; }

    private void BuildReview()
    {
        ReviewClient = string.IsNullOrWhiteSpace(ClientName) ? "Sin cliente indicado" : ClientName;
        ReviewOnu = $"{ModelLabel} · {DeviceHost}" + (HasSerial ? $" · {Serial}" : string.Empty);
        ReviewInternet = IsRouterMode
            ? $"IP {Wan.IpAddress}/{Wan.SubnetMask} · puerta {Wan.Gateway} · VLAN {Wan.VlanId} · NAT {(Wan.NatEnabled ? "si" : "no")}"
            : $"Bridge en VLAN {Wan.VlanId}";
        ReviewWifi = IsRouterMode ? $"{Wifi.Ssid} · WPA2-AES · {Wifi.MaxClients} equipos" : "Sin WiFi (modo bridge)";
        ReviewCloud = _cloudJobId is null ? "Sin expediente de nube" : $"Expediente {_cloudJobId}";
    }

    private ProvisionRequest BuildProvisionRequest() => new()
    {
        Device = new DeviceSettings
        {
            Host = DeviceHost.Trim(),
            Model = DeviceModel,
            Username = string.IsNullOrWhiteSpace(DeviceUser) ? _host.Settings.UsernameFor(DeviceModel) : DeviceUser.Trim(),
            Password = string.IsNullOrEmpty(DevicePassword) ? null : DevicePassword,
        },
        LocalNetwork = new LocalNetworkSettings
        {
            AdapterIndex = SelectedAdapter?.Index ?? 0,
            Address = LocalAddress.Trim(),
            PrefixLength = PrefixLength,
        },
        Wan = Wan.Clone(),
        Wifi = Wifi.Clone(),
        Tr069 = new Tr069Settings
        {
            Enabled = Tr069Enabled,
            AcsUrl = _host.Settings.AcsUrl,
            Username = _host.Settings.Tr069Username,
            ConnectionRequestUsername = _host.Settings.ConnectionRequestUsername,
            PeriodicInformInterval = _host.Settings.PeriodicInformInterval,
        },
        RemoteAccess = RemoteAccess.Clone(),
        SaveConfiguration = SaveConfiguration,
        CreateBackups = CreateBackups,
        ReplaceConflictingWan = ReplaceConflictingWan,
        CloudJobId = _cloudJobId,
        ServiceOperation = Operation.Key,
        ServiceMode = ServiceMode,
    };

    /// <summary>Una vez terminado no se vuelve a aplicar sin empezar otro cliente.</summary>
    public bool CanProvision => !IsBusy && Step == 5 && !Finished;

    private int _progress;
    public int Progress
    {
        get => _progress;
        private set => SetProperty(ref _progress, value);
    }

    private string _progressLabel = "Listo para comenzar";
    public string ProgressLabel
    {
        get => _progressLabel;
        private set => SetProperty(ref _progressLabel, value);
    }

    private bool _finished;
    public bool Finished
    {
        get => _finished;
        private set
        {
            if (!SetProperty(ref _finished, value)) return;
            OnPropertyChanged(nameof(CanProvision));
            ProvisionCommand.RaiseCanExecuteChanged();
        }
    }

    private bool _failed;
    public bool Failed
    {
        get => _failed;
        private set => SetProperty(ref _failed, value);
    }

    private async Task RunProvisionAsync()
    {
        var request = BuildProvisionRequest();
        var validation = request.Validate();
        if (!validation.IsValid)
        {
            _toast(validation.Message, "error");
            return;
        }

        IsBusy = true;
        Finished = false;
        Failed = false;
        Timeline.Clear();
        Progress = 0;
        ProgressLabel = "Preparando…";
        BusyMessage = "Configurando la ONU. No desconectes el cable.";

        try
        {
            var job = _host.Provisioning.CreateProvisionJob(request);
            _activeJobId = job.Id;
            await Task.Run(() => _host.Provisioning.ExecuteProvisionAsync(job.Id, request)).ConfigureAwait(true);

            var finished = _host.Jobs.Get(job.Id);
            if (finished?.Status == "success")
            {
                Finished = true;
                Progress = 100;
                ProgressLabel = "ONU configurada y verificada";
                if (finished.Result is not null)
                {
                    Inventory = finished.Result["inventory"] as JsonObject;
                    ReadInventorySummary(finished.Result);
                }
                _toast("ONU configurada y verificada.", "ok");
            }
            else
            {
                Failed = true;
                ProgressLabel = finished?.Error ?? "No se pudo completar";
                _toast(finished?.Error ?? "No se pudo completar la configuracion.", "error");
            }
        }
        catch (Exception exception)
        {
            Failed = true;
            ProgressLabel = exception.Message;
            _toast(exception.Message, "error");
        }
        finally
        {
            IsBusy = false;
            BusyMessage = string.Empty;
        }
    }

    private void ApplyJob(JobState job)
    {
        if (job.Id != _activeJobId) return;

        Progress = job.ProgressPercent;
        ProgressLabel = job.StageLabel;

        for (var index = Timeline.Count; index < job.Events.Count; index++)
        {
            var entry = job.Events[index];
            Timeline.Add(new TimelineEntry
            {
                Time = DateTime.TryParse(entry.At, out var at) ? at.ToLocalTime().ToString("HH:mm:ss") : string.Empty,
                Message = entry.Message,
                Status = entry.Status,
            });
        }
    }

    /// <summary>
    /// Vuelve a llenar el asistente con lo que se intento antes. Las claves nunca se
    /// guardan, asi que el tecnico solo tiene que escribirlas de nuevo si hacen falta.
    /// </summary>
    public bool LoadRetryTemplate(string jobId)
    {
        var template = _host.Store.GetRetryTemplate(jobId);
        if (template is null) return false;

        var request = JsonDefaults.FromJson<ProvisionRequest>(template.Request.ToJsonString());
        if (request is null) return false;

        DeviceHost = request.Device.Host;
        DeviceModel = request.Device.Model;
        DeviceUser = request.Device.Username;
        DevicePassword = string.Empty;
        LocalAddress = request.LocalNetwork.Address;
        PrefixLength = request.LocalNetwork.PrefixLength;

        var adapter = Adapters.FirstOrDefault(item => item.Index == request.LocalNetwork.AdapterIndex);
        if (adapter is not null) SelectedAdapter = adapter;

        Wan.VlanId = request.Wan.VlanId;
        Wan.IpAddress = request.Wan.IpAddress;
        Wan.SubnetMask = request.Wan.SubnetMask;
        Wan.Gateway = request.Wan.Gateway;
        Wan.PrimaryDns = request.Wan.PrimaryDns;
        Wan.SecondaryDns = request.Wan.SecondaryDns;
        Wan.Mtu = request.Wan.Mtu;
        Wan.NatEnabled = request.Wan.NatEnabled;
        Wan.BindSsid1 = request.Wan.BindSsid1;
        Wan.BindLanPorts = new List<int>(request.Wan.BindLanPorts);

        Wifi.Ssid = request.Wifi.Ssid;
        Wifi.Password = string.Empty;
        Wifi.MaxClients = request.Wifi.MaxClients;
        Wifi.Broadcast = request.Wifi.Broadcast;
        Wifi.WmmEnabled = request.Wifi.WmmEnabled;
        Wifi.WpsEnabled = request.Wifi.WpsEnabled;
        Wifi.Enabled = request.Wifi.Enabled;

        RemoteAccess.Enabled = request.RemoteAccess.Enabled;
        RemoteAccess.Source = request.RemoteAccess.Source;
        Tr069Enabled = request.Tr069.Enabled;
        ServiceMode = request.ServiceMode;
        _cloudJobId = request.CloudJobId;

        var operation = Operations.FirstOrDefault(item => item.Key == request.ServiceOperation);
        if (operation is not null) Operation = operation;

        Step = 1;
        DeviceReady = false;
        Finished = false;
        Failed = false;
        Timeline.Clear();
        NotifyWan();
        Notify(nameof(WifiSsid), nameof(WifiPassword), nameof(WifiMaxClients), nameof(WanNat),
            nameof(BindSsid1), nameof(Lan1), nameof(Lan2), nameof(Lan3), nameof(Lan4),
            nameof(RemoteEnabled), nameof(CanGoNext));
        _toast("Se cargaron los datos del intento anterior. Escribe de nuevo las claves y vuelve a leer la ONU.", "info");
        return true;
    }

    private void ResetForNextClient()
    {
        Step = 1;
        Finished = false;
        Failed = false;
        Progress = 0;
        ProgressLabel = "Listo para comenzar";
        Timeline.Clear();
        ClientSearch = string.Empty;
        ClientName = string.Empty;
        SelectedClient = null;
        ClientResults.Clear();
        _cloudJobId = null;
        CloudNote = string.Empty;
        Wifi.Ssid = string.Empty;
        Wifi.Password = string.Empty;
        DeviceReady = false;
        Inventory = null;
        Serial = string.Empty;
        NotifyWan();
        Notify(nameof(WifiSsid), nameof(WifiPassword), nameof(CanGoNext));
        _ = Task.Run(() => _host.Discovery.Scan());
    }

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
