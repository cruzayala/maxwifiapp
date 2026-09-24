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

/// <summary>Paso 5: resumen, aprovisionamiento y seguimiento en vivo.</summary>
public sealed partial class WizardViewModel
{
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

        MarkProvisionStarted(true);
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
        _confirmedModel = null;
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
        SelectedServiceMode = ServiceModes.FirstOrDefault(item => item.Key == request.ServiceMode);
        _cloudJobId = request.CloudJobId;
        MarkProvisionStarted(false);

        var operation = Operations.FirstOrDefault(item => item.Key == request.ServiceOperation);
        if (operation is not null) SelectedOperation = operation;

        SubStep = 1;
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
        SlideFrom = -56;
        SubStep = 1;
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
        SelectedOperation = null;
        Operation = new OperationOption("new_client", "Cliente nuevo", string.Empty);
        SelectedServiceMode = null;
        SelectedZone = null;
        SelectedPlan = null;
        MarkProvisionStarted(false);
        Wifi.Ssid = string.Empty;
        Wifi.Password = string.Empty;
        DeviceReady = false;
        _confirmedModel = null;
        Inventory = null;
        Serial = string.Empty;
        NotifyWan();
        Notify(nameof(WifiSsid), nameof(WifiPassword), nameof(CanGoNext));
        _ = Task.Run(() => _host.Discovery.Scan());
    }
}
