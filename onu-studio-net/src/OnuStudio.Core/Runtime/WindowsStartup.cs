using System.Diagnostics;

namespace OnuStudio.Core;

public sealed record StartupStatus(bool Supported, bool Enabled, string? Reason, string? ExecutablePath);

/// <summary>
/// "Iniciar con Windows": registra una tarea programada para que el agente quede
/// disponible para ISP Max en cuanto el tecnico entra a su sesion.
/// </summary>
public static class WindowsStartup
{
    public const string TaskName = "ISP Max ONU Studio Agent";

    public static string? ExecutablePath()
    {
        var path = Environment.ProcessPath;
        return string.IsNullOrWhiteSpace(path) ? null : Path.GetFullPath(path);
    }

    public static StartupStatus Status()
    {
        if (!OperatingSystem.IsWindows())
            return new StartupStatus(false, false, "Disponible solo en Windows", null);

        var executable = ExecutablePath();
        var supported = executable is not null && executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase);
        var query = Run(new[] { "/Query", "/TN", TaskName, "/FO", "LIST" });

        return new StartupStatus(
            supported,
            query.ExitCode == 0,
            supported ? null : "Disponible al ejecutar la aplicacion instalada",
            executable);
    }

    public static StartupStatus Set(bool enabled)
    {
        var status = Status();
        if (!status.Supported) throw new InvalidOperationException(status.Reason ?? "No disponible en este equipo");

        ProcessResult result;
        if (enabled)
        {
            var command = $"\"{status.ExecutablePath}\" --background";
            result = Run(new[] { "/Create", "/TN", TaskName, "/TR", command, "/SC", "ONLOGON", "/RL", "HIGHEST", "/F" });
        }
        else
        {
            result = Run(new[] { "/Delete", "/TN", TaskName, "/F" });
            if (result.ExitCode != 0 && !status.Enabled) return Status();
        }

        if (result.ExitCode != 0)
        {
            var detail = string.IsNullOrWhiteSpace(result.Error) ? result.Output : result.Error;
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(detail) ? "Windows rechazo la operacion" : detail.Trim());
        }
        return Status();
    }

    private sealed record ProcessResult(int ExitCode, string Output, string Error);

    private static ProcessResult Run(IReadOnlyList<string> arguments)
    {
        try
        {
            var info = new ProcessStartInfo("schtasks")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            foreach (var argument in arguments) info.ArgumentList.Add(argument);

            using var process = Process.Start(info);
            if (process is null) return new ProcessResult(-1, string.Empty, "No se pudo consultar el Programador de tareas");
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit(15000);
            return new ProcessResult(process.ExitCode, output, error);
        }
        catch (Exception exception)
        {
            return new ProcessResult(-1, string.Empty, exception.Message);
        }
    }
}
