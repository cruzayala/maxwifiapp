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

/// <summary>Paso 2: sesion con ISP Max, cliente, catalogo y reserva de IP.</summary>
public sealed partial class WizardViewModel
{
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
        if (string.IsNullOrWhiteSpace(CloudUsername) || string.IsNullOrEmpty(CloudPassword))
        {
            _toast("Escribe tu usuario y tu clave de ISP Max.", "error");
            return;
        }

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

    private OperationOption? _selectedOperation;
    /// <summary>La opcion marcada en pantalla; vacia hasta que el tecnico elige.</summary>
    public OperationOption? SelectedOperation
    {
        get => _selectedOperation;
        set
        {
            if (!SetProperty(ref _selectedOperation, value)) return;
            if (value is not null)
            {
                Operation = value;
                AdvanceSoon(2, 1);
            }
            NotifyFlow();
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
        AdvanceSoon(2, 3);
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
            NotifyFlow();
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
}
