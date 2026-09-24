using Xunit;

namespace OnuStudio.Tests;

/// <summary>Reglas de la interfaz que conviene fijar: nombres WiFi y claves generadas.</summary>
public class WizardHelperTests
{
    [Fact]
    public void ElNombreWifiQuitaAcentosYEspacios() =>
        Assert.Equal("Jose-Perez-Casa", App.ViewModels.WizardViewModel.SuggestSsid("José Pérez  Casa"));

    [Fact]
    public void ElNombreWifiNuncaQuedaVacio() =>
        Assert.Equal("ISPMax", App.ViewModels.WizardViewModel.SuggestSsid("   "));

    [Fact]
    public void LaClaveGeneradaEsValidaParaWpa2()
    {
        var password = App.ViewModels.WizardViewModel.GeneratePassword();
        Assert.InRange(password.Length, 8, 63);
        Assert.DoesNotContain(password, character => character is 'l' or 'I' or 'O' or '0' or '1');
    }

    [Fact]
    public void LaDeteccionNoPisaElModeloConfirmadoAlLeer()
    {
        // La HS8545M5 no dice su modelo antes de entrar: la deteccion sugiere EG8141A5.
        var (model, confirmed) = App.ViewModels.WizardViewModel.ModelAfterDiscovery("HS8545M5", "HS8545M5", null, "EG8141A5");
        Assert.Equal("HS8545M5", model);
        Assert.Equal("HS8545M5", confirmed);
    }

    [Fact]
    public void SinLecturaSeUsaLaSugerenciaDeLaDeteccion() =>
        Assert.Equal("EG8141A5", App.ViewModels.WizardViewModel.ModelAfterDiscovery("F670L", null, null, "EG8141A5").Model);

    [Fact]
    public void OtraOnuQueAnunciaSuModeloReemplazaLaConfirmada()
    {
        var (model, confirmed) = App.ViewModels.WizardViewModel.ModelAfterDiscovery("HS8545M5", "HS8545M5", "F670L", "F670L");
        Assert.Equal("F670L", model);
        Assert.Null(confirmed);
    }
}
