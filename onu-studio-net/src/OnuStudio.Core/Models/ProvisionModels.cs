using System.Text.RegularExpressions;

namespace OnuStudio.Core.Models;

/// <summary>Errores de validacion, en el idioma del operador.</summary>
public sealed class ValidationResult
{
    private readonly List<string> _errors = new();

    public IReadOnlyList<string> Errors => _errors;
    public bool IsValid => _errors.Count == 0;
    public string Message => string.Join(" ", _errors);

    public void Add(string error)
    {
        if (!string.IsNullOrWhiteSpace(error) && !_errors.Contains(error)) _errors.Add(error);
    }

    public void Require(bool condition, string error)
    {
        if (!condition) Add(error);
    }

    public void Merge(ValidationResult other)
    {
        foreach (var error in other.Errors) Add(error);
    }

    public void ThrowIfInvalid()
    {
        if (!IsValid) throw new ArgumentException(Message);
    }
}

public sealed class DeviceSettings
{
    public string Host { get; set; } = "192.168.100.1";
    /// <summary>Un modelo de <see cref="Onu.OnuModels"/>: EG8141A5, HS8545M5 (Huawei) o F670L (ZTE).</summary>
    public string Model { get; set; } = "EG8141A5";
    public string Username { get; set; } = "telecomadmin";
    public string? Password { get; set; }

    public DeviceSettings Clone() => new() { Host = Host, Model = Model, Username = Username, Password = Password };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Require(!string.IsNullOrWhiteSpace(Host), "Indica la IP de gestion de la ONU");
        result.Require(Onu.OnuModels.IsSupported(Model), $"Modelo no compatible: {Model}");
        if (Onu.OnuModels.Canonical(Model) is { } canonical) Model = canonical;
        var user = (Username ?? string.Empty).Trim();
        result.Require(user.Length is > 0 and <= 64, "El usuario de la ONU no es valido");
        return result;
    }
}

public sealed class LocalNetworkSettings
{
    public int AdapterIndex { get; set; }
    public string Address { get; set; } = "192.168.100.10";
    public int PrefixLength { get; set; } = 24;

    public LocalNetworkSettings Clone() => new() { AdapterIndex = AdapterIndex, Address = Address, PrefixLength = PrefixLength };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Require(AdapterIndex > 0, "Elige la tarjeta Ethernet conectada a la ONU");
        result.Require(PrefixLength is >= 8 and <= 30, "La mascara local debe estar entre /8 y /30");
        if (!Ipv4.TryParse(Address, out var address))
        {
            result.Add("La IP local no es valida");
            return result;
        }
        if (PrefixLength is >= 8 and <= 30 &&
            !Ipv4.SameNetwork(address, Ipv4.Parse("192.168.100.1"), PrefixLength))
            result.Add("La IP local debe alcanzar la red de administracion 192.168.100.0");
        return result;
    }
}

public sealed class WanSettings
{
    public int VlanId { get; set; } = 101;
    public int Priority { get; set; }
    public string IpAddress { get; set; } = "192.168.16.245";
    public string SubnetMask { get; set; } = "255.255.255.0";
    public string Gateway { get; set; } = "192.168.16.1";
    public string PrimaryDns { get; set; } = "8.8.8.8";
    public string? SecondaryDns { get; set; }
    public int Mtu { get; set; } = 1500;
    public bool NatEnabled { get; set; } = true;
    public List<int> BindLanPorts { get; set; } = new() { 1, 2, 3, 4 };
    public bool BindSsid1 { get; set; } = true;

    public WanSettings Clone() => new()
    {
        VlanId = VlanId, Priority = Priority, IpAddress = IpAddress, SubnetMask = SubnetMask,
        Gateway = Gateway, PrimaryDns = PrimaryDns, SecondaryDns = SecondaryDns, Mtu = Mtu,
        NatEnabled = NatEnabled, BindLanPorts = new List<int>(BindLanPorts), BindSsid1 = BindSsid1,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Require(VlanId is >= 1 and <= 4094, "La VLAN debe estar entre 1 y 4094");
        result.Require(Priority is >= 0 and <= 7, "La prioridad debe estar entre 0 y 7");
        result.Require(Mtu is >= 576 and <= 1540, "El MTU debe estar entre 576 y 1540");

        var ports = BindLanPorts.Distinct().OrderBy(port => port).ToList();
        result.Require(ports.Count > 0, "Debe vincular al menos un puerto LAN");
        result.Require(ports.All(port => port is >= 1 and <= 4), "Solo se admiten los puertos LAN1 a LAN4");
        BindLanPorts = ports;

        if (!Ipv4.TryParse(IpAddress, out var ip)) result.Add("La IP WAN no es valida");
        if (!Ipv4.TryParse(SubnetMask, out var mask)) result.Add("La mascara WAN no es valida");
        if (!Ipv4.TryParse(Gateway, out var gateway)) result.Add("La puerta de enlace no es valida");
        if (!Ipv4.TryParse(PrimaryDns, out _)) result.Add("El DNS principal no es valido");
        if (!string.IsNullOrWhiteSpace(SecondaryDns) && !Ipv4.TryParse(SecondaryDns, out _))
            result.Add("El DNS secundario no es valido");
        if (!result.IsValid) return result;

        int prefix;
        try
        {
            prefix = Ipv4.PrefixFromMask(mask);
        }
        catch (FormatException)
        {
            result.Add("La mascara WAN no es valida");
            return result;
        }

        if (!Ipv4.SameNetwork(ip, gateway, prefix))
            result.Add("La puerta de enlace debe pertenecer a la misma red WAN");
        var network = Ipv4.NetworkAddress(ip, prefix);
        var broadcast = Ipv4.BroadcastAddress(ip, prefix);
        if (ip.Equals(network) || ip.Equals(broadcast))
            result.Add("La IP WAN no puede ser la direccion de red o broadcast");
        return result;
    }
}

public sealed class WifiSettings
{
    public bool Enabled { get; set; } = true;
    public string Ssid { get; set; } = "test";
    public string Password { get; set; } = "12345678";
    public bool Broadcast { get; set; } = true;
    public bool WmmEnabled { get; set; } = true;
    public bool WpsEnabled { get; set; }
    public int MaxClients { get; set; } = 32;

    public WifiSettings Clone() => new()
    {
        Enabled = Enabled, Ssid = Ssid, Password = Password, Broadcast = Broadcast,
        WmmEnabled = WmmEnabled, WpsEnabled = WpsEnabled, MaxClients = MaxClients,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        var ssid = (Ssid ?? string.Empty).Trim();
        result.Require(ssid.Length > 0, "El nombre WiFi es obligatorio");
        result.Require(ssid.Length <= 32, "El nombre WiFi admite hasta 32 caracteres");
        result.Require(MaxClients is >= 1 and <= 32, "El maximo de equipos WiFi debe estar entre 1 y 32");

        var raw = Password ?? string.Empty;
        var isHex64 = raw.Length == 64 && raw.All(Uri.IsHexDigit);
        result.Require(isHex64 || raw.Length is >= 8 and <= 63, "La clave WiFi debe tener entre 8 y 63 caracteres");
        return result;
    }
}

public sealed class Tr069Settings
{
    public bool Enabled { get; set; } = true;
    public string AcsUrl { get; set; } = "http://10.254.250.2:7547/";
    public string Username { get; set; } = "ispmax-cpe";
    public string? Password { get; set; }
    public string ConnectionRequestUsername { get; set; } = "ispmax-connection-request";
    public string? ConnectionRequestPassword { get; set; }
    public int PeriodicInformInterval { get; set; } = 900;

    public Tr069Settings Clone() => new()
    {
        Enabled = Enabled, AcsUrl = AcsUrl, Username = Username, Password = Password,
        ConnectionRequestUsername = ConnectionRequestUsername,
        ConnectionRequestPassword = ConnectionRequestPassword,
        PeriodicInformInterval = PeriodicInformInterval,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        if (!Enabled) return result;

        result.Require(PeriodicInformInterval is >= 60 and <= 86400, "El reporte periodico debe estar entre 60 y 86400 segundos");

        var value = (AcsUrl ?? string.Empty).Trim();
        if (!Uri.TryCreate(value, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrWhiteSpace(parsed.Host))
        {
            result.Add("La URL del ACS debe usar HTTP o HTTPS");
        }
        else if (!string.IsNullOrEmpty(parsed.UserInfo) || !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment))
        {
            result.Add("La URL del ACS no puede contener credenciales, consulta ni fragmento");
        }
        else
        {
            AcsUrl = value.EndsWith('/') ? value : value + "/";
        }

        foreach (var (label, user) in new[] { ("TR-069", Username), ("de solicitud de conexion", ConnectionRequestUsername) })
        {
            var trimmed = (user ?? string.Empty).Trim();
            result.Require(trimmed.Length is > 0 and <= 64, $"El usuario {label} no es valido");
        }
        return result;
    }
}

public sealed class RemoteAccessSettings
{
    public bool Enabled { get; set; } = true;
    public string Source { get; set; } = "192.168.16.1/32";
    public bool Http { get; set; } = true;
    public bool Telnet { get; set; }
    public bool Ssh { get; set; }
    public bool Ftp { get; set; }
    public bool Icmp { get; set; }

    public RemoteAccessSettings Clone() => new()
    {
        Enabled = Enabled, Source = Source, Http = Http, Telnet = Telnet, Ssh = Ssh, Ftp = Ftp, Icmp = Icmp,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        try
        {
            Source = Ipv4.FormatCidr(Source);
        }
        catch (FormatException exception)
        {
            result.Add(exception.Message);
        }
        result.Require(!Enabled || Http, "El acceso remoto requiere HTTP habilitado");
        result.Require(!Telnet && !Ssh && !Ftp, "Este perfil seguro no habilita Telnet, SSH ni FTP");
        return result;
    }
}

public sealed class ProvisionRequest
{
    public DeviceSettings Device { get; set; } = new();
    public LocalNetworkSettings LocalNetwork { get; set; } = new();
    public WanSettings Wan { get; set; } = new();
    public WifiSettings Wifi { get; set; } = new();
    public Tr069Settings Tr069 { get; set; } = new();
    public RemoteAccessSettings RemoteAccess { get; set; } = new();
    public bool SaveConfiguration { get; set; } = true;
    public bool CreateBackups { get; set; } = true;
    public bool ReplaceConflictingWan { get; set; }
    public string? CloudJobId { get; set; }
    /// <summary>new_client, restore_same_onu, replace_onu o migrate_pon.</summary>
    public string ServiceOperation { get; set; } = "new_client";
    /// <summary>router o bridge.</summary>
    public string ServiceMode { get; set; } = "router";

    public ProvisionRequest Clone() => new()
    {
        Device = Device.Clone(), LocalNetwork = LocalNetwork.Clone(), Wan = Wan.Clone(),
        Wifi = Wifi.Clone(), Tr069 = Tr069.Clone(), RemoteAccess = RemoteAccess.Clone(),
        SaveConfiguration = SaveConfiguration, CreateBackups = CreateBackups,
        ReplaceConflictingWan = ReplaceConflictingWan, CloudJobId = CloudJobId,
        ServiceOperation = ServiceOperation, ServiceMode = ServiceMode,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Merge(Device.Validate());
        result.Merge(LocalNetwork.Validate());
        result.Merge(Wan.Validate());
        result.Merge(Wifi.Validate());
        result.Merge(Tr069.Validate());
        result.Merge(RemoteAccess.Validate());
        result.Require(
            ServiceOperation is "new_client" or "restore_same_onu" or "replace_onu" or "migrate_pon",
            "La operacion de servicio no es valida");
        result.Require(ServiceMode is "router" or "bridge", "El modo de servicio debe ser router o bridge");
        if (!string.IsNullOrWhiteSpace(CloudJobId))
            result.Require(Regex.IsMatch(CloudJobId, "^[a-f0-9-]{20,50}$"), "El expediente de nube no es valido");
        return result;
    }

    /// <summary>Copia sin secretos, para el historial y para mostrar en pantalla.</summary>
    public ProvisionRequest SafeCopy()
    {
        var copy = Clone();
        if (copy.Device.Password is not null) copy.Device.Password = "***";
        copy.Wifi.Password = "***";
        if (copy.Tr069.Password is not null) copy.Tr069.Password = "***";
        if (copy.Tr069.ConnectionRequestPassword is not null) copy.Tr069.ConnectionRequestPassword = "***";
        return copy;
    }
}

public sealed class ConnectionCheckRequest
{
    public DeviceSettings Device { get; set; } = new();
    public LocalNetworkSettings LocalNetwork { get; set; } = new();
    public bool PrepareAdapter { get; set; } = true;

    public ConnectionCheckRequest Clone() => new()
    {
        Device = Device.Clone(), LocalNetwork = LocalNetwork.Clone(), PrepareAdapter = PrepareAdapter,
    };

    public ValidationResult Validate()
    {
        var result = new ValidationResult();
        result.Merge(Device.Validate());
        result.Merge(LocalNetwork.Validate());
        return result;
    }

    public ConnectionCheckRequest SafeCopy()
    {
        var copy = Clone();
        if (copy.Device.Password is not null) copy.Device.Password = "***";
        return copy;
    }
}
