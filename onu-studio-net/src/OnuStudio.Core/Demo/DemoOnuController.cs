using System.Text.Json.Nodes;
using OnuStudio.Core.Models;
using OnuStudio.Core.Onu;

namespace OnuStudio.Core.Demo;

/// <summary>
/// ONU simulada: recorre los mismos pasos, con los mismos mensajes y el mismo
/// avance que una Huawei real, pero sin tocar ningun equipo.
/// </summary>
public sealed class DemoOnuController : IOnuController
{
    private readonly DeviceSettings _device;

    public DemoOnuController(DeviceSettings device) => _device = device;

    public async Task<JsonObject> CheckAsync(ProgressCallback emit, CancellationToken cancellationToken = default)
    {
        emit("login", "running", "Abriendo la administracion de la ONU (modo de prueba)");
        await AgentRuntime.SimulateDelayAsync(900, cancellationToken).ConfigureAwait(false);
        emit("inventory_device", "success", "Modelo, firmware y estado GPON leidos");
        await AgentRuntime.SimulateDelayAsync(500, cancellationToken).ConfigureAwait(false);
        emit("inventory_optical", "success", "Telemetria optica leida");
        await AgentRuntime.SimulateDelayAsync(400, cancellationToken).ConfigureAwait(false);
        emit("login", "success", "ONU detectada: EG8141A5");
        emit("identity", "success", $"Serial GPON detectado: {DemoData.Serial}");

        return new JsonObject
        {
            ["model"] = "EG8141A5",
            ["host"] = _device.Host,
            ["authenticated"] = true,
            ["serial"] = DemoData.Serial,
            ["serial_raw"] = "485754439EC8CEAF",
            ["authentication_mode"] = "sn_password",
            ["inventory"] = DemoData.Inventory(),
            ["demo"] = true,
        };
    }

    public async Task<JsonObject> ProvisionAsync(ProvisionRequest request, ProgressCallback emit, CancellationToken cancellationToken = default)
    {
        var routed = request.ServiceMode == "router";

        async Task Step(string step, string running, string done, int milliseconds)
        {
            emit(step, "running", running);
            await AgentRuntime.SimulateDelayAsync(milliseconds, cancellationToken).ConfigureAwait(false);
            emit(step, "success", done);
        }

        await Step("login", $"Autenticando en {_device.Host}", "Sesion tecnica iniciada en EG8141A5", 800).ConfigureAwait(false);
        emit("identity", "success", $"Serial GPON confirmado: {DemoData.Serial}");
        if (request.CreateBackups)
            await Step("backup_before", "Creando respaldo antes de modificar", "Respaldo previo guardado", 700).ConfigureAwait(false);
        await Step("lan_ports", "Preparando puertos LAN", $"Puertos LAN listos: {string.Join(", ", request.Wan.BindLanPorts.Select(port => $"LAN{port}"))}", 700).ConfigureAwait(false);
        await Step(routed ? "wan" : "bridge", routed ? "Configurando IPoE, VLAN e IP estatica" : "Configurando bridge y VLAN",
            $"Servicio 1_TR069_INTERNET_R_VID_{request.Wan.VlanId} configurado", 1100).ConfigureAwait(false);
        if (routed && request.Tr069.Enabled)
            await Step("tr069", "Configurando ACS y autenticacion TR-069", "ACS y reporte periodico configurados", 800).ConfigureAwait(false);
        if (routed)
        {
            await Step("wifi", "Configurando SSID y seguridad WPA2", $"WiFi {request.Wifi.Ssid} configurado", 900).ConfigureAwait(false);
            await Step("remote", "Aplicando acceso remoto HTTP restringido", $"HTTP permitido desde {request.RemoteAccess.Source}", 600).ConfigureAwait(false);
        }
        if (request.SaveConfiguration)
            await Step("save", "Guardando configuracion en memoria permanente", "Configuracion guardada sin reiniciar", 600).ConfigureAwait(false);
        await Step("verify", "Verificando WAN, WiFi y acceso remoto", "Todos los valores coinciden con el perfil solicitado", 1000).ConfigureAwait(false);
        if (request.CreateBackups)
            await Step("backup_after", "Creando respaldo final", "Respaldo final guardado", 500).ConfigureAwait(false);

        return new JsonObject
        {
            ["model"] = "EG8141A5",
            ["host"] = request.Device.Host,
            ["serial"] = DemoData.Serial,
            ["verification"] = new JsonObject { ["wan"] = true, ["tr069"] = true, ["wifi"] = true, ["remote_access"] = true },
            ["inventory"] = DemoData.Inventory(request.Wifi.Ssid, request.Wan.IpAddress),
            ["backups"] = new JsonObject { ["before"] = null, ["after"] = null },
            ["demo"] = true,
        };
    }
}
