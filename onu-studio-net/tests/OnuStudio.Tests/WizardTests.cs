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
}
