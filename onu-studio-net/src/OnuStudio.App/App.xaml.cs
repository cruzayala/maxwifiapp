using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Threading;
using OnuStudio.App.ViewModels;
using OnuStudio.Core;
using Forms = System.Windows.Forms;

namespace OnuStudio.App;

public partial class App : Application
{
    public const string DemoArgument = "--demo";

    private static Mutex? _singleInstance;

    private AgentHost? _host;
    private MainWindow? _window;
    private Forms.NotifyIcon? _tray;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // El modo de prueba se decide antes de leer cualquier carpeta: usa datos aparte.
        if (e.Args.Any(argument => argument.Equals(DemoArgument, StringComparison.OrdinalIgnoreCase)))
            AgentRuntime.EnableDemo();

        // Una sola instancia (y otra aparte para el modo de prueba, que puede convivir).
        var mutexName = AgentRuntime.IsDemo ? "ISPMax.OnuStudio.Demo" : "ISPMax.OnuStudio.SingleInstance";
        _singleInstance = new Mutex(true, mutexName, out var isNew);
        if (!isNew)
        {
            MessageBox.Show(
                AgentRuntime.IsDemo
                    ? "El modo de prueba ya esta abierto."
                    : "ONU Studio ya esta abierto. Busca su icono junto al reloj de Windows.",
                "ONU Studio", MessageBoxButton.OK, MessageBoxImage.Information);
            Shutdown();
            return;
        }

        DispatcherUnhandledException += OnUnhandledException;
        AppDomain.CurrentDomain.UnhandledException += (_, args) =>
            LogFatal(args.ExceptionObject as Exception ?? new Exception("Error desconocido"));

        _host = new AgentHost();
        var background = e.Args.Any(argument => argument.Equals("--background", StringComparison.OrdinalIgnoreCase));

        var viewModel = new MainViewModel(_host);
        _window = new MainWindow { DataContext = viewModel };
        if (AgentRuntime.IsDemo)
        {
            // La prueba no queda en segundo plano: cerrar la ventana la termina.
            _window.Title = "ONU Studio | Modo de prueba";
            _window.CloseRequested += QuitAsync;
            _window.Show();
            _ = _host.StartAsync();
            return;
        }
        _window.CloseRequested += HideToTray;

        SetupTray(viewModel);

        if (!background) _window.Show();

        _ = _host.StartAsync();
    }

    private void SetupTray(MainViewModel viewModel)
    {
        _tray = new Forms.NotifyIcon
        {
            Visible = true,
            Text = "ONU Studio | ISP Max",
            Icon = LoadTrayIcon(),
        };

        var menu = new Forms.ContextMenuStrip();
        menu.Items.Add("Abrir ONU Studio", null, (_, _) => ShowWindow());
        menu.Items.Add("Buscar una ONU ahora", null, (_, _) =>
        {
            var host = _host;
            if (host is not null) _ = Task.Run(() => host.Discovery.Scan());
            ShowWindow();
        });
        menu.Items.Add(new Forms.ToolStripSeparator());
        menu.Items.Add("Salir", null, (_, _) => QuitAsync());
        _tray.ContextMenuStrip = menu;
        _tray.DoubleClick += (_, _) => ShowWindow();
    }

    private static Icon LoadTrayIcon()
    {
        try
        {
            var path = Path.Combine(AppContext.BaseDirectory, "Assets", "onu-studio.ico");
            if (File.Exists(path)) return new Icon(path);
        }
        catch (Exception)
        {
            // Sin icono propio se usa el de la aplicacion.
        }
        return SystemIcons.Application;
    }

    private void ShowWindow()
    {
        if (_window is null) return;
        _window.Show();
        _window.WindowState = WindowState.Normal;
        _window.Activate();
    }

    /// <summary>Al cerrar la ventana el agente sigue disponible para ISP Max.</summary>
    private void HideToTray()
    {
        _window?.Hide();
        _tray?.ShowBalloonTip(3000, "ONU Studio sigue trabajando",
            "El agente queda disponible para ISP Max. Usa este icono para abrirlo o salir.",
            Forms.ToolTipIcon.Info);
    }

    private async void QuitAsync()
    {
        if (_tray is not null)
        {
            _tray.Visible = false;
            _tray.Dispose();
            _tray = null;
        }
        if (_host is not null) await _host.DisposeAsync();
        Shutdown();
    }

    private void OnUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
    {
        LogFatal(e.Exception);
        MessageBox.Show(
            $"Ocurrio un error inesperado:\n\n{e.Exception.Message}\n\nEl detalle quedo en el registro del agente.",
            "ONU Studio", MessageBoxButton.OK, MessageBoxImage.Warning);
        e.Handled = true;
    }

    private static void LogFatal(Exception exception)
    {
        try
        {
            AppPaths.EnsureRuntimeDirectories();
            var path = Path.Combine(AppPaths.LogDir, "onu-studio.log");
            File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {exception}{Environment.NewLine}");
        }
        catch (Exception)
        {
            // Si no se puede escribir el registro, no hay nada mas que hacer.
        }
    }
}
