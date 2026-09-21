using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Playwright;
using OnuStudio.Core.Models;

namespace OnuStudio.Core.Onu;

public interface IOnuController
{
    /// <summary>Entra a la ONU, confirma credenciales y lee el inventario completo.</summary>
    Task<JsonObject> CheckAsync(ProgressCallback emit, CancellationToken cancellationToken = default);

    /// <summary>Configura la ONU y verifica cada cambio contra lo solicitado.</summary>
    Task<JsonObject> ProvisionAsync(ProvisionRequest request, ProgressCallback emit, CancellationToken cancellationToken = default);
}

public static class OnuControllerFactory
{
    public static IOnuController Create(DeviceSettings device, string backupDir, int? adapterIndex = null) => device.Model switch
    {
        _ when AgentRuntime.IsDemo => new Demo.DemoOnuController(device),
        "EG8141A5" => new HuaweiEg8141A5(device, backupDir),
        "F670L" => new ZteF670L(device, backupDir, adapterIndex),
        _ => throw new OnuProvisioningException($"Modelo no compatible: {device.Model}", "ONU_MODEL_UNSUPPORTED", retryable: false),
    };
}

internal static class BrowserJson
{
    /// <summary>Convierte el resultado de un script del panel en JSON manejable.</summary>
    public static async Task<JsonNode?> EvaluateNodeAsync(IBrowserScope scope, string expression)
    {
        var element = await scope.EvaluateAsync<JsonElement>(expression).ConfigureAwait(false);
        return element.ValueKind == JsonValueKind.Undefined ? null : JsonNode.Parse(element.GetRawText());
    }

    public static JsonObject AsObject(JsonNode? node) => node as JsonObject ?? new JsonObject();

    public static JsonArray AsArray(JsonNode? node) => node as JsonArray ?? new JsonArray();
}
