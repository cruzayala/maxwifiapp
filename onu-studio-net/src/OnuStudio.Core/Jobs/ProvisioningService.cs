using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using OnuStudio.Core.Cloud;
using OnuStudio.Core.Models;
using OnuStudio.Core.Net;
using OnuStudio.Core.Onu;
using OnuStudio.Core.Storage;

namespace OnuStudio.Core.Jobs;

/// <summary>
/// Motor local: prepara la tarjeta de red, habla con la ONU y mantiene informado
/// al expediente de ISP Max en cada paso.
/// </summary>
public sealed class ProvisioningService
{
    private readonly JobManager _jobs;
    private readonly CloudSessionManager _session;
    private readonly Func<AgentSettings> _settings;

    public ProvisioningService(JobManager jobs, CloudSessionManager session, Func<AgentSettings> settings)
    {
        _jobs = jobs;
        _session = session;
        _settings = settings;
    }

    // ─────────────────────────── Credenciales ───────────────────────────

    /// <summary>Completa usuario y clave desde los ajustes cuando el formulario los deja vacios.</summary>
    public ConnectionCheckRequest ResolveCredentials(ConnectionCheckRequest request)
    {
        var resolved = request.Clone();
        var settings = _settings();
        resolved.Device.Username = FirstNonEmpty(resolved.Device.Username, settings.UsernameFor(resolved.Device.Model)) ?? string.Empty;
        resolved.Device.Password = FirstNonEmpty(resolved.Device.Password, settings.PasswordFor(resolved.Device.Model));

        RequireDeviceCredentials(resolved.Device);
        return resolved;
    }

    public ProvisionRequest ResolveCredentials(ProvisionRequest request)
    {
        var resolved = request.Clone();
        var settings = _settings();
        resolved.Device.Username = FirstNonEmpty(resolved.Device.Username, settings.UsernameFor(resolved.Device.Model)) ?? string.Empty;
        resolved.Device.Password = FirstNonEmpty(resolved.Device.Password, settings.PasswordFor(resolved.Device.Model));
        RequireDeviceCredentials(resolved.Device);

        if (resolved.Tr069.Enabled)
        {
            resolved.Tr069.Password = FirstNonEmpty(resolved.Tr069.Password, settings.Tr069Password);
            resolved.Tr069.ConnectionRequestPassword = FirstNonEmpty(resolved.Tr069.ConnectionRequestPassword, settings.ConnectionRequestPassword);
            if (AgentRuntime.IsDemo)
            {
                if (string.IsNullOrEmpty(resolved.Tr069.Password)) resolved.Tr069.Password = "modo-de-prueba";
                if (string.IsNullOrEmpty(resolved.Tr069.ConnectionRequestPassword)) resolved.Tr069.ConnectionRequestPassword = "modo-de-prueba";
            }
            if (string.IsNullOrEmpty(resolved.Tr069.Password) || string.IsNullOrEmpty(resolved.Tr069.ConnectionRequestPassword))
                throw new OnuProvisioningException("Configura las credenciales TR-069 protegidas en Ajustes del agente");
        }
        return resolved;
    }

    private static void RequireDeviceCredentials(DeviceSettings device)
    {
        if (AgentRuntime.IsDemo)
        {
            if (string.IsNullOrEmpty(device.Password)) device.Password = "modo-de-prueba";
            return;
        }
        if (string.IsNullOrWhiteSpace(device.Username))
            throw new OnuProvisioningException("Ingresa el usuario tecnico de la ONU", "ONU_USERNAME_REQUIRED", retryable: false);
        if (string.IsNullOrEmpty(device.Password))
            throw new OnuProvisioningException(
                device.Model == "F670L"
                    ? "Ingresa la contrasena tecnica de la ZTE o guardala en Ajustes del agente"
                    : "Ingresa la contrasena tecnica de la ONU o guardala en Ajustes del agente");
    }

    private static string? FirstNonEmpty(string? value, string? fallback) =>
        string.IsNullOrEmpty(value) ? fallback : value;

    // ─────────────────────────── Red local ───────────────────────────

    public JsonObject PrepareNetwork(string jobId, DeviceSettings device, LocalNetworkSettings local, ProgressCallback? emit = null)
    {
        var report = emit ?? ((step, status, message) => _jobs.Event(jobId, step, status, message));

        if (AgentRuntime.IsDemo)
        {
            report("network", "running", "Preparando la tarjeta Ethernet");
            AgentRuntime.SimulateDelayAsync(500).GetAwaiter().GetResult();
            report("network", "success", $"IP {local.Address}/{local.PrefixLength} ya configurada en Ethernet (modo de prueba)");
            report("reachability", "success", $"ONU accesible en {device.Host} (3 ms)");
            return new JsonObject
            {
                ["adapter"] = new JsonObject { ["changed"] = false, ["name"] = "Ethernet (modo de prueba)", ["address"] = local.Address },
                ["probe"] = new JsonObject { ["reachable"] = true, ["latency_ms"] = 3, ["port"] = 80 },
            };
        }

        report("network", "running", "Preparando la tarjeta Ethernet");
        var change = NetworkTools.EnsureIpv4Address(local.AdapterIndex, local.Address, local.PrefixLength);
        var label = change.Changed ? "agregada" : "ya configurada";
        report("network", "success", $"IP {change.Address}/{change.PrefixLength} {label} en {change.Adapter.Name}");

        var probe = NetworkTools.ProbeHttp(device.Host, adapterIndex: local.AdapterIndex);
        if (!probe.Reachable) throw new NetworkException($"La ONU {device.Host} no responde por HTTP");
        report("reachability", "success", $"ONU accesible en {device.Host} ({probe.LatencyMs} ms)");

        return new JsonObject
        {
            ["adapter"] = new JsonObject
            {
                ["changed"] = change.Changed,
                ["name"] = change.Adapter.Name,
                ["index"] = change.Adapter.Index,
                ["address"] = change.Address,
                ["prefix_length"] = change.PrefixLength,
            },
            ["probe"] = new JsonObject
            {
                ["reachable"] = probe.Reachable,
                ["latency_ms"] = probe.LatencyMs,
                ["port"] = probe.Port,
            },
        };
    }

    // ─────────────────────────── Comprobacion ───────────────────────────

    public async Task ExecuteCheckAsync(string jobId, ConnectionCheckRequest rawRequest, CancellationToken cancellationToken = default)
    {
        _jobs.SetRunning(jobId);
        try
        {
            var request = ResolveCredentials(rawRequest);
            var network = request.PrepareAdapter
                ? PrepareNetwork(jobId, request.Device, request.LocalNetwork)
                : new JsonObject
                {
                    ["probe"] = new JsonObject
                    {
                        ["reachable"] = NetworkTools.ProbeHttp(request.Device.Host, adapterIndex: request.LocalNetwork.AdapterIndex).Reachable,
                    },
                };

            if (network["probe"]?["reachable"]?.GetValue<bool>() != true)
                throw new NetworkException($"La ONU {request.Device.Host} no responde por HTTP");

            var controller = OnuControllerFactory.Create(request.Device, AppPaths.BackupDir, request.LocalNetwork.AdapterIndex);
            var result = await controller.CheckAsync(
                (step, status, message) => _jobs.Event(jobId, step, status, message), cancellationToken).ConfigureAwait(false);
            result["network"] = network;
            _jobs.SetSuccess(jobId, result);
        }
        catch (Exception exception)
        {
            var message = SanitizeError(exception, rawRequest.Device.Password);
            _jobs.Event(jobId, "failed", "error", message);
            _jobs.SetError(jobId, message, exception is not OnuProvisioningException { Retryable: false });
        }
    }

    // ─────────────────────────── Aprovisionamiento ───────────────────────────

    public JobState CreateProvisionJob(ProvisionRequest request) =>
        _jobs.Create("provision", request.SafeCopy(), request.Device.Host, request.Wan.IpAddress, request.Wifi.Ssid);

    public async Task ExecuteProvisionAsync(string jobId, ProvisionRequest rawRequest, CancellationToken cancellationToken = default)
    {
        _jobs.SetRunning(jobId);
        var request = rawRequest;
        string? lastCompletedStep = null;
        var cloudWarningReported = false;

        try
        {
            request = ResolveCredentials(rawRequest);

            void Emit(string step, string status, string message)
            {
                _jobs.Event(jobId, step, status, message);
                if (status != "success") return;

                lastCompletedStep = step;
                var warning = UpdateCloudCheckpoint(request, $"local_{step}", "running", lastCompletedStep, message);
                if (warning is not null && !cloudWarningReported)
                {
                    _jobs.Event(jobId, "cloud", "warning", $"Railway no recibio el checkpoint: {warning}");
                    cloudWarningReported = true;
                }
            }

            var network = PrepareNetwork(jobId, request.Device, request.LocalNetwork, Emit);
            var controller = OnuControllerFactory.Create(request.Device, AppPaths.BackupDir, request.LocalNetwork.AdapterIndex);
            var result = await controller.ProvisionAsync(request, Emit, cancellationToken).ConfigureAwait(false);
            result["network"] = network;

            if (!string.IsNullOrWhiteSpace(request.CloudJobId))
                await SyncCloudCompletionAsync(jobId, request, result, cancellationToken).ConfigureAwait(false);

            _jobs.SetSuccess(jobId, result);
        }
        catch (Exception exception)
        {
            var safeError = SanitizeError(exception, request.Device.Password, request.Wifi.Password,
                request.Tr069.Password, request.Tr069.ConnectionRequestPassword);
            var (code, retryable) = ErrorMetadata(exception);

            _jobs.Event(jobId, "failed", "error", safeError);
            var warning = UpdateCloudCheckpoint(request, "local_failed", "error", lastCompletedStep, safeError,
                status: "partial", errorCode: code, retryable: retryable);
            if (warning is not null)
                _jobs.Event(jobId, "cloud", "warning", $"El error local no se pudo reportar a Railway: {warning}");

            _jobs.SetError(jobId, safeError, retryable);
        }
    }

    private async Task SyncCloudCompletionAsync(string jobId, ProvisionRequest request, JsonObject result, CancellationToken cancellationToken)
    {
        if (AgentRuntime.IsDemo)
        {
            await AgentRuntime.SimulateDelayAsync(500, cancellationToken).ConfigureAwait(false);
            _jobs.Event(jobId, "cloud", "success", "Expediente actualizado en ISP Max (modo de prueba)");
            _jobs.Event(jobId, "cloud_inventory", "success", "Inventario final sincronizado (modo de prueba)");
            return;
        }
        var restoredService = request.ServiceOperation == "restore_same_onu";
        try
        {
            await _session.Client.SendAsync($"/provisioning/jobs/{request.CloudJobId}", HttpMethod.Patch, new
            {
                status = restoredService ? "complete" : "waiting_optical",
                stage = restoredService ? "service_restored" : "onu_configured",
                cutoverStatus = restoredService ? "not_required" : "waiting_new_onu",
                agentVersion = AppInfo.Version,
                agentHeartbeat = true,
                localStatus = "success",
                lastCompletedStep = "verify",
                retryable = false,
                errorCode = (string?)null,
                errorMessage = (string?)null,
                configurationManifest = BuildConfigurationManifest(request, result),
                step = new
                {
                    status = "complete",
                    message = restoredService
                        ? "Servicio existente restaurado sin modificar WispHub, facturas, IP ni MikroTik"
                        : "WAN, WiFi y acceso remoto configurados por ONU Studio",
                    source = "onu_studio",
                },
            }, CloudAuth.User, cancellationToken: cancellationToken).ConfigureAwait(false);
            _jobs.Event(jobId, "cloud", "success", "Expediente actualizado en ISP Max");
        }
        catch (Exception exception)
        {
            _jobs.Event(jobId, "cloud", "warning", $"Configurada localmente; no se actualizo Railway: {exception.Message}");
        }

        try
        {
            await _session.Client.SendAsync($"/provisioning/jobs/{request.CloudJobId}/onu-inventory", HttpMethod.Post, new
            {
                phase = "post_provision",
                agentVersion = AppInfo.Version,
                host = request.Device.Host,
                inventory = result["inventory"],
            }, CloudAuth.User, cancellationToken: cancellationToken).ConfigureAwait(false);
            _jobs.Event(jobId, "cloud_inventory", "success", "Inventario final sincronizado con OLT e ISP Max");
        }
        catch (Exception exception)
        {
            _jobs.Event(jobId, "cloud_inventory", "warning", $"Inventario local guardado; sincronizacion pendiente: {exception.Message}");
        }
    }

    /// <summary>Avisa a ISP Max en cada paso para que el expediente siga vivo aunque falle algo.</summary>
    private string? UpdateCloudCheckpoint(
        ProvisionRequest request, string stage, string localStatus, string? lastCompletedStep,
        string message, string status = "in_progress", string? errorCode = null, bool? retryable = null)
    {
        if (string.IsNullOrWhiteSpace(request.CloudJobId) || !_session.Current.Connected || AgentRuntime.IsDemo) return null;

        var stepKey = stage.StartsWith("local_", StringComparison.Ordinal) ? stage["local_".Length..] : stage;
        var bounds = JobManager.Stages.GetValueOrDefault(stepKey, (0, 0));

        try
        {
            _session.Client.SendAsync($"/provisioning/jobs/{request.CloudJobId}", HttpMethod.Patch, new
            {
                status,
                stage,
                agentVersion = AppInfo.Version,
                agentHeartbeat = true,
                localStatus,
                lastCompletedStep,
                errorMessage = localStatus == "error" ? message : null,
                errorCode,
                retryable,
                progressPercent = localStatus == "error" ? bounds.Item1 : bounds.Item2,
                stageLabel = message,
                step = new
                {
                    status = localStatus == "error" ? "error" : "complete",
                    message = message.Length > 500 ? message[..500] : message,
                    source = "onu_studio",
                },
            }, CloudAuth.User, 8).GetAwaiter().GetResult();
            return null;
        }
        catch (Exception exception)
        {
            var detail = exception.Message;
            return detail.Length > 500 ? detail[..500] : detail;
        }
    }

    /// <summary>Resumen de lo aplicado, que ISP Max guarda junto al cliente.</summary>
    public static JsonObject BuildConfigurationManifest(ProvisionRequest request, JsonObject? result)
    {
        var inventory = result?["inventory"] as JsonObject ?? new JsonObject();
        var identity = inventory["identity"] as JsonObject ?? new JsonObject();
        var device = inventory["device"] as JsonObject ?? new JsonObject();
        var routed = request.ServiceMode == "router";
        var verified = result?["verification"] is not null;

        return new JsonObject
        {
            ["schemaVersion"] = 1,
            ["serviceMode"] = request.ServiceMode,
            ["serial"] = identity["serial"]?.DeepClone() ?? result?["serial"]?.DeepClone(),
            ["model"] = device["model"]?.DeepClone() ?? request.Device.Model,
            ["firmware"] = device["software_version"]?.DeepClone(),
            ["vlan"] = request.Wan.VlanId,
            ["wan"] = new JsonObject
            {
                ["mode"] = routed ? "static" : "bridge",
                ["ip"] = routed ? request.Wan.IpAddress : null,
                ["gateway"] = routed ? request.Wan.Gateway : null,
                ["nat"] = routed && request.Wan.NatEnabled,
            },
            ["lanPorts"] = HuaweiEg8141A5.ToJsonArray(request.Wan.BindLanPorts.Select(port => port.ToString())),
            ["ssidBinding"] = routed && request.Wan.BindSsid1,
            ["wifi"] = routed
                ? new JsonObject { ["enabled"] = request.Wifi.Enabled, ["ssid"] = request.Wifi.Ssid }
                : null,
            ["channels"] = new JsonObject
            {
                ["tr069"] = routed && request.Tr069.Enabled,
                ["omci"] = true,
                ["webLocal"] = true,
            },
            ["verified"] = verified,
            ["verifiedAt"] = verified ? Clock.UtcNow() : null,
        };
    }

    // ─────────────────────────── Errores ───────────────────────────

    /// <summary>Quita cualquier clave del texto antes de mostrarlo o enviarlo.</summary>
    public static string SanitizeError(Exception exception, params string?[] secrets)
    {
        var message = exception.Message;
        foreach (var secret in secrets)
            if (!string.IsNullOrEmpty(secret)) message = message.Replace(secret, "***", StringComparison.Ordinal);

        message = Regex.Replace(message, @"(password|passwd|contrasena|clave|secret)\s*[:=]\s*[^\s,;]+", "$1=***", RegexOptions.IgnoreCase);
        message = Regex.Replace(message, @"\s+", " ").Trim();
        return message.Length > 1000 ? message[..1000] : message;
    }

    public static (string Code, bool Retryable) ErrorMetadata(Exception exception)
    {
        if (exception is OnuProvisioningException provisioning) return (provisioning.Code, provisioning.Retryable);
        var name = Regex.Replace(exception.GetType().Name.ToUpperInvariant(), "[^A-Z0-9]+", "_").Trim('_');
        return (string.IsNullOrEmpty(name) ? "LOCAL_PROVISIONING_ERROR" : name[..Math.Min(80, name.Length)], true);
    }
}
