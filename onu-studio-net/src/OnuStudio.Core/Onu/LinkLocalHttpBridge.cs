using System.Net;
using System.Net.Sockets;

namespace OnuStudio.Core.Onu;

/// <summary>
/// La ZTE F670L a veces solo responde por IPv6 link-local, que el navegador interno
/// no sabe abrir. Este puente publica ese panel en 127.0.0.1 mientras dura el trabajo.
/// </summary>
public sealed class LinkLocalHttpBridge : IDisposable
{
    private readonly string _host;
    private readonly int _adapterIndex;
    private readonly int _remotePort;
    private readonly TcpListener _listener;
    private readonly CancellationTokenSource _stop = new();
    private Task? _accepting;

    public LinkLocalHttpBridge(string host, int adapterIndex, int remotePort = 80)
    {
        _host = host.Split('%')[0];
        _adapterIndex = adapterIndex;
        _remotePort = remotePort;
        _listener = new TcpListener(IPAddress.Loopback, 0);
        _listener.Start();
        Url = $"http://127.0.0.1:{((IPEndPoint)_listener.LocalEndpoint).Port}";
        _accepting = Task.Run(AcceptLoopAsync);
    }

    public string Url { get; }

    private async Task AcceptLoopAsync()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener.AcceptTcpClientAsync(_stop.Token).ConfigureAwait(false);
            }
            catch (Exception)
            {
                return;
            }
            _ = Task.Run(() => ForwardAsync(client));
        }
    }

    private async Task ForwardAsync(TcpClient client)
    {
        using (client)
        {
            using var upstream = new Socket(AddressFamily.InterNetworkV6, SocketType.Stream, ProtocolType.Tcp);
            try
            {
                var address = IPAddress.Parse(_host);
                address.ScopeId = _adapterIndex;
                await upstream.ConnectAsync(new IPEndPoint(address, _remotePort), _stop.Token).ConfigureAwait(false);

                using var upstreamStream = new NetworkStream(upstream, ownsSocket: false);
                var clientStream = client.GetStream();
                var pump = Task.WhenAny(
                    clientStream.CopyToAsync(upstreamStream, _stop.Token),
                    upstreamStream.CopyToAsync(clientStream, _stop.Token));
                await pump.ConfigureAwait(false);
            }
            catch (Exception)
            {
                // La conexion se cerro: el navegador abrira otra si la necesita.
            }
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        try { _listener.Stop(); } catch (Exception) { /* ya detenido */ }
        try { _accepting?.Wait(TimeSpan.FromSeconds(2)); } catch (Exception) { /* fin normal */ }
        _stop.Dispose();
    }
}
