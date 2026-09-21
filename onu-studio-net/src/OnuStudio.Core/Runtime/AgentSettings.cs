using System.Text.RegularExpressions;

namespace OnuStudio.Core;

/// <summary>
/// Credenciales tecnicas y valores por defecto del agente. Antes vivian en un
/// archivo .env que habia que editar a mano; ahora se editan en la pantalla de
/// Ajustes y se guardan cifradas con DPAPI del usuario de Windows.
/// </summary>
public sealed class AgentSettings
{
    public string HuaweiUsername { get; set; } = "telecomadmin";
    public string HuaweiPassword { get; set; } = string.Empty;
    public string ZteUsername { get; set; } = "admin";
    public string ZtePassword { get; set; } = string.Empty;

    public bool Tr069Enabled { get; set; } = true;
    public string AcsUrl { get; set; } = "http://10.254.250.2:7547/";
    public string Tr069Username { get; set; } = "ispmax-cpe";
    public string Tr069Password { get; set; } = string.Empty;
    public string ConnectionRequestUsername { get; set; } = "ispmax-connection-request";
    public string ConnectionRequestPassword { get; set; } = string.Empty;
    public int PeriodicInformInterval { get; set; } = 900;

    public string GenieAcsUrl { get; set; } = "http://127.0.0.1:7557";
    public string DefaultRemoteSource { get; set; } = "192.168.16.1/32";
    /// <summary>El navegador de automatizacion trabaja sin ventana salvo para diagnosticar.</summary>
    public bool Headless { get; set; } = true;
    public bool StartWithWindows { get; set; }

    public bool HasHuaweiPassword => !string.IsNullOrEmpty(HuaweiPassword);
    public bool HasZtePassword => !string.IsNullOrEmpty(ZtePassword);
    public bool HasTr069Passwords => !string.IsNullOrEmpty(Tr069Password) && !string.IsNullOrEmpty(ConnectionRequestPassword);

    public AgentSettings Clone() => (AgentSettings)MemberwiseClone();

    public string PasswordFor(string model) => model == "F670L" ? ZtePassword : HuaweiPassword;
    public string UsernameFor(string model) => model == "F670L" ? ZteUsername : HuaweiUsername;

    public Models.ValidationResult Validate()
    {
        var result = new Models.ValidationResult();
        result.Require(!string.IsNullOrWhiteSpace(HuaweiUsername), "Indica el usuario tecnico de las ONU Huawei");
        result.Require(!string.IsNullOrWhiteSpace(ZteUsername), "Indica el usuario tecnico de las ONU ZTE");
        result.Require(PeriodicInformInterval is >= 60 and <= 86400, "El reporte periodico debe estar entre 60 y 86400 segundos");

        if (Tr069Enabled)
        {
            if (!Uri.TryCreate(AcsUrl.Trim(), UriKind.Absolute, out var acs) ||
                (acs.Scheme != Uri.UriSchemeHttp && acs.Scheme != Uri.UriSchemeHttps))
                result.Add("La URL del ACS debe usar HTTP o HTTPS");
        }
        if (!string.IsNullOrWhiteSpace(DefaultRemoteSource))
        {
            try { DefaultRemoteSource = Ipv4.FormatCidr(DefaultRemoteSource); }
            catch (FormatException exception) { result.Add(exception.Message); }
        }
        return result;
    }
}

/// <summary>Lee y guarda los ajustes, migrando el .env del agente anterior la primera vez.</summary>
public sealed class AgentSettingsStore
{
    private readonly SecureJsonStore _store;
    private readonly string _legacyEnvPath;

    public AgentSettingsStore(string? path = null, string? legacyEnvPath = null)
    {
        _store = new SecureJsonStore(path ?? Path.Combine(AppPaths.DataDir, "agent-settings.dat"));
        _legacyEnvPath = legacyEnvPath ?? AppPaths.EnvPath;
    }

    public AgentSettings Load()
    {
        try
        {
            var saved = _store.Load<AgentSettings>();
            if (saved is not null) return saved;
        }
        catch (Exception)
        {
            // Si no se puede descifrar, se parte de los valores por defecto.
        }

        var settings = new AgentSettings();
        ApplyLegacyEnv(settings);
        ApplyEnvironment(settings);
        return settings;
    }

    public void Save(AgentSettings settings) => _store.Save(settings);

    /// <summary>Toma los valores del .env del agente anterior para no reconfigurar nada.</summary>
    private void ApplyLegacyEnv(AgentSettings settings)
    {
        if (!File.Exists(_legacyEnvPath)) return;
        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadAllLines(_legacyEnvPath))
        {
            var match = Regex.Match(line.Trim(), "^([A-Z0-9_]+)\\s*=\\s*(.*)$", RegexOptions.IgnoreCase);
            if (!match.Success) continue;
            values[match.Groups[1].Value] = match.Groups[2].Value.Trim().Trim('"');
        }
        Apply(settings, values.GetValueOrDefault);
    }

    private static void ApplyEnvironment(AgentSettings settings) =>
        Apply(settings, name => Environment.GetEnvironmentVariable(name));

    private static void Apply(AgentSettings settings, Func<string, string?> read)
    {
        void Text(string name, Action<string> assign)
        {
            var value = read(name);
            if (!string.IsNullOrWhiteSpace(value)) assign(value.Trim());
        }

        Text("ONU_DEFAULT_USERNAME", value => settings.HuaweiUsername = value);
        Text("ONU_DEFAULT_PASSWORD", value => settings.HuaweiPassword = value);
        Text("ONU_ZTE_DEFAULT_USERNAME", value => settings.ZteUsername = value);
        Text("ONU_ZTE_DEFAULT_PASSWORD", value => settings.ZtePassword = value);
        Text("ONU_TR069_ACS_URL", value => settings.AcsUrl = value);
        Text("ONU_TR069_USERNAME", value => settings.Tr069Username = value);
        Text("ONU_TR069_PASSWORD", value => settings.Tr069Password = value);
        Text("ONU_TR069_CONNECTION_REQUEST_USERNAME", value => settings.ConnectionRequestUsername = value);
        Text("ONU_TR069_CONNECTION_REQUEST_PASSWORD", value => settings.ConnectionRequestPassword = value);
        Text("GENIEACS_NBI_URL", value => settings.GenieAcsUrl = value);
        Text("ONU_TR069_PERIODIC_INFORM_INTERVAL", value =>
        {
            if (int.TryParse(value, out var interval)) settings.PeriodicInformInterval = interval;
        });
        Text("ONU_TR069_ENABLED", value => settings.Tr069Enabled = value.ToLowerInvariant() is not ("0" or "false" or "no"));
        Text("ONU_HEADLESS", value => settings.Headless = value.ToLowerInvariant() is not ("0" or "false" or "no"));
    }
}
