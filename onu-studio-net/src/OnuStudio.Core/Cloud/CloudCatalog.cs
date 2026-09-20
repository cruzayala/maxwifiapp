using System.Text.Json.Nodes;
using OnuStudio.Core.Models;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Cloud;

public sealed class CloudClientSummary
{
    public int IdServicio { get; set; }
    public string Nombre { get; set; } = string.Empty;
    public string? Usuario { get; set; }
    public string? Telefono { get; set; }
    public string? Ip { get; set; }
    public string? SnOnu { get; set; }
    public string? Estado { get; set; }
    public int? PlanInternetId { get; set; }
    public string? PlanInternetName { get; set; }
    public int? ZonaId { get; set; }
    public string? ZonaNombre { get; set; }
    public double? UploadMbps { get; set; }
    public double? DownloadMbps { get; set; }

    public string Display => string.IsNullOrWhiteSpace(Usuario) ? Nombre : $"{Nombre} · {Usuario}";
    public string Detail
    {
        get
        {
            var parts = new List<string>();
            if (!string.IsNullOrWhiteSpace(PlanInternetName)) parts.Add(PlanInternetName!);
            if (!string.IsNullOrWhiteSpace(Ip)) parts.Add(Ip!);
            if (!string.IsNullOrWhiteSpace(ZonaNombre)) parts.Add(ZonaNombre!);
            if (!string.IsNullOrWhiteSpace(Estado)) parts.Add(Estado!);
            return string.Join(" · ", parts);
        }
    }
}

public sealed class CloudIpRow
{
    public string Ip { get; set; } = string.Empty;
    public string Cidr { get; set; } = string.Empty;
    public string? Status { get; set; }
    public string? UsedBy { get; set; }
    public string RangeName { get; set; } = string.Empty;
    public int RangePriority { get; set; }
    public bool Recommended { get; set; }

    public bool IsFree => string.Equals(Status, "free", StringComparison.OrdinalIgnoreCase);
}

public sealed class CloudCatalogResult
{
    public List<CloudIpRow> Rows { get; set; } = new();
    public CloudIpRow? Recommended { get; set; }
    public List<JsonObject> Networks { get; set; } = new();
    public string? Timestamp { get; set; }
    public bool Stale { get; set; }
}

/// <summary>
/// Puente con los catalogos de ISP Max que usa el asistente: clientes, planes,
/// zonas e IP libres, mas la reserva y el expediente del trabajo.
/// </summary>
public sealed class CloudCatalog
{
    private readonly CloudSessionManager _session;
    private readonly JobStore _store;

    public CloudCatalog(CloudSessionManager session, JobStore store)
    {
        _session = session;
        _store = store;
    }

    public async Task<List<CloudClientSummary>> SearchClientsAsync(string query, CancellationToken cancellationToken = default)
    {
        if (query.Trim().Length < 2) return new List<CloudClientSummary>();
        var node = await _session.Client.SendAsync(
            $"/provisioning/clients?q={Uri.EscapeDataString(query.Trim())}", cancellationToken: cancellationToken).ConfigureAwait(false);

        var clients = new List<CloudClientSummary>();
        foreach (var row in node as JsonArray ?? new JsonArray())
        {
            if (row is not JsonObject item) continue;
            clients.Add(new CloudClientSummary
            {
                IdServicio = item["idServicio"]?.GetValue<int>() ?? 0,
                Nombre = item["nombre"]?.ToString() ?? string.Empty,
                Usuario = item["usuario"]?.ToString(),
                Telefono = item["telefono"]?.ToString(),
                Ip = item["ip"]?.ToString(),
                SnOnu = item["snOnu"]?.ToString(),
                Estado = item["estado"]?.ToString(),
                PlanInternetId = ReadInt(item["planInternetId"]),
                PlanInternetName = item["planInternetName"]?.ToString(),
                ZonaId = ReadInt(item["zonaId"]),
                ZonaNombre = item["zonaNombre"]?.ToString(),
                UploadMbps = ReadDouble(item["uploadMbps"]),
                DownloadMbps = ReadDouble(item["downloadMbps"]),
            });
        }
        return clients;
    }

    /// <summary>Lee numeros del JSON sin romperse cuando vienen como texto o nulos.</summary>
    internal static int? ReadInt(JsonNode? node) =>
        node is null ? null : int.TryParse(node.ToString(), out var value) ? value : null;

    internal static double? ReadDouble(JsonNode? node) =>
        node is null ? null
            : double.TryParse(node.ToString(), System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var value) ? value : null;

    public Task<JsonObject> CommercialCatalogAsync(CancellationToken cancellationToken = default) =>
        _session.Client.SendObjectAsync("/provisioning/commercial-catalog", cancellationToken: cancellationToken);

    /// <summary>
    /// IP libres de los rangos configurados en esta PC. Se filtran por los limites
    /// del rango para que nunca se ofrezca una direccion reservada o de gateway.
    /// </summary>
    public async Task<CloudCatalogResult> IpCatalogAsync(string? cidr = null, CancellationToken cancellationToken = default)
    {
        var configured = _store.NetworkRanges().Where(range => range.Active).ToList();
        if (!string.IsNullOrWhiteSpace(cidr)) configured = configured.Where(range => range.Cidr == cidr).ToList();
        if (configured.Count == 0) return new CloudCatalogResult();

        var response = await _session.Client.SendObjectAsync("/provisioning/ip-catalog/query", HttpMethod.Post,
            new { cidrs = configured.Select(range => range.Cidr).ToArray() }, cancellationToken: cancellationToken).ConfigureAwait(false);

        var policies = configured.ToDictionary(range => range.Cidr, range => range);
        var rows = new List<CloudIpRow>();

        foreach (var node in response["rows"] as JsonArray ?? new JsonArray())
        {
            if (node is not JsonObject row) continue;
            var rowCidr = row["cidr"]?.ToString() ?? string.Empty;
            if (!policies.TryGetValue(rowCidr, out var policy)) continue;

            var ip = row["ip"]?.ToString() ?? string.Empty;
            if (!Ipv4.TryParse(ip, out var address)) continue;

            if (!string.IsNullOrWhiteSpace(policy.AllocationStart) && Ipv4.TryParse(policy.AllocationStart, out var start)
                && Ipv4.ToUInt32(address) < Ipv4.ToUInt32(start)) continue;
            if (!string.IsNullOrWhiteSpace(policy.AllocationEnd) && Ipv4.TryParse(policy.AllocationEnd, out var end)
                && Ipv4.ToUInt32(address) > Ipv4.ToUInt32(end)) continue;
            if (policy.Exclusions.Contains(ip) || ip == policy.Gateway) continue;

            rows.Add(new CloudIpRow
            {
                Ip = ip,
                Cidr = rowCidr,
                Status = row["status"]?.ToString(),
                UsedBy = row["usedBy"]?.ToString() ?? row["clientName"]?.ToString(),
                RangeName = policy.Name,
                RangePriority = policy.Priority,
            });
        }

        rows = rows
            .OrderBy(row => row.RangePriority)
            .ThenBy(row => Ipv4.ToUInt32(Ipv4.Parse(row.Ip)))
            .ToList();
        if (rows.Count > 0) rows[0].Recommended = true;

        var networks = new List<JsonObject>();
        foreach (var node in response["networks"] as JsonArray ?? new JsonArray())
        {
            if (node is not JsonObject network) continue;
            var networkCidr = network["cidr"]?.ToString() ?? string.Empty;
            if (!policies.TryGetValue(networkCidr, out var policy)) continue;
            var copy = network.DeepClone().AsObject();
            copy["name"] = policy.Name;
            copy["available"] = rows.Count(row => row.Cidr == networkCidr);
            networks.Add(copy);
        }

        return new CloudCatalogResult
        {
            Rows = rows,
            Recommended = rows.FirstOrDefault(),
            Networks = networks,
            Timestamp = response["timestamp"]?.ToString(),
            Stale = response["stale"]?.GetValue<bool>() ?? false,
        };
    }

    public Task<JsonObject> ReserveIpAsync(string ip, string? clientName, string? serial, CancellationToken cancellationToken = default)
    {
        var cidrs = _store.NetworkRanges().Where(range => range.Active).Select(range => range.Cidr).ToArray();
        return _session.Client.SendObjectAsync("/provisioning/reservations", HttpMethod.Post,
            new { ip, clientName, serial, cidrs }, cancellationToken: cancellationToken);
    }

    public sealed class JobRequest
    {
        public string Mode { get; set; } = "new_client";
        public string ServiceMode { get; set; } = "router";
        public string? ReservationToken { get; set; }
        public int? ClientId { get; set; }
        public string? Ip { get; set; }
        public string? ClientName { get; set; }
        public string? Serial { get; set; }
        public string? Model { get; set; }
        public string? MacAddress { get; set; }
        public int? ZoneId { get; set; }
        public int? PlanId { get; set; }
        public double? UploadMbps { get; set; }
        public double? DownloadMbps { get; set; }
        public int Vlan { get; set; } = 101;
        public JsonObject? Inventory { get; set; }
        public string Host { get; set; } = "192.168.100.1";
        public string? TargetPonIndex { get; set; }
        public string? OperationReason { get; set; }
        public JsonObject? ConfigurationManifest { get; set; }
    }

    /// <summary>Abre el expediente en ISP Max antes de tocar la ONU.</summary>
    public async Task<JsonObject> CreateJobAsync(JobRequest request, CancellationToken cancellationToken = default)
    {
        if (request.Mode == "new_client" && request.ServiceMode == "router" && string.IsNullOrWhiteSpace(request.ReservationToken))
            throw new CloudException(400, "El cliente nuevo requiere una reserva de IP");

        var operationKey = request.ReservationToken
            ?? (request.ClientId?.ToString() ?? $"{request.ServiceMode}-pending");
        if (request.Mode == "migrate_pon")
            operationKey = $"{operationKey}:{request.TargetPonIndex ?? "missing-pon"}";

        var job = await _session.Client.SendObjectAsync("/provisioning/jobs", HttpMethod.Post, new
        {
            source = "onu_studio",
            mode = request.Mode,
            serviceMode = request.ServiceMode,
            idempotencyKey = $"onu-studio:{request.Mode}:{operationKey}:{request.Serial ?? "pending"}",
            reservationToken = request.ReservationToken,
            clientIdServicio = request.ClientId,
            ip = request.Ip,
            clientName = request.ClientName,
            serial = request.Serial,
            model = request.Model,
            macAddress = request.MacAddress,
            zoneId = request.ZoneId,
            planId = request.PlanId,
            uploadMbps = request.UploadMbps,
            downloadMbps = request.DownloadMbps,
            vlan = request.Vlan,
            targetPonIndex = request.TargetPonIndex,
            operationReason = request.OperationReason,
            configurationManifest = request.ConfigurationManifest,
        }, cancellationToken: cancellationToken).ConfigureAwait(false);

        var jobId = job["id"]?.ToString();
        if (request.Inventory is not null && !string.IsNullOrWhiteSpace(jobId))
        {
            try
            {
                await _session.Client.SendAsync($"/provisioning/jobs/{jobId}/onu-inventory", HttpMethod.Post, new
                {
                    phase = "pre_provision",
                    agentVersion = AppInfo.Version,
                    host = request.Host,
                    inventory = request.Inventory,
                }, cancellationToken: cancellationToken).ConfigureAwait(false);
                job["agentInventoryAvailable"] = true;
            }
            catch (CloudException exception)
            {
                job["agentInventoryWarning"] = exception.Message;
            }
        }
        return job;
    }

    /// <summary>Crea al cliente en WispHub y prepara MikroTik antes de configurar la ONU.</summary>
    public Task<JsonObject> ProvisionClientAsync(
        string jobId, string ip, string serviceName, int zoneId, int planId,
        double uploadMbps, double downloadMbps, CancellationToken cancellationToken = default) =>
        _session.Client.SendObjectAsync("/client-provisioning", HttpMethod.Post, new
        {
            jobId, ip, serviceName, zoneId, planId, uploadMbps, downloadMbps,
        }, cancellationToken: cancellationToken);

    public Task<JsonObject> JobAsync(string jobId, CancellationToken cancellationToken = default) =>
        _session.Client.SendObjectAsync($"/provisioning/jobs/{jobId}", cancellationToken: cancellationToken);
}
