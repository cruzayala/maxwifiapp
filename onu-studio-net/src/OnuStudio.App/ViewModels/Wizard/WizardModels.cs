using System.Collections.ObjectModel;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Threading;
using OnuStudio.Core;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using OnuStudio.Core.Onu;

namespace OnuStudio.App.ViewModels;

// Pequenos modelos que muestran las vistas del asistente.

public sealed class NamedOption
{
    public NamedOption(int id, string name)
    {
        Id = id;
        Name = name;
    }

    public int Id { get; }
    public string Name { get; }
    public override string ToString() => Name;
}

public sealed class OperationOption
{
    public OperationOption(string key, string title, string detail)
    {
        Key = key;
        Title = title;
        Detail = detail;
    }

    public string Key { get; }
    public string Title { get; }
    public string Detail { get; }
}

/// <summary>Una etapa del asistente en la barra superior.</summary>
public sealed class StepChip : ObservableObject
{
    private string _tone = "muted";

    public StepChip(int number, string label)
    {
        Number = number;
        Label = label;
    }

    public int Number { get; }
    public string Label { get; }

    public string Tone
    {
        get => _tone;
        set => SetProperty(ref _tone, value);
    }
}

public sealed class TimelineEntry
{
    public string Time { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public string Status { get; set; } = "running";
}
