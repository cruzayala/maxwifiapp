using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows.Controls;
using System.Windows.Data;
using OnuStudio.App.Controls;
using Xunit;

namespace OnuStudio.Tests;

public class PasswordBoxTests
{
    private sealed class Form : INotifyPropertyChanged
    {
        private string _password = string.Empty;
        public string Password
        {
            get => _password;
            set { _password = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Password))); }
        }
        public event PropertyChangedEventHandler? PropertyChanged;
    }

    private static void OnSta(Action action)
    {
        Exception? failure = null;
        var thread = new Thread(() => { try { action(); } catch (Exception exception) { failure = exception; } });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        thread.Join();
        if (failure is not null) throw failure;
    }

    [Fact]
    public void LaClaveEscritaLlegaAlFormularioAunqueEmpieceVacia() => OnSta(() =>
    {
        var form = new Form();
        var box = new PasswordBox { DataContext = form };
        BindingOperations.SetBinding(box, PasswordBoxAssistant.BoundPasswordProperty,
            new Binding(nameof(Form.Password)) { Mode = BindingMode.TwoWay });

        box.Password = "clave-escrita";

        Assert.Equal("clave-escrita", form.Password);
    });

    [Fact]
    public void BorrarLaClaveEnElFormularioLimpiaElCuadro() => OnSta(() =>
    {
        var form = new Form { Password = "antes" };
        var box = new PasswordBox { DataContext = form };
        BindingOperations.SetBinding(box, PasswordBoxAssistant.BoundPasswordProperty,
            new Binding(nameof(Form.Password)) { Mode = BindingMode.TwoWay });
        Assert.Equal("antes", box.Password);

        form.Password = string.Empty;

        Assert.Equal(string.Empty, box.Password);
    });
}
