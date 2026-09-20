using System.ComponentModel;
using System.Windows;

namespace OnuStudio.App;

public partial class MainWindow : Window
{
    public MainWindow() => InitializeComponent();

    /// <summary>Cerrar la ventana no cierra el agente: se esconde junto al reloj.</summary>
    public event Action? CloseRequested;

    protected override void OnClosing(CancelEventArgs e)
    {
        e.Cancel = true;
        CloseRequested?.Invoke();
    }
}
