using System.Collections.ObjectModel;
using OnuStudio.Core;
using OnuStudio.Core.Models;

namespace OnuStudio.App.ViewModels;

public sealed class HistoryEntry
{
    public HistoryEntry(JobState job)
    {
        Id = job.Id;
        Kind = job.Kind == "provision" ? "Configuracion" : "Comprobacion";
        Status = job.Status;
        Host = job.DeviceHost;
        WanIp = job.WanIp ?? "—";
        Ssid = job.Ssid ?? "—";
        Error = job.Error ?? string.Empty;
        Stage = job.StageLabel;

        When = DateTime.TryParse(job.CreatedAt, out var created)
            ? created.ToLocalTime().ToString("dd/MM/yyyy HH:mm")
            : job.CreatedAt;

        Duration = DateTime.TryParse(job.StartedAt, out var started) && DateTime.TryParse(job.FinishedAt, out var finished)
            ? $"{Math.Max(1, (int)(finished - started).TotalSeconds)} s"
            : "—";
    }

    public string Id { get; }
    public string Kind { get; }
    public string Status { get; }
    public string Host { get; }
    public string WanIp { get; }
    public string Ssid { get; }
    public string When { get; }
    public string Duration { get; }
    public string Error { get; }
    public string Stage { get; }

    public string StatusLabel => Status switch
    {
        "success" => "Completado",
        "error" => "Con error",
        "running" => "En curso",
        _ => "En cola",
    };

    public string StatusTone => Status switch
    {
        "success" => "ok",
        "error" => "error",
        "running" => "info",
        _ => "muted",
    };

    public bool HasError => !string.IsNullOrWhiteSpace(Error);

    /// <summary>Solo tiene sentido retomar una configuracion que fallo y se puede repetir.</summary>
    public bool CanRetry { get; init; }
}

/// <summary>Lo que se hizo desde esta computadora, con su resultado.</summary>
public sealed class HistoryViewModel : ObservableObject
{
    private readonly AgentHost _host;

    public HistoryViewModel(AgentHost host)
    {
        _host = host;
        RefreshCommand = new RelayCommand(Refresh);
        RetryCommand = new RelayCommand(parameter =>
        {
            if (parameter is HistoryEntry entry) RetryRequested?.Invoke(entry.Id);
        });
        Refresh();
    }

    public ObservableCollection<HistoryEntry> Entries { get; } = new();
    public RelayCommand RefreshCommand { get; }
    public RelayCommand RetryCommand { get; }

    /// <summary>Pide abrir el asistente con los datos del trabajo elegido.</summary>
    public event Action<string>? RetryRequested;

    private bool _isEmpty = true;
    public bool IsEmpty
    {
        get => _isEmpty;
        private set => SetProperty(ref _isEmpty, value);
    }

    public void Refresh()
    {
        Entries.Clear();
        foreach (var job in _host.Jobs.Recent(50))
            Entries.Add(new HistoryEntry(job)
            {
                CanRetry = job.Kind == "provision" && job.Status == "error" && job.Retryable,
            });
        IsEmpty = Entries.Count == 0;
    }
}
