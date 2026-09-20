namespace OnuStudio.Core.Onu;

/// <summary>
/// Error del aprovisionamiento local. El codigo viaja a ISP Max y "retryable"
/// decide si el tecnico puede reintentar sin deshacer nada.
/// </summary>
public sealed class OnuProvisioningException : Exception
{
    public OnuProvisioningException(
        string message,
        string code = "ONU_PROVISIONING_ERROR",
        bool retryable = true,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Retryable = retryable;
    }

    public string Code { get; }
    public bool Retryable { get; }
}

/// <summary>Avisos de progreso: paso, estado y texto que ve el tecnico.</summary>
public delegate void ProgressCallback(string step, string status, string message);

/// <summary>
/// Playwright reporta los tiempos de espera con distintos tipos segun la version,
/// asi que se reconocen por su forma y no por el tipo exacto.
/// </summary>
internal static class PlaywrightErrors
{
    public static bool IsTimeout(Exception exception) =>
        exception is TimeoutException
        || exception.GetType().Name.Contains("Timeout", StringComparison.Ordinal)
        || exception.Message.Contains("Timeout", StringComparison.OrdinalIgnoreCase)
        || exception.Message.Contains("exceeded", StringComparison.OrdinalIgnoreCase);
}
