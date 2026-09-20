using System.Text.Json.Nodes;
using OnuStudio.Core.Jobs;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using OnuStudio.Core.Onu;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Cloud;

/// <summary>
/// Mantiene esta PC disponible para ISP Max: pregunta por trabajos (detectar,
/// comprobar o aprovisionar), los ejecuta con el mismo motor local que usa el
/// tecnico y devuelve el progreso en vivo.
/// </summary>
public sealed class OnuCloudWorker : IAsyncDisposable
{
    private readonly CloudSessionManager _session;
    private readonly ProvisioningService _provisioning;
    private readonly JobManager _jobs;
    private readonly JobStore _store;
    private readonly DiscoveryService _discovery;
    private readonly Func<WorkerStatus?> _tr069Status;
    private readonly object _lock = new();

    private CancellationTokenSource? _stop;
    private Task? _loop;
    private WorkerStatus _status = new();

    public OnuCloudWorker(
        CloudSessionManager session,
        ProvisioningService provisioning,
        JobManager jobs,
        JobStore store,
        DiscoveryService discovery,
        Func<WorkerStatus?> tr069Status)
    {
        _session = session;
        _provisioning = provisioning;
        _jobs = jobs;
        _store = store;
        _discovery = discovery;
        _tr069Status = tr069Status;
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

    private object BuildCapabilities()
    {
        var adapters = NetworkTools.ListAdapters();
        var preferred = adapters.FirstOrDefault(item => item.IsUp && item.Supported && item.Name.Contains("ethernet", StringComparison.OrdinalIgnoreCase))
            ?? adapters.FirstOrDefault(item => item.Supported)
            ?? adapters.FirstOrDefault();

        return new
        {
            actions = new[] { "discover", "check", "provision" },
            supportedDevices = new[]
            {
                new { model = "EG8141A5", vendor = "Huawei / Novatech", writeCertified = true },
                new { model = "F670L", vendor = "ZTE", writeCertified = true },
            },
            adapters,
            networkRanges = _store.NetworkRanges(),
            recommendedLocalNetwork = new
            {
                adapter_index = preferred?.Index,
                address = "192.168.100.10",
                prefix_length = 24,
            },
            tr069Worker = _tr069Status(),
        };
    }

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
                    var response = await _session.Client.SendObjectAsync("/agent-api/agent/poll", HttpMethod.Post, new
                    {
                        agentId = AppInfo.DeviceId,
                        agentVersion = AppInfo.Version,
                        metadata = AgentMetadata.Build(),
                        capabilities = BuildCapabilities(),
                        discovery = _discovery.Current,
                    }, CloudAuth.Agent, 15, agentToken, cancellationToken).ConfigureAwait(false);

                    Update(status => { status.LastPollAt = Clock.UtcNow(); status.LastError = null; });
                    _session.MarkConnected();

                    if (response["task"] is not JsonObject task)
                    {
                        var wait = response["pollAfterSeconds"]?.GetValue<double>() ?? 3;
                        await Task.Delay(TimeSpan.FromSeconds(Math.Clamp(wait, 1, 10)), cancellationToken).ConfigureAwait(false);
                        continue;
                    }

                    var taskId = task["id"]?.ToString() ?? string.Empty;
                    Update(status => { status.LastTaskAt = Clock.UtcNow(); status.CurrentTaskId = taskId; });

                    string? localJobId = null;
                    try
                    {
                        var (result, jobId) = await ExecuteLocalJobAsync(task, cancellationToken).ConfigureAwait(false);
                        localJobId = jobId;
                        await ReportAsync(taskId, "success", result, localJobId: localJobId, cancellationToken: cancellationToken).ConfigureAwait(false);
                        Update(status => { status.Completed++; status.CurrentTaskId = null; status.LastError = null; });
                    }
                    catch (Exception exception)
                    {
                        var error = Tr069Worker.ErrorText(exception, 900);
                        var (code, _) = ProvisioningService.ErrorMetadata(exception);
                        if (exception is LocalJobFailedException failed) localJobId = failed.LocalJobId;
                        try
                        {
                            await ReportAsync(taskId, "failed", error: error, errorCode: code, localJobId: localJobId, cancellationToken: cancellationToken).ConfigureAwait(false);
                        }
                        finally
                        {
                            Update(status => { status.Failed++; status.CurrentTaskId = null; status.LastError = error; });
                        }
                    }
                }
                catch (CloudException exception)
                {
                    var error = Tr069Worker.ErrorText(exception, 900);
                    Update(status => status.LastError = error);
                    if (exception.StatusCode == 401 && _session.Current.AgentToken == agentToken) _session.Revoke(error);
                    else _session.MarkOffline();
                    await Task.Delay(5000, cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
                catch (Exception exception)
                {
                    Update(status => status.LastError = Tr069Worker.ErrorText(exception, 900));
                    await Task.Delay(5000, cancellationToken).ConfigureAwait(false);
                }
            }
        }
        finally
        {
            Update(status => { status.Running = false; status.CurrentTaskId = null; });
        }
    }

    private sealed class LocalJobFailedException : Exception
    {
        public LocalJobFailedException(string message, string? localJobId, bool retryable) : base(message)
        {
            LocalJobId = localJobId;
            Retryable = retryable;
        }

        public string? LocalJobId { get; }
        public bool Retryable { get; }
    }

    private async Task<(JsonObject Result, string? LocalJobId)> ExecuteLocalJobAsync(JsonObject task, CancellationToken cancellationToken)
    {
        var action = task["action"]?.ToString() ?? string.Empty;
        var payload = task["payload"] as JsonObject ?? new JsonObject();
        var taskId = task["id"]?.ToString() ?? string.Empty;

        if (action == "discover")
        {
            var state = _discovery.Scan();
            return (JsonNode.Parse(JsonDefaults.ToJson(state))!.AsObject(), null);
        }

        JobState localJob;
        Task runner;

        if (action == "check")
        {
            var request = JsonDefaults.FromJson<ConnectionCheckRequest>(payload.ToJsonString())
                ?? throw new OnuProvisioningException("La tarea remota no trae datos validos", "REMOTE_PAYLOAD_INVALID", retryable: false);
            request.Validate().ThrowIfInvalid();
            localJob = _jobs.Create("check", request.SafeCopy(), request.Device.Host);
            runner = Task.Run(() => _provisioning.ExecuteCheckAsync(localJob.Id, request, cancellationToken), cancellationToken);
        }
        else if (action == "provision")
        {
            var request = JsonDefaults.FromJson<ProvisionRequest>(payload.ToJsonString())
                ?? throw new OnuProvisioningException("La tarea remota no trae datos validos", "REMOTE_PAYLOAD_INVALID", retryable: false);
            request.Validate().ThrowIfInvalid();
            localJob = _provisioning.CreateProvisionJob(request);
            runner = Task.Run(() => _provisioning.ExecuteProvisionAsync(localJob.Id, request, cancellationToken), cancellationToken);
        }
        else
        {
            throw new OnuProvisioningException("La accion remota no es compatible", "REMOTE_ACTION_UNSUPPORTED", retryable: false);
        }

        (string?, string?, int, string?, string?) lastSignature = default;
        while (!runner.IsCompleted && !cancellationToken.IsCancellationRequested)
        {
            var current = _jobs.Get(localJob.Id) ?? localJob;
            try
            {
                lastSignature = await ReportProgressAsync(taskId, current, lastSignature, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                Update(status => status.LastError = $"No se reporto progreso: {Tr069Worker.ErrorText(exception)}");
            }
            await Task.WhenAny(runner, Task.Delay(2000, cancellationToken)).ConfigureAwait(false);
        }
        await runner.ConfigureAwait(false);

        var finished = _jobs.Get(localJob.Id) ?? localJob;
        try
        {
            await ReportProgressAsync(taskId, finished, lastSignature, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // El resultado final se envia igualmente en el reporte.
        }

        if (finished.Status != "success")
            throw new LocalJobFailedException(
                finished.Error ?? "ONU Studio no pudo completar el trabajo", localJob.Id, finished.Retryable);

        return (new JsonObject
        {
            ["localJobId"] = localJob.Id,
            ["events"] = JsonNode.Parse(JsonDefaults.ToJson(finished.Events)),
            ["result"] = finished.Result?.DeepClone() ?? new JsonObject(),
            ["stage"] = finished.Stage,
        }, localJob.Id);
    }

    private async Task<(string?, string?, int, string?, string?)> ReportProgressAsync(
        string taskId, JobState job, (string?, string?, int, string?, string?) lastSignature, CancellationToken cancellationToken)
    {
        var signature = (job.Stage, job.StageLabel, job.ProgressPercent, job.Status, job.HeartbeatAt);
        if (signature == lastSignature) return signature;

        await _session.Client.SendAsync($"/agent-api/agent/tasks/{taskId}/progress", HttpMethod.Post, new
        {
            stage = string.IsNullOrWhiteSpace(job.Stage) ? "running" : job.Stage,
            stageLabel = string.IsNullOrWhiteSpace(job.StageLabel) ? "Ejecutando en ONU Studio" : job.StageLabel,
            progress = Math.Max(1, job.ProgressPercent),
            localJobId = job.Id,
        }, CloudAuth.Agent, 15, cancellationToken: cancellationToken).ConfigureAwait(false);

        return signature;
    }

    private Task ReportAsync(string taskId, string status, JsonNode? result = null, string? error = null,
        string? errorCode = null, string? localJobId = null, CancellationToken cancellationToken = default) =>
        _session.Client.SendAsync($"/agent-api/agent/tasks/{taskId}/report", HttpMethod.Post, new
        {
            status,
            result,
            errorMessage = error,
            errorCode,
            localJobId,
        }, CloudAuth.Agent, 30, cancellationToken: cancellationToken);
}
