namespace OnuStudio.Core.Onu;

/// <summary>Un modelo de ONU que ONU Studio sabe configurar.</summary>
/// <param name="Model">Nombre que el panel muestra como titulo (ProductName).</param>
/// <param name="Vendor">Marca para mostrar al tecnico.</param>
/// <param name="Family">huawei-v5 o zte-v7: define el controlador que lo configura.</param>
/// <param name="WriteCertified">true cuando la configuracion completa ya se probo en campo.</param>
public sealed record OnuModel(string Model, string Vendor, string Family, bool WriteCertified)
{
    public string Label => $"{Vendor} {Model}";
}

/// <summary>
/// Catalogo unico de modelos compatibles. La HS8545M5 comparte el panel web V5R019 de la
/// EG8141A5 (mismos campos de WAN, WiFi, LAN, TR-069 y respaldo); solo cambia el control
/// de acceso remoto, que el controlador detecta en el propio menu del equipo.
/// </summary>
public static class OnuModels
{
    public const string HuaweiV5 = "huawei-v5";
    public const string ZteV7 = "zte-v7";

    public static IReadOnlyList<OnuModel> All { get; } = new[]
    {
        new OnuModel("EG8141A5", "Huawei / Novatech", HuaweiV5, WriteCertified: true),
        // Certificada en campo el 24/09/2026: dos instalaciones completas verificadas (WAN,
        // TR-069, WiFi, control de acceso preciso, guardado).
        new OnuModel("HS8545M5", "Huawei", HuaweiV5, WriteCertified: true),
        new OnuModel("F670L", "ZTE", ZteV7, WriteCertified: true),
    };

    public static IReadOnlyList<string> Names { get; } = All.Select(item => item.Model).ToArray();

    public static OnuModel? Find(string? model) =>
        All.FirstOrDefault(item => string.Equals(item.Model, model?.Trim(), StringComparison.OrdinalIgnoreCase));

    public static bool IsSupported(string? model) => Find(model) is not null;

    public static bool IsHuawei(string? model) => Find(model)?.Family == HuaweiV5;

    public static string Label(string? model) => Find(model)?.Label ?? (model ?? string.Empty);

    /// <summary>Nombre canonico del modelo soportado (respeta mayusculas del catalogo), o null.</summary>
    public static string? Canonical(string? model) => Find(model)?.Model;
}
