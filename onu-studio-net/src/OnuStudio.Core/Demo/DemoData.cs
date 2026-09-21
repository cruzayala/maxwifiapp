using System.Text.Json.Nodes;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Demo;

/// <summary>Datos de ejemplo del modo de prueba: una ONU, clientes, planes e IP libres.</summary>
public static class DemoData
{
    public const int AdapterIndex = 9001;
    public const string Serial = "HWTC9EC8CEAF";

    public static NetworkAdapter Adapter() => new()
    {
        Name = "Ethernet (modo de prueba)",
        Description = "Tarjeta simulada",
        Index = AdapterIndex,
        Status = "Up",
        LinkSpeed = "1 Gbps",
        Mac = "00155D0A0B0C",
        Addresses = new List<string> { "192.168.100.10" },
        Ipv6Addresses = new List<string> { "fe80::215:5dff:fe0a:b0c" },
        Supported = true,
    };

    public static DiscoveryState Discovery()
    {
        var device = new DiscoveredDevice
        {
            Host = "192.168.100.1",
            Reachable = true,
            LatencyMs = 3,
            AdapterIndex = AdapterIndex,
            AdapterName = "Ethernet (modo de prueba)",
            HttpStatus = 200,
            Vendor = "Huawei / Novatech",
            Model = "EG8141A5",
            Title = "EG8141A5",
            Fingerprint = "huawei-webui",
        };
        return new DiscoveryState
        {
            Status = "detected",
            Detected = true,
            Device = device,
            Candidates = new List<DiscoveredDevice> { device },
            WiredAdapters = new List<NetworkAdapter> { Adapter() },
            LastScanAt = Clock.UtcNow(),
            NextAction = "La ONU esta lista para comprobar credenciales o aprovisionar.",
        };
    }

    public static JsonObject Inventory(string? ssid = null, string? wanIp = null) => new()
    {
        ["collected_at"] = Clock.UtcNow(),
        ["source"] = "onu_local_read_only",
        ["identity"] = new JsonObject
        {
            ["serial"] = Serial,
            ["serial_raw"] = "485754439EC8CEAF",
            ["authentication_mode"] = "sn_password",
        },
        ["device"] = new JsonObject
        {
            ["model"] = "EG8141A5",
            ["description"] = "EchoLife EG8141A5 GPON Terminal",
            ["hardware_version"] = "39E7.A",
            ["software_version"] = "V5R019C10S125",
            ["mac"] = "48:57:54:9E:C8:CE",
            ["registration_status"] = "O5 (en servicio)",
            ["ont_id"] = "12",
            ["cpu_usage"] = "9%",
            ["memory_usage"] = "41%",
            ["runtime"] = "3 dias 4 horas",
        },
        ["optical"] = new JsonObject
        {
            ["rx_power_dbm"] = "-19.42",
            ["tx_power_dbm"] = "2.31",
            ["voltage_mv"] = "3290",
            ["bias_ma"] = "11",
            ["temperature_c"] = "47",
            ["los"] = false,
            ["signal_available"] = true,
        },
        ["wan"] = new JsonArray
        {
            new JsonObject
            {
                ["name"] = "1_TR069_INTERNET_R_VID_101",
                ["status"] = "Connected",
                ["vlan_id"] = "101",
                ["ip_address"] = wanIp ?? "192.168.16.37",
            },
        },
        ["ethernet"] = new JsonObject
        {
            ["mac"] = "48:57:54:9E:C8:CF",
            ["ports"] = new JsonArray
            {
                new JsonObject { ["port"] = 1, ["link"] = "Conectado", ["speed"] = "1000 Mbps" },
                new JsonObject { ["port"] = 2, ["link"] = "Sin cable", ["speed"] = "—" },
                new JsonObject { ["port"] = 3, ["link"] = "Sin cable", ["speed"] = "—" },
                new JsonObject { ["port"] = 4, ["link"] = "Sin cable", ["speed"] = "—" },
            },
        },
        ["wifi"] = new JsonObject
        {
            ["radios"] = new JsonArray
            {
                new JsonObject { ["index"] = 1, ["band"] = "2.4 GHz", ["ssid"] = ssid ?? "HUAWEI-C8CE", ["enabled"] = true, ["channel"] = "6" },
            },
            ["clients"] = new JsonArray(),
        },
        ["remote_access"] = new JsonObject { ["rules"] = new JsonArray() },
        ["errors"] = new JsonObject(),
    };

    public static List<CloudClientSummary> Clients() => new()
    {
        new() { IdServicio = 1201, Nombre = "Maria Rodriguez", Usuario = "maria.rodriguez", Telefono = "8095551234", Ip = "192.168.16.45", Estado = "Activo", PlanInternetId = 3, PlanInternetName = "10 Mbps Fibra", ZonaId = 1, ZonaNombre = "Centro", UploadMbps = 10, DownloadMbps = 10 },
        new() { IdServicio = 1202, Nombre = "Jose Perez", Usuario = "jose.perez", Telefono = "8295554321", Ip = "192.168.16.52", Estado = "Activo", PlanInternetId = 2, PlanInternetName = "5 Mbps Fibra", ZonaId = 2, ZonaNombre = "Los Rios", UploadMbps = 5, DownloadMbps = 5 },
        new() { IdServicio = 1203, Nombre = "Colmado La Esquina", Usuario = "colmado.esquina", Telefono = "8495550000", Ip = "192.168.16.61", Estado = "Suspendido", PlanInternetId = 4, PlanInternetName = "20 Mbps Negocio", ZonaId = 1, ZonaNombre = "Centro", UploadMbps = 20, DownloadMbps = 20 },
    };

    public static JsonObject CommercialCatalog() => new()
    {
        ["zones"] = new JsonArray
        {
            new JsonObject { ["id"] = 1, ["nombre"] = "Centro" },
            new JsonObject { ["id"] = 2, ["nombre"] = "Los Rios" },
            new JsonObject { ["id"] = 3, ["nombre"] = "Villa Mella" },
        },
        ["plans"] = new JsonArray
        {
            new JsonObject { ["id"] = 2, ["nombre"] = "5M | 5M Fibra" },
            new JsonObject { ["id"] = 3, ["nombre"] = "10M | 10M Fibra" },
            new JsonObject { ["id"] = 4, ["nombre"] = "20M | 20M Negocio" },
        },
    };

    public static CloudUser User() => new() { UserId = 1, Username = "tecnico.demo", Role = "super_admin" };

    /// <summary>Identificador con el mismo formato que los expedientes reales.</summary>
    public static string NewJobId() => Guid.NewGuid().ToString();

    public static CloudCatalogResult IpCatalog()
    {
        var rows = new[] { 38, 39, 41, 44, 47, 50, 53, 58, 62, 70, 74, 81 }
            .Select((last, position) => new CloudIpRow
            {
                Ip = $"192.168.16.{last}",
                Cidr = "192.168.16.0/24",
                Status = "free",
                RangeName = "Clientes fibra",
                RangePriority = 10,
                Recommended = position == 0,
            })
            .ToList();
        return new CloudCatalogResult { Rows = rows, Recommended = rows[0], Timestamp = Clock.UtcNow() };
    }
}
