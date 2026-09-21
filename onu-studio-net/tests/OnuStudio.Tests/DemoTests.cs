using OnuStudio.Core.Demo;
using OnuStudio.Core.Models;
using Xunit;

namespace OnuStudio.Tests;

/// <summary>
/// El modo de prueba debe recorrer el mismo camino que una ONU real. Estas pruebas
/// usan las piezas simuladas directamente, sin activar el modo global.
/// </summary>
public class DemoTests
{
    [Fact]
    public async Task LaOnuSimuladaSeLeeConSerialEInventario()
    {
        var onu = new DemoOnuController(new DeviceSettings { Host = "192.168.100.1", Model = "EG8141A5" });
        var steps = new List<(string Step, string Status)>();

        var result = await onu.CheckAsync((step, status, _) => steps.Add((step, status)));

        Assert.Equal(DemoData.Serial, result["serial"]?.ToString());
        Assert.NotNull(result["inventory"]);
        Assert.Contains(("identity", "success"), steps);
    }

    [Fact]
    public async Task ElAprovisionamientoSimuladoRecorreTodosLosPasosYVerifica()
    {
        var onu = new DemoOnuController(new DeviceSettings { Host = "192.168.100.1", Model = "EG8141A5" });
        var request = new ProvisionRequest
        {
            Wan = new WanSettings { IpAddress = "192.168.16.41", VlanId = 101 },
            Wifi = new WifiSettings { Ssid = "Cliente_Prueba", Password = "clave-segura-123" },
        };
        var steps = new List<(string Step, string Status)>();

        var result = await onu.ProvisionAsync(request, (step, status, _) => steps.Add((step, status)));

        foreach (var step in new[] { "login", "backup_before", "lan_ports", "wan", "wifi", "save", "verify", "backup_after" })
            Assert.Contains((step, "success"), steps);
        Assert.DoesNotContain(steps, entry => entry.Status == "error");
        Assert.NotNull(result["inventory"]);
        Assert.True(result["demo"]?.GetValue<bool>());
    }

    [Fact]
    public void ElCatalogoDePruebaRecomiendaLaPrimeraIpLibre()
    {
        var catalog = DemoData.IpCatalog();

        Assert.NotEmpty(catalog.Rows);
        Assert.All(catalog.Rows, row => Assert.True(row.IsFree));
        Assert.Same(catalog.Rows[0], catalog.Recommended);
        Assert.True(catalog.Recommended!.Recommended);
    }

    [Fact]
    public void LaDeteccionDePruebaEncuentraUnaHuaweiCompatible()
    {
        var state = DemoData.Discovery();

        Assert.True(state.Detected);
        Assert.Equal("EG8141A5", state.Device?.SuggestedModel);
    }

    [Fact]
    public void LasIpDePruebaCaenEnElRangoQueTraeLaBaseNueva()
    {
        foreach (var row in DemoData.IpCatalog().Rows)
            Assert.True(OnuStudio.Core.Ipv4.CidrContains("192.168.16.0/24", OnuStudio.Core.Ipv4.Parse(row.Ip)));
    }
}
