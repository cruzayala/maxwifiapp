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

/// <summary>Paso 1: encontrar la ONU, preparar la red y leer su inventario.</summary>
public sealed partial class WizardViewModel
{
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

    // Modelo confirmado al leer la ONU. La deteccion automatica corre cada pocos segundos
    // y, para los Huawei que no dicen el modelo antes de entrar, solo lo adivina: no
    // puede pisar el que ya confirmo la lectura.
    private string? _confirmedModel;

    public IReadOnlyList<string> Models { get; } = OnuModels.Names;

    public string ModelLabel => OnuModels.Label(DeviceModel);

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

    /// <summary>
    /// Modelo tras una deteccion automatica: la sugerencia solo aplica si la lectura
    /// aun no confirmo el modelo, o si la ONU anuncia otro modelo (es otro equipo).
    /// </summary>
    public static (string Model, string? Confirmed) ModelAfterDiscovery(
        string current, string? confirmed, string? announced, string? suggested)
    {
        if (confirmed is not null && announced is not null && announced != confirmed) confirmed = null;
        return (confirmed is null && suggested is not null ? suggested : current, confirmed);
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
            (DeviceModel, _confirmedModel) = ModelAfterDiscovery(
                DeviceModel, _confirmedModel, OnuModels.Canonical(device.Model), device.SuggestedModel);
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
            // Si se desconecta el cable puede llegar otra ONU: hay que volver a leerla.
            if (state.Status == "cable_disconnected") _confirmedModel = null;
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
                // El panel dice el modelo real al entrar: si es otro Huawei compatible, se usa ese.
                if (OnuModels.Canonical(finished.Result["model"]?.ToString()) is { } detected && detected != DeviceModel)
                {
                    DeviceModel = detected;
                    _toast($"Modelo detectado en el equipo: {OnuModels.Label(detected)}.", "info");
                }
                _confirmedModel = DeviceModel;
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
}
