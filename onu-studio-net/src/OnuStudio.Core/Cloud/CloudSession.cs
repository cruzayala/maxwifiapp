using System.Text.Json.Nodes;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Cloud;

public sealed class CloudUser
{
    public int UserId { get; set; }
    public string Username { get; set; } = string.Empty;
    public string Role { get; set; } = string.Empty;
}

/// <summary>Lo que se guarda cifrado con DPAPI entre ejecuciones.</summary>
public sealed class CloudSessionState
{
    public string BaseUrl { get; set; } = DefaultBaseUrl();
    public string? Token { get; set; }
    public string? AgentToken { get; set; }
    public string? DeviceToken { get; set; }
    public CloudUser? User { get; set; }
    /// <summary>disconnected, connecting, connected, offline o revoked.</summary>
    public string SessionState { get; set; } = "disconnected";
    public string? LastVerifiedAt { get; set; }
    public string? TokenFingerprint { get; set; }
    public string? RevokedReason { get; set; }
    public string DeviceId { get; set; } = AppInfo.DeviceId;

    public bool Connected => !string.IsNullOrWhiteSpace(Token);
    public bool AgentPaired => !string.IsNullOrWhiteSpace(AgentToken);
    public bool Remembered => !string.IsNullOrWhiteSpace(DeviceToken);

    public static string DefaultBaseUrl()
    {
        var configured = Environment.GetEnvironmentVariable("ISP_MAX_CLOUD_URL");
        return string.IsNullOrWhiteSpace(configured)
            ? "https://isp-max-production-d0b9.up.railway.app"
            : configured.Trim().TrimEnd('/');
    }

    public CloudSessionState Clone() => new()
    {
        BaseUrl = BaseUrl, Token = Token, AgentToken = AgentToken, DeviceToken = DeviceToken,
        User = User is null ? null : new CloudUser { UserId = User.UserId, Username = User.Username, Role = User.Role },
        SessionState = SessionState, LastVerifiedAt = LastVerifiedAt, TokenFingerprint = TokenFingerprint,
        RevokedReason = RevokedReason, DeviceId = DeviceId,
    };
}

/// <summary>
/// Mantiene viva la conexion con ISP Max: recuerda la PC con una sesion de dispositivo,
/// la renueva sola al abrir y avisa a la interfaz cada vez que el estado cambia.
/// </summary>
public sealed class CloudSessionManager
{
    private readonly SecureJsonStore _store;
    private readonly object _lock = new();
    private CloudSessionState _state = new();

    public CloudSessionManager(SecureJsonStore store)
    {
        _store = store;
        Client = new CloudClient(() => Current);
        Load();
    }

    public CloudClient Client { get; }

    public event Action<CloudSessionState>? Changed;

    public CloudSessionState Current
    {
        get { lock (_lock) return _state; }
    }

    private void Mutate(Action<CloudSessionState> change, bool persist = true)
    {
        CloudSessionState snapshot;
        lock (_lock)
        {
            change(_state);
            snapshot = _state.Clone();
        }
        if (persist) Persist(snapshot);
        Changed?.Invoke(snapshot);
    }

    private void Persist(CloudSessionState state)
    {
        try
        {
            _store.Save(state);
        }
        catch (Exception)
        {
            // Si DPAPI falla, la sesion sigue viva en memoria hasta cerrar el programa.
        }
    }

    private void Load()
    {
        try
        {
            var saved = _store.Load<CloudSessionState>();
            if (saved is null) return;
            saved.DeviceId = AppInfo.DeviceId;
            if (string.IsNullOrWhiteSpace(saved.BaseUrl)) saved.BaseUrl = CloudSessionState.DefaultBaseUrl();
            saved.Token = null; // El token de usuario se renueva al abrir.
            if (!string.IsNullOrWhiteSpace(saved.DeviceToken)) saved.SessionState = "connecting";
            else if (saved.SessionState != "revoked") saved.SessionState = "disconnected";
            lock (_lock) _state = saved;
        }
        catch (Exception exception)
        {
            lock (_lock)
            {
                _state = new CloudSessionState
                {
                    SessionState = "revoked",
                    RevokedReason = $"No se pudo abrir la sesion guardada: {exception.Message}",
                };
            }
        }
    }

    /// <summary>Renueva la sesion guardada al abrir el programa.</summary>
    public async Task<bool> RestoreAsync(CancellationToken cancellationToken = default)
    {
        var deviceToken = Current.DeviceToken;
        if (string.IsNullOrWhiteSpace(deviceToken))
        {
            Mutate(state => state.SessionState = "disconnected", persist: false);
            return false;
        }

        Mutate(state => state.SessionState = "connecting", persist: false);
        try
        {
            var result = await Client.SendObjectAsync(
                "/auth/device-sessions/refresh", HttpMethod.Post,
                new { deviceToken, deviceId = Current.DeviceId },
                CloudAuth.None, 15, cancellationToken: cancellationToken).ConfigureAwait(false);

            var token = result["token"]?.GetValue<string>();
            if (string.IsNullOrWhiteSpace(token))
                throw new CloudException(502, "ISP Max no devolvio una sesion valida");

            Mutate(state =>
            {
                state.Token = token;
                state.User = ReadUser(result["user"]) ?? state.User;
                state.LastVerifiedAt = Clock.UtcNow();
                state.SessionState = "connected";
                state.RevokedReason = null;
            });
            return true;
        }
        catch (CloudException exception)
        {
            if (exception.IsUnauthorized) Revoke(exception.Message);
            else Mutate(state => { state.Token = null; state.SessionState = "offline"; }, persist: false);
            return false;
        }
    }

    /// <summary>Inicia sesion, recuerda la PC y empareja el agente en un solo paso.</summary>
    public async Task LoginAsync(string baseUrl, string username, string password, CancellationToken cancellationToken = default)
    {
        var url = (baseUrl ?? string.Empty).Trim().TrimEnd('/');
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed) ||
            (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
            throw new CloudException(400, "La direccion de ISP Max no es valida");

        Mutate(state => { state.BaseUrl = url; state.SessionState = "connecting"; }, persist: false);

        var login = await Client.SendObjectAsync(
            "/auth/login", HttpMethod.Post,
            new { username = username.Trim(), password },
            CloudAuth.None, cancellationToken: cancellationToken).ConfigureAwait(false);

        var token = login["token"]?.GetValue<string>();
        var user = ReadUser(login["user"]);
        if (string.IsNullOrWhiteSpace(token))
            throw new CloudException(502, "ISP Max no devolvio una sesion valida");
        if (user?.Role is not ("admin" or "super_admin"))
        {
            Mutate(state => { state.Token = null; state.User = null; state.SessionState = "disconnected"; }, persist: false);
            throw new CloudException(403, "ONU Studio requiere una cuenta admin o super_admin");
        }

        Mutate(state => { state.Token = token; state.User = user; }, persist: false);

        var trusted = await Client.SendObjectAsync(
            "/auth/device-sessions", HttpMethod.Post,
            new { deviceId = Current.DeviceId, deviceName = "ONU Studio ISP Max" },
            CloudAuth.User, 15, cancellationToken: cancellationToken).ConfigureAwait(false);
        var deviceToken = trusted["deviceToken"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(deviceToken))
            throw new CloudException(502, "ISP Max no devolvio una sesion recordable");

        var paired = await Client.SendObjectAsync(
            "/agent-api/agents/pair", HttpMethod.Post,
            new
            {
                agentId = Current.DeviceId,
                agentVersion = AppInfo.Version,
                displayName = AgentMetadata.DisplayName(),
            },
            CloudAuth.User, 15, cancellationToken: cancellationToken).ConfigureAwait(false);

        var agentToken = paired["token"]?.GetValue<string>() ?? string.Empty;
        if (agentToken.Length < 32)
            throw new CloudException(502, "ISP Max no devolvio una credencial de agente valida");

        Mutate(state =>
        {
            state.DeviceToken = deviceToken;
            state.AgentToken = agentToken;
            state.TokenFingerprint = paired["tokenFingerprint"]?.GetValue<string>();
            state.LastVerifiedAt = Clock.UtcNow();
            state.SessionState = "connected";
            state.RevokedReason = null;
        });
    }

    public async Task LogoutAsync(CancellationToken cancellationToken = default)
    {
        var state = Current;
        if (!string.IsNullOrWhiteSpace(state.DeviceToken))
        {
            try
            {
                await Client.SendAsync("/auth/device-sessions/revoke", HttpMethod.Post,
                    new { deviceToken = state.DeviceToken }, CloudAuth.None, 10, cancellationToken: cancellationToken).ConfigureAwait(false);
            }
            catch (CloudException) { /* la sesion remota ya pudo expirar */ }
        }
        if (!string.IsNullOrWhiteSpace(state.Token))
        {
            try
            {
                await Client.SendAsync("/auth/logout", HttpMethod.Post, null, CloudAuth.User, 10, cancellationToken: cancellationToken).ConfigureAwait(false);
            }
            catch (CloudException) { /* la sesion remota ya pudo expirar */ }
        }

        _store.Delete();
        Mutate(current =>
        {
            current.Token = null;
            current.AgentToken = null;
            current.DeviceToken = null;
            current.User = null;
            current.SessionState = "disconnected";
            current.LastVerifiedAt = null;
            current.TokenFingerprint = null;
            current.RevokedReason = null;
        }, persist: false);
    }

    /// <summary>La nube retiro el permiso: se borra todo lo guardado en esta PC.</summary>
    public void Revoke(string reason = "Credencial revocada desde ISP Max")
    {
        Mutate(state =>
        {
            state.Token = null;
            state.AgentToken = null;
            state.DeviceToken = null;
            state.User = null;
            state.SessionState = "revoked";
            state.LastVerifiedAt = Clock.UtcNow();
            state.TokenFingerprint = null;
            state.RevokedReason = reason.Length > 240 ? reason[..240] : reason;
        });
    }

    public void MarkOffline(string? reason = null) =>
        Mutate(state =>
        {
            if (state.SessionState is "revoked") return;
            state.SessionState = "offline";
            if (!string.IsNullOrWhiteSpace(reason)) state.RevokedReason = null;
        }, persist: false);

    public void MarkConnected() =>
        Mutate(state =>
        {
            state.SessionState = "connected";
            state.LastVerifiedAt = Clock.UtcNow();
        }, persist: false);

    private static CloudUser? ReadUser(JsonNode? node)
    {
        if (node is not JsonObject user) return null;
        return new CloudUser
        {
            UserId = user["userId"]?.GetValue<int>() ?? 0,
            Username = user["username"]?.GetValue<string>() ?? string.Empty,
            Role = user["role"]?.GetValue<string>() ?? string.Empty,
        };
    }
}
