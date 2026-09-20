using System.Text.Json;
using System.Text.Json.Serialization;

namespace OnuStudio.Core;

/// <summary>
/// Serializacion compartida. Los nombres van en snake_case porque es el formato que
/// ya hablan el backend de ISP Max y las tareas remotas del agente.
/// </summary>
public static class JsonDefaults
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    /// <summary>Para el API de ISP Max, que usa camelCase en el cuerpo de las peticiones.</summary>
    public static readonly JsonSerializerOptions CamelCase = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string ToJson<T>(T value, bool camelCase = false) =>
        JsonSerializer.Serialize(value, camelCase ? CamelCase : Options);

    public static T? FromJson<T>(string json, bool camelCase = false) =>
        string.IsNullOrWhiteSpace(json) ? default : JsonSerializer.Deserialize<T>(json, camelCase ? CamelCase : Options);
}
