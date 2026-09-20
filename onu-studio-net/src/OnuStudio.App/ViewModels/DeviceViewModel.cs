using System.Collections.ObjectModel;
using System.Text.Json.Nodes;
using OnuStudio.Core;

namespace OnuStudio.App.ViewModels;

public sealed class InfoRow
{
    public InfoRow(string label, string? value)
    {
        Label = label;
        Value = string.IsNullOrWhiteSpace(value) ? "—" : value!;
    }

    public string Label { get; }
    public string Value { get; }
}

public sealed class InfoGroup
{
    public InfoGroup(string title, IEnumerable<InfoRow> rows)
    {
        Title = title;
        Rows = new ObservableCollection<InfoRow>(rows.Where(row => row.Value != "—" || row.Label.Length > 0));
    }

    public string Title { get; }
    public ObservableCollection<InfoRow> Rows { get; }
    public bool HasRows => Rows.Count > 0;
}

/// <summary>
/// Muestra lo que la ONU reporta, ordenado como lo lee un tecnico: identidad,
/// equipo, senal optica, internet, puertos y WiFi. Nunca muestra claves.
/// </summary>
public sealed class DeviceViewModel : ObservableObject
{
    public DeviceViewModel(AgentHost host, WizardViewModel wizard)
    {
        wizard.InventoryChanged += Load;
        Load(wizard.Inventory);
    }

    public ObservableCollection<InfoGroup> Groups { get; } = new();

    private bool _hasData;
    public bool HasData
    {
        get => _hasData;
        private set => SetProperty(ref _hasData, value);
    }

    private string _collectedAt = string.Empty;
    public string CollectedAt
    {
        get => _collectedAt;
        private set => SetProperty(ref _collectedAt, value);
    }

    public void Load(JsonObject? inventory)
    {
        Groups.Clear();
        HasData = inventory is not null;
        if (inventory is null)
        {
            CollectedAt = string.Empty;
            return;
        }

        CollectedAt = DateTime.TryParse(inventory["collected_at"]?.ToString(), out var at)
            ? $"Leido el {at.ToLocalTime():dd/MM/yyyy HH:mm}"
            : string.Empty;

        var identity = inventory["identity"] as JsonObject;
        var device = inventory["device"] as JsonObject;
        var optical = inventory["optical"] as JsonObject;
        var ethernet = inventory["ethernet"] as JsonObject;
        var wifi = inventory["wifi"] as JsonObject;

        Groups.Add(new InfoGroup("Identidad", new[]
        {
            new InfoRow("Serial GPON", identity?["serial"]?.ToString()),
            new InfoRow("Serial del fabricante", identity?["serial_raw"]?.ToString()),
            new InfoRow("Autenticacion", identity?["authentication_mode"]?.ToString() == "loid" ? "LOID" : "Serial y clave"),
        }));

        Groups.Add(new InfoGroup("Equipo", new[]
        {
            new InfoRow("Modelo", device?["model"]?.ToString()),
            new InfoRow("Firmware", device?["software_version"]?.ToString()),
            new InfoRow("Hardware", device?["hardware_version"]?.ToString()),
            new InfoRow("MAC", device?["mac"]?.ToString()),
            new InfoRow("Estado en la OLT", device?["registration_status"]?.ToString()),
            new InfoRow("Encendida desde", device?["runtime"]?.ToString()),
            new InfoRow("CPU", device?["cpu_usage"]?.ToString()),
            new InfoRow("Memoria", device?["memory_usage"]?.ToString()),
        }));

        Groups.Add(new InfoGroup("Senal optica", new[]
        {
            new InfoRow("Potencia recibida", Signal(optical?["rx_power_dbm"]?.ToString(), "dBm")),
            new InfoRow("Potencia enviada", Signal(optical?["tx_power_dbm"]?.ToString(), "dBm")),
            new InfoRow("Temperatura", Signal(optical?["temperature_c"]?.ToString(), "°C")),
            new InfoRow("Voltaje", Signal(optical?["voltage_mv"]?.ToString(), "mV")),
            new InfoRow("Corriente", Signal(optical?["bias_ma"]?.ToString(), "mA")),
            new InfoRow("Perdida de senal (LOS)", optical?["los"]?.GetValue<bool>() == true ? "Si" : "No"),
        }));

        if (inventory["wan"] is JsonArray wans && wans.Count > 0)
        {
            var rows = new List<InfoRow>();
            foreach (var node in wans)
            {
                if (node is not JsonObject wan) continue;
                var name = wan["name"]?.ToString() ?? "Conexion";
                var ip = wan["ip_address"]?.ToString() ?? wan["address"]?.ToString();
                var status = wan["status"]?.ToString();
                var vlan = wan["vlan_id"]?.ToString();
                var detail = string.Join(" · ", new[] { ip, vlan is null ? null : $"VLAN {vlan}", status }
                    .Where(value => !string.IsNullOrWhiteSpace(value)));
                rows.Add(new InfoRow(name, detail));
            }
            Groups.Add(new InfoGroup("Internet", rows));
        }

        if (ethernet?["ports"] is JsonArray ports && ports.Count > 0)
        {
            var rows = new List<InfoRow>();
            foreach (var node in ports)
            {
                if (node is not JsonObject port) continue;
                var label = port["port"]?.ToString() ?? "LAN";
                var link = port["link"]?.ToString() ?? port["status"]?.ToString();
                var speed = port["speed"]?.ToString();
                rows.Add(new InfoRow(label.StartsWith("LAN", StringComparison.OrdinalIgnoreCase) ? label : $"LAN{label}",
                    string.Join(" · ", new[] { link, speed }.Where(value => !string.IsNullOrWhiteSpace(value)))));
            }
            Groups.Add(new InfoGroup("Puertos LAN", rows));
        }

        if (wifi?["radios"] is JsonArray radios && radios.Count > 0)
        {
            var rows = new List<InfoRow>();
            foreach (var node in radios)
            {
                if (node is not JsonObject radio) continue;
                var band = radio["band"]?.ToString() ?? $"Radio {radio["index"]}";
                var ssid = radio["ssid"]?.ToString();
                var enabled = radio["enabled"]?.GetValue<bool>() == true ? "encendida" : "apagada";
                var channel = radio["channel"]?.ToString();
                rows.Add(new InfoRow(band, string.Join(" · ", new[] { ssid, enabled, channel is null ? null : $"canal {channel}" }
                    .Where(value => !string.IsNullOrWhiteSpace(value)))));
            }
            Groups.Add(new InfoGroup("WiFi", rows));
        }

        if (inventory["errors"] is JsonObject errors && errors.Count > 0)
        {
            var rows = errors.Select(pair => new InfoRow(Translate(pair.Key), pair.Value?.ToString())).ToList();
            Groups.Add(new InfoGroup("No se pudo leer", rows));
        }

        static string? Signal(string? value, string unit) =>
            string.IsNullOrWhiteSpace(value) ? null : $"{value} {unit}";

        static string Translate(string key) => key switch
        {
            "device" => "Datos del equipo",
            "optical" => "Senal optica",
            "wan" => "Internet",
            "ethernet" => "Puertos LAN",
            "wifi" => "WiFi",
            "remote_access" => "Acceso remoto",
            _ => key,
        };
    }
}
