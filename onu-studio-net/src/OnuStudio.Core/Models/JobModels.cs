using System.Text.Json.Nodes;

namespace OnuStudio.Core.Models;

public sealed class JobEvent
{
    public string At { get; set; } = string.Empty;
    public string Step { get; set; } = string.Empty;
    /// <summary>pending, running, success, warning o error.</summary>
    public string Status { get; set; } = "pending";
    public string Message { get; set; } = string.Empty;
}

public sealed class JobState
{
    public string Id { get; set; } = string.Empty;
    /// <summary>check o provision.</summary>
    public string Kind { get; set; } = "check";
    /// <summary>queued, running, success o error.</summary>
    public string Status { get; set; } = "queued";
    public string CreatedAt { get; set; } = string.Empty;
    public string? StartedAt { get; set; }
    public string? FinishedAt { get; set; }
    public List<JobEvent> Events { get; set; } = new();
    public JsonObject? Result { get; set; }
    public string? Error { get; set; }
    public string Stage { get; set; } = "queued";
    public string StageLabel { get; set; } = "Trabajo en cola";
    public int ProgressPercent { get; set; }
    public string? HeartbeatAt { get; set; }
    public string? LastCompletedStep { get; set; }
    public bool Retryable { get; set; } = true;

    // Datos de contexto que se guardan junto al trabajo para el historial.
    public string DeviceHost { get; set; } = string.Empty;
    public string? WanIp { get; set; }
    public string? Ssid { get; set; }

    public JobState Snapshot() => new()
    {
        Id = Id, Kind = Kind, Status = Status, CreatedAt = CreatedAt, StartedAt = StartedAt,
        FinishedAt = FinishedAt, Events = Events.Select(item => new JobEvent
        {
            At = item.At, Step = item.Step, Status = item.Status, Message = item.Message,
        }).ToList(),
        Result = Result?.DeepClone()?.AsObject(), Error = Error, Stage = Stage, StageLabel = StageLabel,
        ProgressPercent = ProgressPercent, HeartbeatAt = HeartbeatAt, LastCompletedStep = LastCompletedStep,
        Retryable = Retryable, DeviceHost = DeviceHost, WanIp = WanIp, Ssid = Ssid,
    };
}

public sealed class NetworkRange
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Cidr { get; set; } = string.Empty;
    public int Vlan { get; set; } = 101;
    public string Gateway { get; set; } = string.Empty;
    public string PrimaryDns { get; set; } = "8.8.8.8";
    public string SecondaryDns { get; set; } = string.Empty;
    public int Priority { get; set; } = 100;
    public string? AllocationStart { get; set; }
    public string? AllocationEnd { get; set; }
    public List<string> Exclusions { get; set; } = new();
    public bool Active { get; set; } = true;

    public NetworkRange Clone() => new()
    {
        Id = Id, Name = Name, Cidr = Cidr, Vlan = Vlan, Gateway = Gateway, PrimaryDns = PrimaryDns,
        SecondaryDns = SecondaryDns, Priority = Priority, AllocationStart = AllocationStart,
        AllocationEnd = AllocationEnd, Exclusions = new List<string>(Exclusions), Active = Active,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Require(!string.IsNullOrWhiteSpace(Id), "Cada rango necesita un identificador");
        result.Require(!string.IsNullOrWhiteSpace(Name), "Cada rango necesita un nombre");
        result.Require(Vlan is >= 1 and <= 4094, "La VLAN del rango debe estar entre 1 y 4094");
        result.Require(Priority is >= 1 and <= 9999, "La prioridad del rango debe estar entre 1 y 9999");

        int prefix;
        System.Net.IPAddress network;
        try
        {
            (network, prefix) = Ipv4.ParseCidr(Cidr);
            Cidr = $"{network}/{prefix}";
        }
        catch (FormatException)
        {
            result.Add($"El rango {Cidr} no es valido");
            return result;
        }
        result.Require(prefix is >= 16 and <= 30, "El rango debe estar entre /16 y /30");

        foreach (var (label, value) in new[] { ("La puerta de enlace", Gateway), ("El inicio", AllocationStart), ("El fin", AllocationEnd) })
        {
            if (string.IsNullOrWhiteSpace(value)) continue;
            if (!Ipv4.TryParse(value, out var address) || !Ipv4.SameNetwork(network, address, prefix))
                result.Add($"{label} debe pertenecer al rango {Cidr}");
        }
        if (!string.IsNullOrWhiteSpace(AllocationStart) && !string.IsNullOrWhiteSpace(AllocationEnd) &&
            Ipv4.TryParse(AllocationStart, out var start) && Ipv4.TryParse(AllocationEnd, out var end) &&
            Ipv4.ToUInt32(start) > Ipv4.ToUInt32(end))
            result.Add("El inicio no puede ser mayor que el final");

        foreach (var exclusion in Exclusions)
        {
            if (!Ipv4.TryParse(exclusion, out var address) || !Ipv4.SameNetwork(network, address, prefix))
                result.Add($"La exclusion {exclusion} no pertenece al rango {Cidr}");
        }
        if (!Ipv4.TryParse(PrimaryDns, out _)) result.Add("El DNS principal del rango no es valido");
        if (!string.IsNullOrWhiteSpace(SecondaryDns) && !Ipv4.TryParse(SecondaryDns, out _))
            result.Add("El DNS secundario del rango no es valido");
        return result;
    }

    public static ValidationResult ValidateSet(IReadOnlyList<NetworkRange> ranges)
    {
        var result = new ValidationResult();
        result.Require(ranges.Count is >= 1 and <= 16, "Debe haber entre 1 y 16 rangos");
        foreach (var range in ranges) result.Merge(range.Validate());
        if (!result.IsValid) return result;

        var capacity = ranges.Where(range => range.Active)
            .Sum(range => Ipv4.UsableAddresses(Ipv4.ParseCidr(range.Cidr).Prefix));
        result.Require(capacity <= 65_536, "Los rangos activos superan 65,536 direcciones");
        result.Require(ranges.Select(range => range.Cidr).Distinct().Count() == ranges.Count,
            "No se permiten rangos duplicados");
        return result;
    }
}
