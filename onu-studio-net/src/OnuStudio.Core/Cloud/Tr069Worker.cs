using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using OnuStudio.Core.Acs;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Cloud;

public sealed class WorkerStatus
{
    public bool Running { get; set; }
    public string AgentId { get; set; } = AppInfo.DeviceId;
    public string? LastPollAt { get; set; }
    public string? LastTaskAt { get; set; }
    public string? LastError { get; set; }
    public string? CurrentTaskId { get; set; }
    public int Completed { get; set; }
    public int Failed { get; set; }

    public WorkerStatus Clone() => (WorkerStatus)MemberwiseClone();
}

/// <summary>
/// Atiende las tareas TR-069 que ISP Max envia para esta PC: pregunta, ejecuta
/// contra el ACS y devuelve el resultado con su verificacion.
/// </summary>
public sealed class Tr069Worker : IAsyncDisposable
{
    private readonly CloudSessionManager _session;
    private readonly GenieAcsClient _acs;
    private readonly object _lock = new();
    private CancellationTokenSource? _stop;
    private Task? _loop;
    private WorkerStatus _status = new();

    public Tr069Worker(CloudSessionManager session, GenieAcsClient? acs = null)
    {
        _session = session;
        _acs = acs ?? new GenieAcsClient();
    }

    public event Action<WorkerStatus>? StatusChanged;

    public WorkerStatus Status
    {
        get { lock (_lock) return _status.Clone(); }
    }

    private void Update(Action<WorkerStatus> change)
    {
        WorkerStatus snapshot;
        lock (_lock)
        {
            change(_status);
            snapshot = _status.Clone();
        }
        StatusChanged?.Invoke(snapshot);
    }

    public void Start()
    {
        if (_loop is { IsCompleted: false }) return;
        _stop = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_stop.Token));
    }

    public async Task StopAsync()
    {
        _stop?.Cancel();
        if (_loop is not null)
        {
            try { await _loop.ConfigureAwait(false); }
            catch (OperationCanceledException) { /* cierre normal */ }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        _stop?.Dispose();
    }

    internal static string ErrorText(Exception exception, int maxLength = 600)
    {
        var text = Regex.Replace(exception.Message, @"\s+", " ").Trim();
        return text.Length > maxLength ? text[..maxLength] : text;
    }

    private Task ReportAsync(string taskId, string status, JsonNode? result = null, string? error = null,
        string? errorCode = null, JsonNode? rollback = null, JsonNode? verification = null, CancellationToken cancellationToken = default) =>
        _session.Client.SendAsync($"/tr069-api/agent/tasks/{taskId}/report", HttpMethod.Post, new
        {
            agentId = AppInfo.DeviceId,
            status,
            result,
            errorMessage = error,
            errorCode,
            rollback,
            verification,
        }, CloudAuth.Agent, 20, cancellationToken: cancellationToken);

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        Update(status => status.Running = true);
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var agentToken = _session.Current.AgentToken;
                if (string.IsNullOrWhiteSpace(agentToken))
                {
                    await Task.Delay(2000, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                try
                {
                    var response = await _session.Client.SendObjectAsync("/tr069-api/agent/poll", HttpMethod.Post,
                        new { agentId = AppInfo.DeviceId, agentVersion = AppInfo.Version },
                        CloudAuth.Agent, 12, agentToken, cancellationToken).ConfigureAwait(false);

                    Update(status => { status.LastPollAt = Clock.UtcNow(); status.LastError = null; });

                    if (response["task"] is not JsonObject task)
                    {
                        await HandleTelemetryAsync(response, cancellationToken).ConfigureAwait(false);
                        var wait = response["pollAfterSeconds"]?.GetValue<double>() ?? 5;
                        await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(wait, 1, 10)), cancellationToken).ConfigureAwait(false);
                        continue;
                    }

                    Update(status => status.LastTaskAt = Clock.UtcNow());
                    await ExecuteTaskAsync(task, cancellationToken).ConfigureAwait(false);
                }
                catch (CloudException exception)
                {
                    var error = ErrorText(exception);
                    Update(status => status.LastError = error);
                    if (exception.StatusCode == 401 && _session.Current.AgentToken == agentToken) _session.Revoke(error);
                    await Task.Delay(5000, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception exception)
                {
                    Update(status => status.LastError = ErrorText(exception));
                    await Task.Delay(5000, cancellationToken).ConfigureAwait(false);
                }
            }
        }
        finally
        {
            Update(status => status.Running = false);
        }
    }

    /// <summary>Cuando no hay tarea, ISP Max puede pedir una lectura de telemetria del equipo.</summary>
    private async Task HandleTelemetryAsync(JsonObject response, CancellationToken cancellationToken)
    {
        if (response["telemetry"] is not JsonObject telemetry) return;
        var serial = telemetry["serial"]?.ToString();
        if (string.IsNullOrWhiteSpace(serial)) return;

        try
        {
            _acs.SetIdentityHints(serial, telemetry["identityHints"]);
            var snapshot = await _acs.SnapshotAsync(serial, cancellationToken: cancellationToken).ConfigureAwait(false);
            var device = await _acs.FindDeviceAsync(serial, cancellationToken).ConfigureAwait(false);

            await _session.Client.SendAsync(
                $"/tr069-api/agent/devices/{Uri.EscapeDataString(serial)}/snapshot", HttpMethod.Post, new
                {
                    snapshot,
                    capabilities = _acs.Capabilities(device),
                    diagnosticMode = telemetry["diagnosticMode"]?.GetValue<bool>() ?? false,
                }, CloudAuth.Agent, 30, cancellationToken: cancellationToken).ConfigureAwait(false);

            Update(status => { status.LastTaskAt = Clock.UtcNow(); status.LastError = null; });
        }
        catch (Exception exception)
        {
            Update(status => status.LastError = ErrorText(exception));
        }
    }

    private async Task ExecuteTaskAsync(JsonObject task, CancellationToken cancellationToken)
    {
        var taskId = task["id"]?.ToString() ?? string.Empty;
        var serial = task["serial"]?.ToString() ?? string.Empty;
        var action = task["action"]?.ToString() ?? string.Empty;

        try
        {
            _acs.SetIdentityHints(serial, task["identityHints"]);
            var lastProgress = DateTime.MinValue;

            void Progress(string stage, int percent)
            {
                // Se reporta con calma para no saturar la nube en tareas largas.
                if ((DateTime.UtcNow - lastProgress).TotalSeconds < 8 && percent < 90) return;
                lastProgress = DateTime.UtcNow;
                _ = _session.Client.SendAsync($"/tr069-api/agent/tasks/{taskId}/progress", HttpMethod.Post,
                    new { stage, progress = percent }, CloudAuth.Agent, 15, cancellationToken: cancellationToken);
            }

            var payload = task["payload"] as JsonObject ?? new JsonObject();
            var result = await _acs.ExecuteAsync(serial, action, payload, Progress, cancellationToken).ConfigureAwait(false);

            await ReportAsync(taskId, "success", result,
                rollback: result["rollback"]?.DeepClone(),
                verification: result["verification"]?.DeepClone(),
                cancellationToken: cancellationToken).ConfigureAwait(false);
            Update(status => status.Completed++);
        }
        catch (Exception exception)
        {
            var error = ErrorText(exception);
            var code = exception is GenieAcsException acs ? acs.Code : "TR069_AGENT_ERROR";
            var rollback = (exception as GenieAcsException)?.Rollback;
            var verification = (exception as GenieAcsException)?.Verification;
            try
            {
                await ReportAsync(taskId, "failed", error: error, errorCode: code,
                    rollback: rollback, verification: verification, cancellationToken: cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                Update(status => { status.Failed++; status.LastError = error; });
            }
        }
    }
}
