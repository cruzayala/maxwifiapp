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

/// <summary>Paso 3: modo de servicio, WAN, TR-069 y acceso remoto.</summary>
public sealed partial class WizardViewModel
{
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
}
