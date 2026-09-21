using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;

namespace OnuStudio.App;

public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    /// <summary>Cerrar la ventana no cierra el agente: se esconde junto al reloj.</summary>
    public event Action? CloseRequested;

    /// <summary>
    /// Navega aunque el menu se marque sin clic (teclado o lectores de pantalla);
    /// el comando del boton solo se dispara con clic.
    /// </summary>
    private void OnNavigationChecked(object sender, RoutedEventArgs e)
    {
        if (e.OriginalSource is not RadioButton { Command: { } command } button) return;
        if (command.CanExecute(button.CommandParameter)) command.Execute(button.CommandParameter);
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        CloseRequested?.Invoke();
    }
}
