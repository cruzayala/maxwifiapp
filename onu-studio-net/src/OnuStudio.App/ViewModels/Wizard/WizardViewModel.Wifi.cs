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

/// <summary>Paso 4: red WiFi del cliente.</summary>
public sealed partial class WizardViewModel
{
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
}
