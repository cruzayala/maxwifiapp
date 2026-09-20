using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace OnuStudio.Core.Cloud;

public sealed class CloudException : Exception
{
    public CloudException(int statusCode, string detail) : base(detail) => StatusCode = statusCode;
    public int StatusCode { get; }
    public bool IsUnauthorized => StatusCode is 401 or 403;
}

public enum CloudAuth
{
    /// <summary>Sin credenciales: login y refresco de sesion.</summary>
    None,
    /// <summary>Sesion del usuario (x-auth-token).</summary>
    User,
    /// <summary>Credencial del agente (x-agent-token), la que usan los trabajadores.</summary>
    Agent,
}

/// <summary>
/// Cliente HTTP contra ISP Max en Railway. Traduce los errores a mensajes que el
/// tecnico pueda entender y nunca escribe credenciales en el texto del error.
/// </summary>
public sealed class CloudClient
{
    private readonly HttpClient _http;
    private readonly Func<CloudSessionState> _session;

    public CloudClient(Func<CloudSessionState> session)
    {
        _session = session;
        _http = new HttpClient(new SocketsHttpHandler
        {
            PooledConnectionLifetime = TimeSpan.FromMinutes(5),
            ConnectTimeout = TimeSpan.FromSeconds(20),
        })
        {
            Timeout = Timeout.InfiniteTimeSpan,
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"ONU-Studio/{AppInfo.Version}");
    }

    public async Task<JsonNode?> SendAsync(
        string path,
        HttpMethod? method = null,
        object? body = null,
        CloudAuth auth = CloudAuth.User,
        double timeoutSeconds = 75,
        string? agentTokenOverride = null,
        CancellationToken cancellationToken = default)
    {
        var session = _session();
        var request = new HttpRequestMessage(method ?? HttpMethod.Get, $"{session.BaseUrl.TrimEnd('/')}{path}");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

        switch (auth)
        {
            case CloudAuth.Agent:
                var agentToken = agentTokenOverride ?? session.AgentToken;
                if (string.IsNullOrWhiteSpace(agentToken))
                    throw new CloudException(401, "Empareja ONU Studio con ISP Max");
                request.Headers.TryAddWithoutValidation("x-agent-token", agentToken);
                break;
            case CloudAuth.User:
                if (string.IsNullOrWhiteSpace(session.Token))
                    throw new CloudException(401, "Conecta ONU Studio con ISP Max");
                request.Headers.TryAddWithoutValidation("x-auth-token", session.Token);
                break;
        }

        if (body is not null)
        {
            var json = body as string ?? JsonDefaults.ToJson(body, camelCase: true);
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(timeoutSeconds));

        HttpResponseMessage response;
        try
        {
            response = await _http.SendAsync(request, timeout.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new CloudException(504, "ISP Max no respondio a tiempo");
        }
        catch (HttpRequestException exception)
        {
            throw new CloudException(502, $"No se pudo conectar con ISP Max: {exception.Message}");
        }

        using (response)
        {
            var text = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            if (!response.IsSuccessStatusCode)
                throw new CloudException((int)response.StatusCode, DescribeError(response.StatusCode, text));
            return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
        }
    }

    public async Task<JsonObject> SendObjectAsync(
        string path, HttpMethod? method = null, object? body = null, CloudAuth auth = CloudAuth.User,
        double timeoutSeconds = 75, string? agentTokenOverride = null, CancellationToken cancellationToken = default)
    {
        var node = await SendAsync(path, method, body, auth, timeoutSeconds, agentTokenOverride, cancellationToken).ConfigureAwait(false);
        return node as JsonObject ?? new JsonObject();
    }

    private static string DescribeError(HttpStatusCode status, string text)
    {
        try
        {
            if (JsonNode.Parse(text) is JsonObject payload)
            {
                var detail = payload["error"]?.GetValue<string>() ?? payload["detail"]?.ToString();
                if (!string.IsNullOrWhiteSpace(detail)) return Trim(detail);
            }
        }
        catch (Exception)
        {
            // El cuerpo no era JSON: se usa el mensaje generico.
        }
        return $"ISP Max respondio HTTP {(int)status}";
    }

    private static string Trim(string value) => value.Length > 600 ? value[..600] : value;
}
