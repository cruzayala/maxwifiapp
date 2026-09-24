using System.Threading;
using System.Windows;
using OnuStudio.App.Views;
using OnuStudio.App.Views.Wizard;
using Xunit;

namespace OnuStudio.Tests;

/// <summary>
/// Las pantallas resuelven sus estilos y conversores al cargarse: un recurso que falte
/// no lo detecta el compilador y tumba el programa al abrir. Aqui se cargan con el tema real.
/// </summary>
public class ViewLoadTests
{
    private static readonly object Gate = new();

    private static void OnSta(Action action)
    {
        Exception? failure = null;
        var thread = new Thread(() =>
        {
            try
            {
                lock (Gate)
                {
                    if (Application.Current is null) new OnuStudio.App.App().InitializeComponent();
                    action();
                }
            }
            catch (Exception exception)
            {
                failure = exception;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (failure is not null) throw failure;
    }

    private static void Load(FrameworkElement view)
    {
        view.Measure(new Size(900, 3000));
        view.Arrange(new Rect(0, 0, 900, 3000));
        view.UpdateLayout();
    }

    [Fact]
    public void ElModoRapidoCargaConElTema() => OnSta(() => Load(new ExpressStepView()));

    [Fact]
    public void ElAsistenteCompletoCargaConElTema() => OnSta(() => Load(new WizardView()));
}
