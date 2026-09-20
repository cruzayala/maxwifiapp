using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using OnuStudio.Core.Models;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Jobs;

/// <summary>
/// Lleva el estado de cada trabajo y lo publica: la barra de progreso, la linea de
/// tiempo y el expediente de la nube leen de aqui.
/// </summary>
public sealed class JobManager
{
    /// <summary>Rango de porcentaje que ocupa cada paso, para que la barra avance parejo.</summary>
    public static readonly IReadOnlyDictionary<string, (int Start, int End)> Stages = new Dictionary<string, (int, int)>
    {
        ["network"] = (4, 10), ["reachability"] = (12, 12), ["login"] = (15, 22), ["identity"] = (24, 24),
        ["backup_before"] = (26, 30), ["lan_ports"] = (32, 40), ["wan"] = (42, 55), ["bridge"] = (42, 55),
        ["tr069"] = (57, 67), ["wifi"] = (69, 79), ["time"] = (80, 82), ["remote"] = (83, 88),
        ["save"] = (89, 92), ["verify"] = (93, 98), ["backup_after"] = (98, 99),
        ["cloud"] = (99, 100), ["cloud_inventory"] = (99, 100), ["rollback"] = (90, 98),
    };

    private readonly JobStore _store;
    private readonly ConcurrentDictionary<string, JobState> _jobs = new();

    public JobManager(JobStore store) => _store = store;

    /// <summary>Se dispara en cada cambio; la ventana se actualiza sola al escucharlo.</summary>
    public event Action<JobState>? JobChanged;

    public JobState Create(string kind, object safeRequest, string deviceHost, string? wanIp = null, string? ssid = null)
    {
        var job = new JobState
        {
            Id = Guid.NewGuid().ToString("N"),
            Kind = kind,
            Status = "queued",
            CreatedAt = Clock.UtcNow(),
            HeartbeatAt = Clock.UtcNow(),
            DeviceHost = deviceHost,
            WanIp = wanIp,
            Ssid = ssid,
        };
        _jobs[job.Id] = job;
        _store.Create(job, safeRequest);
        JobChanged?.Invoke(job.Snapshot());
        return job.Snapshot();
    }

    public JobState? Get(string jobId) =>
        _jobs.TryGetValue(jobId, out var job) ? job.Snapshot() : _store.Get(jobId);

    public JobState Mutate(string jobId, Action<JobState> change)
    {
        if (!_jobs.TryGetValue(jobId, out var job)) throw new KeyNotFoundException($"Trabajo {jobId} no encontrado");

        JobState snapshot;
        lock (job)
        {
            change(job);
            switch (job.Status)
            {
                case "running":
                    job.HeartbeatAt ??= Clock.UtcNow();
                    break;
                case "success":
                    job.ProgressPercent = 100;
                    job.Stage = "complete";
                    job.StageLabel = "Configuracion verificada";
                    job.Retryable = false;
                    job.HeartbeatAt = Clock.UtcNow();
                    break;
                case "error":
                    job.HeartbeatAt = Clock.UtcNow();
                    break;
            }
            snapshot = job.Snapshot();
        }
        _store.Update(snapshot);
        JobChanged?.Invoke(snapshot);
        return snapshot;
    }

    public void SetRunning(string jobId) => Mutate(jobId, job =>
    {
        job.Status = "running";
        job.StartedAt = Clock.UtcNow();
    });

    public void SetSuccess(string jobId, JsonObject? result) => Mutate(jobId, job =>
    {
        job.Status = "success";
        job.Result = result;
        job.FinishedAt = Clock.UtcNow();
    });

    public void SetError(string jobId, string error, bool retryable = true) => Mutate(jobId, job =>
    {
        job.Status = "error";
        job.Error = error;
        job.Retryable = retryable;
        job.FinishedAt = Clock.UtcNow();
    });

    /// <summary>Agrega un paso a la linea de tiempo y mueve el progreso.</summary>
    public void Event(string jobId, string step, string status, string message)
    {
        if (!_jobs.TryGetValue(jobId, out var job)) return;

        JobState snapshot;
        lock (job)
        {
            var entry = new JobEvent { At = Clock.UtcNow(), Step = step, Status = status, Message = message };
            job.Events.Add(entry);
            if (Stages.TryGetValue(step, out var bounds))
            {
                var candidate = status is "success" or "warning" ? bounds.End : bounds.Start;
                job.ProgressPercent = Math.Max(job.ProgressPercent, candidate);
            }
            job.Stage = step;
            job.StageLabel = message;
            job.HeartbeatAt = entry.At;
            if (status == "success") job.LastCompletedStep = step;
            snapshot = job.Snapshot();
        }
        _store.Update(snapshot);
        JobChanged?.Invoke(snapshot);
    }

    public List<JobState> Recent(int limit = 20) => _store.Recent(limit);
}
