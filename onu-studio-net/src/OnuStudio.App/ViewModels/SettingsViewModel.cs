using System.Collections.ObjectModel;
using OnuStudio.Core;
using OnuStudio.Core.Models;

namespace OnuStudio.App.ViewModels;

public sealed class RangeRow : ObservableObject
{
    private readonly NetworkRange _range;

    public RangeRow(NetworkRange range) => _range = range;

    public NetworkRange Model => _range;

    public string Name
    {
        get => _range.Name;
        set { _range.Name = value; OnPropertyChanged(); }
    }

    public string Cidr
    {
        get => _range.Cidr;
        set { _range.Cidr = value; OnPropertyChanged(); }
    }

    public int Vlan
    {
        get => _range.Vlan;
        set { _range.Vlan = value; OnPropertyChanged(); }
    }

    public string Gateway
    {
        get => _range.Gateway;
        set { _range.Gateway = value; OnPropertyChanged(); }
    }

    public string PrimaryDns
    {
        get => _range.PrimaryDns;
        set { _range.PrimaryDns = value; OnPropertyChanged(); }
    }

    public string SecondaryDns
    {
        get => _range.SecondaryDns;
        set { _range.SecondaryDns = value?.Trim() ?? string.Empty; OnPropertyChanged(); }
    }

    public string AllocationStart
    {
        get => _range.AllocationStart ?? string.Empty;
        set { _range.AllocationStart = string.IsNullOrWhiteSpace(value) ? null : value; OnPropertyChanged(); }
    }

    public string AllocationEnd
    {
        get => _range.AllocationEnd ?? string.Empty;
        set { _range.AllocationEnd = string.IsNullOrWhiteSpace(value) ? null : value; OnPropertyChanged(); }
    }

    public bool Active
    {
        get => _range.Active;
        set { _range.Active = value; OnPropertyChanged(); }
    }
}

/// <summary>
/// Ajustes del agente: credenciales tecnicas (guardadas cifradas), TR-069,
/// rangos de IP y el arranque con Windows.
/// </summary>
public sealed class SettingsViewModel : ObservableObject
{
    private readonly AgentHost _host;
    private readonly Action<string, string> _toast;
    private AgentSettings _settings;
    private bool _startWithWindows;

    public SettingsViewModel(AgentHost host, Action<string, string> toast)
    {
        _host = host;
        _toast = toast;
        _settings = host.Settings.Clone();

        SaveCommand = new RelayCommand(Save);
        SaveRangesCommand = new RelayCommand(SaveRanges);
        AddRangeCommand = new RelayCommand(AddRange);
        RemoveRangeCommand = new RelayCommand(parameter =>
        {
            if (parameter is RangeRow row) Ranges.Remove(row);
        });
        LogoutCommand = new AsyncCommand(async () =>
        {
            try
            {
                await _host.Session.LogoutAsync().ConfigureAwait(true);
                _toast("ONU Studio se desconecto de ISP Max.", "ok");
            }
            catch (Exception exception)
            {
                _toast(exception.Message, "error");
            }
            Notify(nameof(CloudSummary));
        });

        Reload();
    }

    public RelayCommand SaveCommand { get; }
    public RelayCommand SaveRangesCommand { get; }
    public RelayCommand AddRangeCommand { get; }
    public RelayCommand RemoveRangeCommand { get; }
    public AsyncCommand LogoutCommand { get; }

    public ObservableCollection<RangeRow> Ranges { get; } = new();

    public void Reload()
    {
        _settings = _host.Settings.Clone();
        _startWithWindows = WindowsStartup.Status().Enabled;
        Ranges.Clear();
        foreach (var range in _host.Store.NetworkRanges()) Ranges.Add(new RangeRow(range));
        Notify(nameof(HuaweiUsername), nameof(HuaweiPassword), nameof(ZteUsername), nameof(ZtePassword),
            nameof(Tr069Enabled), nameof(AcsUrl), nameof(Tr069Username), nameof(Tr069Password),
            nameof(ConnectionRequestUsername), nameof(ConnectionRequestPassword), nameof(PeriodicInformInterval),
            nameof(GenieAcsUrl), nameof(DefaultRemoteSource), nameof(Headless), nameof(StartWithWindows),
            nameof(CloudSummary), nameof(StorageSummary));
    }

    // ── Credenciales de la ONU ──

    public string HuaweiUsername
    {
        get => _settings.HuaweiUsername;
        set { _settings.HuaweiUsername = value; OnPropertyChanged(); }
    }

    public string HuaweiPassword
    {
        get => _settings.HuaweiPassword;
        set { _settings.HuaweiPassword = value; OnPropertyChanged(); }
    }

    public string ZteUsername
    {
        get => _settings.ZteUsername;
        set { _settings.ZteUsername = value; OnPropertyChanged(); }
    }

    public string ZtePassword
    {
        get => _settings.ZtePassword;
        set { _settings.ZtePassword = value; OnPropertyChanged(); }
    }

    // ── TR-069 ──

    public bool Tr069Enabled
    {
        get => _settings.Tr069Enabled;
        set { _settings.Tr069Enabled = value; OnPropertyChanged(); }
    }

    public string AcsUrl
    {
        get => _settings.AcsUrl;
        set { _settings.AcsUrl = value; OnPropertyChanged(); }
    }

    public string Tr069Username
    {
        get => _settings.Tr069Username;
        set { _settings.Tr069Username = value; OnPropertyChanged(); }
    }

    public string Tr069Password
    {
        get => _settings.Tr069Password;
        set { _settings.Tr069Password = value; OnPropertyChanged(); }
    }

    public string ConnectionRequestUsername
    {
        get => _settings.ConnectionRequestUsername;
        set { _settings.ConnectionRequestUsername = value; OnPropertyChanged(); }
    }

    public string ConnectionRequestPassword
    {
        get => _settings.ConnectionRequestPassword;
        set { _settings.ConnectionRequestPassword = value; OnPropertyChanged(); }
    }

    public int PeriodicInformInterval
    {
        get => _settings.PeriodicInformInterval;
        set { _settings.PeriodicInformInterval = value; OnPropertyChanged(); }
    }

    public string GenieAcsUrl
    {
        get => _settings.GenieAcsUrl;
        set { _settings.GenieAcsUrl = value; OnPropertyChanged(); }
    }

    public string DefaultRemoteSource
    {
        get => _settings.DefaultRemoteSource;
        set { _settings.DefaultRemoteSource = value; OnPropertyChanged(); }
    }

    public bool Headless
    {
        get => _settings.Headless;
        set { _settings.Headless = value; OnPropertyChanged(); }
    }

    /// <summary>Se consulta al Programador de tareas una sola vez por recarga.</summary>
    public bool StartWithWindows
    {
        get => _startWithWindows;
        set
        {
            if (_startWithWindows == value) return;
            try
            {
                _startWithWindows = WindowsStartup.Set(value).Enabled;
                _toast(value ? "ONU Studio se abrira con Windows." : "ONU Studio ya no se abrira solo.", "ok");
            }
            catch (Exception exception)
            {
                _toast(exception.Message, "error");
            }
            OnPropertyChanged();
        }
    }

    public string CloudSummary
    {
        get
        {
            var session = _host.Session.Current;
            if (!session.Connected && !session.AgentPaired) return "Sin conexion con ISP Max.";
            var user = session.User?.Username ?? "sin usuario";
            return $"{session.BaseUrl} · {user} · credenciales protegidas con Windows DPAPI";
        }
    }

    public string StorageSummary => $"Historial y respaldos en {AppPaths.DataDir}";

    private void Save()
    {
        try
        {
            _host.SaveSettings(_settings.Clone());
            _toast("Ajustes guardados y cifrados en esta computadora.", "ok");
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
    }

    private void AddRange()
    {
        var suffix = Ranges.Count + 1;
        Ranges.Add(new RangeRow(new NetworkRange
        {
            Id = $"rango-{suffix}-{DateTime.Now:HHmmss}",
            Name = $"Rango {suffix}",
            Cidr = "192.168.20.0/24",
            Vlan = 101,
            Gateway = "192.168.20.1",
            PrimaryDns = "8.8.8.8",
            Priority = 100 + suffix,
            AllocationStart = "192.168.20.2",
            AllocationEnd = "192.168.20.254",
            Active = true,
        }));
    }

    private void SaveRanges()
    {
        var ranges = Ranges.Select(row => row.Model).ToList();
        var validation = NetworkRange.ValidateSet(ranges);
        if (!validation.IsValid)
        {
            _toast(validation.Message, "error");
            return;
        }

        try
        {
            _host.Store.ReplaceNetworkRanges(ranges);
            _toast("Rangos de IP guardados.", "ok");
        }
        catch (Exception exception)
        {
            _toast(exception.Message, "error");
        }
    }
}
