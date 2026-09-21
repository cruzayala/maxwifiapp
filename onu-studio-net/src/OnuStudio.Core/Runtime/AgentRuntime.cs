namespace OnuStudio.Core;

/// <summary>
/// Modo en que corre el agente. En modo de prueba todo funciona igual para el
/// tecnico, pero la ONU y la nube son simuladas: sirve para aprender a usar el
/// programa o revisarlo sin tocar equipos ni clientes reales.
/// </summary>
public static class AgentRuntime
{
    private static bool _demo = ReadDemoFromEnvironment();

    public static bool IsDemo => _demo;

    /// <summary>Se decide una sola vez, al arrancar, antes de abrir cualquier archivo.</summary>
    public static void EnableDemo() => _demo = true;

    private static bool ReadDemoFromEnvironment() =>
        (Environment.GetEnvironmentVariable("ONU_DEMO") ?? string.Empty).Trim().ToLowerInvariant() is "1" or "true" or "yes" or "si";

    /// <summary>Pausa breve para que la simulacion se sienta como el trabajo real.</summary>
    public static Task SimulateDelayAsync(int milliseconds, CancellationToken cancellationToken = default) =>
        Task.Delay(IsDemo ? milliseconds : 0, cancellationToken);
}
