package com.ispmax.mobile

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.text.Normalizer
import java.util.UUID

internal const val ONU_AGENTS_PATH = "web:/agent-api/agents"
internal const val ONU_TASKS_PATH = "web:/agent-api/tasks?limit=100"
internal const val ONU_MANIFEST_PATH = "web:/agent-api/downloads/windows/manifest"
internal const val ONU_JOBS_PATH = "web:/provisioning/jobs"
internal const val ONU_IP_CATALOG_PATH = "web:/provisioning/ip-catalog"

internal fun onuActionLabel(action: String) = mapOf("discover" to "Detectar ONU", "check" to "Comprobar conexión", "provision" to "Configurar ONU")[action] ?: action
internal fun onuStatusLabel(status: String) = mapOf("pending" to "En cola", "processing" to "En progreso", "success" to "Completado", "failed" to "Fallido", "cancelled" to "Cancelado")[status] ?: status
internal fun onuAgentStateLabel(agent: JSONObject) = if (!agent.optBoolean("active")) "Revocado" else if (agent.optBoolean("online")) "Conectado" else "Desconectado"
internal fun onuOperationLabel(operation: String) = mapOf("new_client" to "Cliente nuevo", "restore_same_onu" to "Restaurar la misma ONU", "replace_onu" to "Cambiar la ONU", "migrate_pon" to "Mover a otro PON")[operation] ?: operation
internal fun onuJobStatusLabel(job: JSONObject): String {
    if (job.optString("localStatus") == "error") return "Error en el agente"
    return mapOf("in_progress" to "En curso", "waiting_optical" to "Esperando fibra", "partial" to "Incompleta", "failed" to "Fallida", "complete" to "Completada", "cancelled" to "Cancelada")[job.optString("status")] ?: job.optString("status")
}
internal fun onuJobStageLabel(stage: String): String = mapOf(
    "draft" to "Borrador", "onu_detected" to "ONU identificada", "client_validating" to "Validando cliente", "client_selected" to "Cliente seleccionado",
    "wisphub_ready" to "WispHub listo", "client_ready" to "Cliente listo", "waiting_optical" to "Esperando fibra",
    "onu_configured" to "ONU configurada", "olt_discovered" to "Detectada por OLT", "service_ready" to "Servicio listo",
    "local_network" to "Red local preparada", "local_reachability" to "ONU accesible", "local_login" to "Sesión ONU iniciada",
    "local_identity" to "Identidad confirmada", "local_backup_before" to "Respaldo previo", "local_wan" to "WAN configurada",
    "local_tr069" to "TR-069 configurado", "local_wifi" to "WiFi configurado", "local_remote" to "Acceso remoto configurado",
    "local_save" to "Configuración guardada", "local_verify" to "Verificación local", "local_failed" to "Fallo en el agente local",
    "client_partial" to "Alta parcial", "client_failed" to "Fallo en alta", "olt_failed" to "Fallo en OLT", "olt_rolled_back" to "OLT revertida",
    "cancelled" to "Cancelada",
)[stage] ?: stage.replace('_', ' ')

/** Igual que formatPlanName de la web ("3300k/3300k" -> "3.3 Mbps"). */
internal fun onuPlanLabel(raw: String?, empty: String = "Sin plan"): String {
    val name = raw.orEmpty().trim()
    if (name.isEmpty()) return empty
    val match = Regex("^(\\d+(?:\\.\\d+)?)\\s*([kKmM])\\s*[/|]\\s*(\\d+(?:\\.\\d+)?)\\s*([kKmM])\\s*(.*)$").find(name) ?: return name
    fun mbps(value: String, unit: String): String {
        val number = if (unit.lowercase() == "k") value.toDouble() / 1000 else value.toDouble()
        val rounded = Math.round(number * 10) / 10.0
        return if (rounded % 1.0 == 0.0) rounded.toLong().toString() else rounded.toString()
    }
    val (d, du, u, uu, rest) = match.destructured
    val down = mbps(d, du); val up = mbps(u, uu)
    val speed = if (down == up) "$down Mbps" else "$down / $up Mbps"
    val suffix = rest.trim()
    return if (suffix.isEmpty()) speed else "$speed · ${suffix.first().uppercase()}${suffix.drop(1).lowercase()}"
}
internal fun onuOptionLabel(item: JSONObject?): String =
    item?.trText("nombre") ?: item?.trText("name") ?: item?.trText("descripcion") ?: item?.optInt("id")?.takeIf { it != 0 }?.let { "#$it" } ?: ""

internal fun onuSeenAgo(value: String?): String {
    val millis = tr069EpochMillis(value) ?: return "sin registro"
    val seconds = maxOf(0L, Math.round((System.currentTimeMillis() - millis) / 1000.0))
    if (seconds < 60) return "hace $seconds s"
    val minutes = Math.round(seconds / 60.0)
    if (minutes < 60) return "hace $minutes min"
    val hours = Math.round(minutes / 60.0)
    if (hours < 24) return "hace $hours h"
    return "hace ${Math.round(hours / 24.0)} días"
}
internal fun onuTaskDuration(task: JSONObject): String {
    val end = tr069EpochMillis(task.trText("completedAt")) ?: System.currentTimeMillis()
    val start = tr069EpochMillis(task.trText("createdAt")) ?: end
    val seconds = maxOf(0L, (end - start) / 1000)
    return "%02d:%02d".format(seconds / 60, seconds % 60)
}
internal fun onuBytes(value: Long?): String = if (value == null || value == 0L) "" else "${Math.round(value / 1024.0 / 1024.0)} MB"
internal fun onuNormalizeModel(model: String?) = if (model.orEmpty().uppercase().contains("F670")) "F670L" else "EG8141A5"
internal fun onuSsidFromName(name: String?): String {
    val base = Normalizer.normalize(name?.ifBlank { null } ?: "ISP Max", Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "")
    return base.replace(Regex("[^A-Za-z0-9 _-]"), "").trim().take(32).ifBlank { "ISP Max" }
}
internal fun onuGenerateWifiPassword(): String {
    val alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"
    val bytes = ByteArray(12).also { SecureRandom().nextBytes(it) }
    return bytes.joinToString("") { alphabet[(it.toInt() and 0xFF) % alphabet.length].toString() }
}
internal fun onuInferPlanSpeed(label: String?): Double? {
    val text = label.orEmpty().replace(',', '.')
    val match = Regex("(\\d+(?:\\.\\d+)?)\\s*(?:g|gb|m|mb|mbps)?", RegexOption.IGNORE_CASE).find(text) ?: return null
    val value = match.groupValues[1].toDoubleOrNull() ?: return null
    return if (Regex("\\d\\s*g", RegexOption.IGNORE_CASE).containsMatchIn(label.orEmpty())) value * 1000 else value
}
private fun ipValue(ip: String) = ip.split('.').fold(0L) { sum, part -> sum * 256 + (part.toLongOrNull() ?: 0L) }
internal fun onuCompareIp(left: String, right: String) = ipValue(left).compareTo(ipValue(right))
private fun Double.clean(): Any = if (this % 1.0 == 0.0) this.toLong() else this
/** Truthiness de JavaScript para numeros (0 y NaN son "falsos"), para copiar los valores por defecto de la web. */
private fun JSONObject?.truthyInt(key: String): Int? = this?.optInt(key, 0)?.takeIf { it != 0 }

/**
 * Estado y acciones del centro de agentes ONU. Replica onu-provisioner.ts de la web:
 * mismas rutas, mismos pasos del asistente, mismas validaciones y mismos mensajes.
 */
internal class OnuProvisionerController(val vm: MainViewModel, private val scope: CoroutineScope) {
    var agents by mutableStateOf<List<JSONObject>>(emptyList())
    private var loadedTasks by mutableStateOf<List<JSONObject>>(emptyList())
    private val localTasks = mutableStateMapOf<String, JSONObject>()
    val tasks: List<JSONObject> get() {
        val ids = loadedTasks.map { it.optString("id") }.toSet()
        return localTasks.values.filter { it.optString("id") !in ids }.sortedByDescending { it.optString("createdAt") } + loadedTasks
    }
    var selectedAgentId by mutableStateOf<String?>(null)
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var creatingTask by mutableStateOf(false)
    var tab by mutableStateOf("operation")

    // Asistente guiado
    var showOperation by mutableStateOf(false)
    var operationMode by mutableStateOf("provision")
    var wizardStep by mutableIntStateOf(1)
    var wizardBusy by mutableStateOf(false)
    var wizardMessage by mutableStateOf("Preparando el agente")
    var inspectionTaskId by mutableStateOf<String?>(null)
    var provisionTaskId by mutableStateOf<String?>(null)
    var onuInventory by mutableStateOf<JSONObject?>(null)
    var zones by mutableStateOf<List<JSONObject>>(emptyList())
    var plans by mutableStateOf<List<JSONObject>>(emptyList())
    var ipRows by mutableStateOf<List<JSONObject>>(emptyList())
    var ipCatalogLoaded by mutableStateOf(false)
    var ipCatalogStale by mutableStateOf(false)
    var selectedIp by mutableStateOf<JSONObject?>(null)
    var clientResults by mutableStateOf<List<JSONObject>>(emptyList())
    var selectedExistingClient by mutableStateOf<JSONObject?>(null)
    var modelProfiles by mutableStateOf<List<JSONObject>>(emptyList())
    var servicePrepared by mutableStateOf(false)
    var wizardComplete by mutableStateOf(false)

    var serviceOperation by mutableStateOf("new_client")
    var cloudJobId by mutableStateOf("")
    var deviceModel by mutableStateOf("EG8141A5")
    var deviceHost by mutableStateOf("192.168.100.1")
    var deviceUsername by mutableStateOf("telecomadmin")
    var adapterIndex by mutableStateOf<Int?>(null)
    var localAddress by mutableStateOf("192.168.100.10")
    var prefixLength by mutableIntStateOf(24)
    var serviceMode by mutableStateOf("router")
    var vlan by mutableStateOf("101")
    var wanIp by mutableStateOf("")
    var gateway by mutableStateOf("192.168.16.1")
    var primaryDns by mutableStateOf("8.8.8.8")
    var secondaryDns by mutableStateOf("")
    var subnetMask by mutableStateOf("255.255.255.0")
    var mtu by mutableStateOf("1500")
    var wifiSsid by mutableStateOf("")
    var wifiPassword by mutableStateOf("") // Solo en memoria mientras dura el asistente.
    var wifiEnabled by mutableStateOf(true)
    var wifiBroadcast by mutableStateOf(true)
    var wifiWmm by mutableStateOf(true)
    var wifiWps by mutableStateOf(false)
    var wifiMaxClients by mutableStateOf("32")
    var tr069Enabled by mutableStateOf(true)
    var omciEnabled by mutableStateOf(true)
    var remoteAccessEnabled by mutableStateOf(true)
    var replaceConflictingWan by mutableStateOf(true)
    var clientName by mutableStateOf("")
    var clientSearch by mutableStateOf("")
    var zoneId by mutableStateOf<Int?>(null)
    var planId by mutableStateOf<Int?>(null)
    var uploadMbps by mutableStateOf("")
    var downloadMbps by mutableStateOf("")
    var operationReason by mutableStateOf("")
    var targetPonIndex by mutableStateOf("")
    var reservationToken by mutableStateOf("")
    private var wizardIdempotencyKey = ""
    private var guidedTransitionBusy = false

    val selectedAgent: JSONObject? get() = agents.firstOrNull { it.optString("id") == selectedAgentId }
    val operationalAgents: List<JSONObject> get() = agents.filter { it.optBoolean("active") }
    val onlineCount get() = agents.count { it.optBoolean("online") }
    val authorizedCount get() = agents.count { it.optBoolean("active") }
    val revokedCount get() = agents.count { !it.optBoolean("active") }
    val selectedAgentTasks: List<JSONObject> get() = tasks.filter { it.optString("agentId") == selectedAgentId }
    fun taskById(id: String?): JSONObject? = id?.let { wanted -> tasks.firstOrNull { it.optString("id") == wanted } }
    val activeTask: JSONObject? get() {
        val currentId = selectedAgent?.optJSONObject("currentTask")?.trText("id")
        return taskById(currentId) ?: selectedAgentTasks.firstOrNull { it.optString("status") in listOf("pending", "processing") } ?: selectedAgentTasks.firstOrNull()
    }
    val inspectionTask get() = taskById(inspectionTaskId)
    val provisionTask get() = taskById(provisionTaskId)
    val detectedSerial: String get() = (onuInventory?.trPath("identity.serial")?.toString()?.takeIf { it.isNotBlank() }
        ?: selectedAgent?.trPath("discovery.device.serial")?.toString() ?: "").trim().uppercase()
    val matchedModelProfile: JSONObject? get() {
        val model = onuNormalizeModel(onuInventory?.trPath("device.model")?.toString() ?: deviceModel)
        return modelProfiles.firstOrNull { it.optString("model").uppercase() == model.uppercase() }
    }
    fun activeAgentRanges(): List<JSONObject> = selectedAgent?.optJSONObject("capabilities")?.optJSONArray("networkRanges").objects().filter { it.optBoolean("active") }
    fun inventoryFact(path: String, fallback: String = "--"): String = onuInventory?.trPathText(path, fallback) ?: fallback

    fun activity(): List<JSONObject> {
        val events = activeTask?.optJSONObject("result")?.optJSONArray("events").objects()
        if (events.isNotEmpty()) return events.reversed().take(10)
        return selectedAgentTasks.take(8).map { task ->
            JSONObject().put("at", task.optString("updatedAt")).put("step", task.optString("stage"))
                .put("status", when (task.optString("status")) { "failed" -> "error"; "success" -> "success"; else -> "running" })
                .put("message", task.trText("stageLabel") ?: onuActionLabel(task.optString("action")))
        }
    }

    /** Se llama con cada lectura nueva de agentes y trabajos (cada 4 s, igual que la web). */
    fun update(newAgents: List<JSONObject>?, newTasks: List<JSONObject>?) {
        if (newAgents != null) agents = newAgents
        if (newTasks != null) {
            loadedTasks = newTasks
            newTasks.forEach { localTasks.remove(it.optString("id")) }
        }
        val selected = selectedAgentId
        if (newAgents != null && (selected == null || newAgents.none { it.optString("id") == selected && it.optBoolean("active") })) {
            selectedAgentId = (newAgents.firstOrNull { it.optBoolean("online") && it.optBoolean("active") } ?: newAgents.firstOrNull { it.optBoolean("active") })?.optString("id")
            prepareOperationDefaults()
        }
        scope.launch { syncGuidedOperation() }
    }

    fun refreshAll() {
        vm.load(ONU_AGENTS_PATH, true); vm.load(ONU_TASKS_PATH, true); vm.load(ONU_MANIFEST_PATH, true); vm.load(ONU_JOBS_PATH, true)
    }

    fun selectAgent(id: String) {
        val agent = agents.firstOrNull { it.optString("id") == id }
        if (agent?.optBoolean("active") != true) return
        selectedAgentId = id; prepareOperationDefaults()
    }

    fun detectOnu() { scope.launch { createRemoteTask("discover", JSONObject()) } }

    fun openOperation(mode: String = "provision") {
        if (selectedAgent?.optBoolean("online") != true) { error = "Selecciona un agente conectado antes de iniciar una operación"; return }
        operationMode = mode
        resetGuidedOperation()
        prepareOperationDefaults()
        showOperation = true
        scope.launch { startInspection() }
    }

    val canCloseOperation: Boolean get() = !(creatingTask || wizardBusy || provisionTask?.optString("status") == "processing")
    fun closeOperation() { if (canCloseOperation) { showOperation = false; wifiPassword = "" } }

    suspend fun startInspection(forceDiscovery: Boolean = false) {
        val agent = selectedAgent
        if (agent?.optBoolean("online") != true || wizardBusy) return
        wizardBusy = true; error = null; wizardMessage = "Detectando la ONU conectada"
        try {
            prepareOperationDefaults()
            val shouldDiscover = forceDiscovery || agent.optJSONObject("discovery")?.optBoolean("detected") != true
            val task = if (shouldDiscover) createRemoteTask("discover", JSONObject(), refresh = false, announce = false) else dispatchInspectionCheck()
            if (task != null) inspectionTaskId = task.optString("id")
        } finally { wizardBusy = false }
    }

    fun searchClients() {
        val query = clientSearch.trim()
        if (query.length < 2) { error = "Escribe al menos dos caracteres para buscar"; return }
        wizardBusy = true; error = null
        scope.launch {
            try {
                val rows = vm.web("GET", "/provisioning/clients?q=${tr069Encode(query)}").optJSONArray("items").objects()
                clientResults = rows
                if (rows.isEmpty()) notice = "No se encontraron clientes con esa búsqueda"
            } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo buscar el cliente" }
            finally { wizardBusy = false }
        }
    }

    fun selectExistingClient(client: JSONObject) {
        selectedExistingClient = client; clientName = client.optString("nombre")
        zoneId = client.truthyInt("zonaId"); planId = client.truthyInt("planInternetId")
        val upload = client.optDouble("uploadMbps").takeIf { !it.isNaN() && it != 0.0 } ?: onuInferPlanSpeed(client.trText("planInternetName"))
        uploadMbps = upload?.clean()?.toString() ?: ""
        val download = client.optDouble("downloadMbps").takeIf { !it.isNaN() && it != 0.0 } ?: upload
        downloadMbps = download?.clean()?.toString() ?: ""
        wanIp = client.trText("ip") ?: ""; wifiSsid = client.trText("ssidRouterWifi") ?: onuSsidFromName(client.optString("nombre"))
        client.optJSONObject("oltOnu")?.trText("model")?.let { deviceModel = onuNormalizeModel(it) }
        clientResults = emptyList(); applyAutomaticProfile()
    }

    fun chooseServiceOperation(operation: String) {
        if (servicePrepared) { notice = "El expediente ya está protegido. Finaliza esta operación para evitar duplicados."; return }
        serviceOperation = operation; selectedExistingClient = null; clientResults = emptyList()
        clientSearch = ""; operationReason = ""; targetPonIndex = ""
        servicePrepared = false; cloudJobId = ""; reservationToken = ""
        if (operation != "new_client") wanIp = ""
    }

    fun setServiceModeValue(mode: String) {
        if (servicePrepared) { notice = "El perfil Router/Bridge ya forma parte del expediente y no puede cambiarse en este punto."; return }
        serviceMode = mode; servicePrepared = false; applyAutomaticProfile()
    }

    fun onPlanChange() {
        val plan = plans.firstOrNull { it.optInt("id") == planId }
        onuInferPlanSpeed(onuOptionLabel(plan))?.let { uploadMbps = it.clean().toString(); downloadMbps = it.clean().toString() }
    }

    fun chooseIp(row: JSONObject) {
        if (!row.optBoolean("available")) return
        selectedIp = row; wanIp = row.optString("ip")
        val range = selectedAgent?.optJSONObject("capabilities")?.optJSONArray("networkRanges").objects().firstOrNull { it.optString("cidr") == row.optString("cidr") }
        if (range != null) {
            range.truthyInt("vlan")?.let { vlan = it.toString() }
            range.trText("gateway")?.let { gateway = it }
            range.trText("primary_dns")?.let { primaryDns = it }
            secondaryDns = range.trText("secondary_dns") ?: ""
        }
    }

    fun prepareService() {
        if (!validateServiceStep()) return
        wizardBusy = true; error = null; wizardMessage = "Protegiendo cliente, IP y expediente"
        scope.launch {
            try {
                val serial = detectedSerial
                val routed = serviceMode == "router"
                if (serviceOperation == "new_client" && routed && reservationToken.isBlank()) {
                    val cidrs = JSONArray(activeAgentRanges().map { it.optString("cidr") })
                    val reservation = vm.web("POST", "/provisioning/reservations", JSONObject().put("ip", wanIp).put("clientName", clientName).put("serial", serial).put("cidrs", cidrs), ONU_IP_CATALOG_PATH)
                    reservationToken = reservation.trText("token") ?: throw IllegalStateException("El servidor no confirmó la reserva de la IP")
                }
                val client = selectedExistingClient
                val body = JSONObject()
                    .put("source", "onu_studio").put("mode", serviceOperation).put("serviceMode", serviceMode)
                    .put("idempotencyKey", wizardIdempotencyKey).put("reservationToken", reservationToken.ifBlank { null } ?: JSONObject.NULL)
                    .put("clientIdServicio", client?.truthyInt("idServicio") ?: JSONObject.NULL).put("ip", if (routed) wanIp else JSONObject.NULL)
                    .put("clientName", clientName).put("serial", serial).put("model", deviceModel)
                    .put("macAddress", (onuInventory?.trPath("device.mac") ?: onuInventory?.trPath("ethernet.mac"))?.toString()?.takeIf { it.isNotBlank() } ?: JSONObject.NULL)
                    .put("zoneId", zoneId ?: JSONObject.NULL).put("planId", planId ?: JSONObject.NULL)
                    .put("uploadMbps", uploadMbps.toDoubleOrNull()?.clean() ?: JSONObject.NULL).put("downloadMbps", downloadMbps.toDoubleOrNull()?.clean() ?: JSONObject.NULL)
                    .put("vlan", vlan.toIntOrNull() ?: JSONObject.NULL)
                    .put("targetPonIndex", targetPonIndex.ifBlank { null } ?: JSONObject.NULL).put("operationReason", operationReason.ifBlank { null } ?: JSONObject.NULL)
                    .put("configurationManifest", configurationManifest(false))
                val job = vm.web("POST", "/provisioning/jobs", body, ONU_JOBS_PATH)
                cloudJobId = job.trText("id") ?: throw IllegalStateException("El servidor no confirmó el expediente")
                if (serviceOperation == "new_client" && routed) {
                    val provisioned = vm.web("POST", "/client-provisioning", JSONObject().put("jobId", cloudJobId).put("ip", wanIp).put("serviceName", clientName)
                        .put("zoneId", zoneId ?: JSONObject.NULL).put("planId", planId ?: JSONObject.NULL)
                        .put("uploadMbps", uploadMbps.toDoubleOrNull()?.clean() ?: JSONObject.NULL).put("downloadMbps", downloadMbps.toDoubleOrNull()?.clean() ?: JSONObject.NULL), ONU_JOBS_PATH)
                    provisioned.optJSONObject("client")?.truthyInt("idServicio")?.let { notice = "Cliente WispHub #$it y MikroTik verificados" }
                }
                servicePrepared = true
                if (wifiSsid.isBlank() && routed) wifiSsid = onuSsidFromName(clientName)
                if (wifiPassword.isBlank() && routed) wifiPassword = onuGenerateWifiPassword()
                wizardStep = 3; wizardMessage = "Servicio preparado sin duplicar recursos"
            } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo preparar el servicio" }
            finally { wizardBusy = false }
        }
    }

    fun goToReview() {
        if (serviceMode == "router" && wifiEnabled) {
            if (wifiSsid.isBlank()) { error = "Escribe el nombre de la red WiFi"; return }
            if (wifiPassword.length < 8) { error = "La clave WiFi debe tener al menos 8 caracteres"; return }
        }
        error = null; wizardStep = 4
    }

    fun previousWizardStep() {
        val step = wizardStep
        if (step == 3 && servicePrepared) { notice = "Cliente, IP y perfil ya están protegidos. Puedes ajustar el WiFi o continuar a la revisión."; return }
        if (step > 1 && provisionTaskId == null) wizardStep = step - 1
    }

    fun submitOperation() {
        val agent = selectedAgent ?: return
        if (adapterIndex == null) { error = "Selecciona la tarjeta Ethernet que se conectará a la ONU"; return }
        if (!servicePrepared || cloudJobId.isBlank()) { error = "Primero prepara el cliente y el expediente"; return }
        if (serviceMode == "router") {
            if (wanIp.isBlank()) { error = "La IP WAN es obligatoria"; return }
            if (wifiPassword.length < 8) { error = "La clave WiFi debe tener al menos 8 caracteres"; return }
        }
        val routed = serviceMode == "router"
        val device = JSONObject().put("host", deviceHost).put("model", deviceModel).put("username", deviceUsername)
        val localNetwork = JSONObject().put("adapter_index", adapterIndex).put("address", localAddress).put("prefix_length", prefixLength)
        val payload = JSONObject()
            .put("device", device).put("local_network", localNetwork)
            .put("wan", JSONObject().put("vlan_id", vlan.toIntOrNull() ?: JSONObject.NULL).put("priority", 0).put("ip_address", wanIp.ifBlank { "192.168.16.2" })
                .put("subnet_mask", subnetMask).put("gateway", gateway).put("primary_dns", primaryDns)
                .put("secondary_dns", secondaryDns.ifBlank { null } ?: JSONObject.NULL).put("mtu", mtu.toIntOrNull() ?: JSONObject.NULL).put("nat_enabled", routed)
                .put("bind_lan_ports", JSONArray(listOf(1, 2, 3, 4))).put("bind_ssid1", routed))
            .put("wifi", JSONObject().put("enabled", routed && wifiEnabled).put("ssid", wifiSsid.ifBlank { "ISP Max" })
                .put("password", wifiPassword.ifEmpty { "12345678" }).put("broadcast", wifiBroadcast).put("wmm_enabled", wifiWmm)
                .put("wps_enabled", wifiWps).put("max_clients", wifiMaxClients.toIntOrNull() ?: JSONObject.NULL))
            .put("tr069", JSONObject().put("enabled", routed && tr069Enabled).put("acs_url", "http://10.254.250.2:7547/").put("username", "ispmax-cpe")
                .put("connection_request_username", "ispmax-connection-request").put("periodic_inform_interval", 900))
            .put("remote_access", JSONObject().put("enabled", routed && remoteAccessEnabled).put("source", "$gateway/32").put("http", true)
                .put("telnet", false).put("ssh", false).put("ftp", false).put("icmp", false))
            .put("save_configuration", true).put("create_backups", true).put("replace_conflicting_wan", replaceConflictingWan)
            .put("cloud_job_id", cloudJobId.ifBlank { null } ?: JSONObject.NULL).put("service_operation", serviceOperation).put("service_mode", serviceMode)
        scope.launch {
            val created = createRemoteTask("provision", payload, refresh = false, announce = false)
            if (created != null) {
                provisionTaskId = created.optString("id"); wizardMessage = "El agente está configurando y verificando la ONU"
                notice = "Trabajo enviado a ${agent.optString("displayName")}"
            }
        }
    }

    fun cancelTask(task: JSONObject) {
        if (task.optString("status") != "pending") return
        scope.launch {
            try {
                val result = vm.web("POST", "/agent-api/tasks/${tr069Encode(task.optString("id"))}/cancel", JSONObject(), ONU_TASKS_PATH, ONU_AGENTS_PATH)
                if (result.optString("status") != "cancelled") throw IllegalStateException("El servidor no confirmó la cancelación")
                notice = "Trabajo cancelado"
            } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo cancelar el trabajo" }
        }
    }

    fun retryTask(task: JSONObject) {
        scope.launch {
            try {
                val result = vm.web("POST", "/agent-api/tasks/${tr069Encode(task.optString("id"))}/retry", JSONObject(), ONU_TASKS_PATH, ONU_AGENTS_PATH)
                if (result.trText("id") == null) throw IllegalStateException("El servidor no confirmó el reintento")
                localTasks[result.optString("id")] = result
                notice = "Reintento enviado al mismo agente"; tab = "operation"
            } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo reintentar el trabajo" }
        }
    }

    suspend fun renameAgent(agent: JSONObject, displayName: String): Boolean {
        val name = displayName.trim()
        if (name.isEmpty()) { error = "Escribe un nombre para identificar esta PC"; return false }
        return try {
            val result = vm.web("PATCH", "/agent-api/agents/${tr069Encode(agent.optString("id"))}", JSONObject().put("displayName", name), ONU_AGENTS_PATH)
            if (result.optString("displayName") != name) throw IllegalStateException("El servidor no confirmó el nombre")
            notice = "Nombre del agente actualizado"; true
        } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo administrar el agente"; false }
    }

    suspend fun revokeAgent(agent: JSONObject): Boolean = try {
        val result = vm.web("POST", "/agent-api/agents/${tr069Encode(agent.optString("id"))}/revoke", JSONObject(), ONU_AGENTS_PATH, ONU_TASKS_PATH)
        if (!result.optBoolean("ok")) throw IllegalStateException("El servidor no confirmó la revocación")
        notice = "Agente revocado. Esa PC deberá autenticarse de nuevo como administrador."; true
    } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo administrar el agente"; false }

    fun generateWifiDefaults() {
        wifiSsid = onuSsidFromName(clientName.ifBlank { null } ?: selectedExistingClient?.trText("nombre") ?: "ISP Max")
        wifiPassword = onuGenerateWifiPassword()
    }

    fun managementLabel(): String = if (serviceMode == "bridge") "OMCI · perfil Bridge" else if (tr069Enabled) "TR-069 + OMCI automáticos" else "OMCI · TR-069 no certificado"
    fun profileStatusLabel(): String {
        val profile = matchedModelProfile ?: return "Perfil compatible del agente"
        return if (profile.optString("certificationStatus") == "verified") "Perfil certificado" else "Perfil detectado"
    }
    fun serviceMissing(): String {
        val missing = mutableListOf<String>()
        if (detectedSerial.isBlank()) missing += "serial leído de la ONU"
        if (serviceOperation == "new_client") {
            if (clientName.isBlank()) missing += "nombre del cliente"
            if (zoneId == null) missing += "zona"
            if (planId == null) missing += "plan"
            if (serviceMode == "router" && wanIp.isBlank()) missing += "IP disponible"
        } else {
            if (selectedExistingClient == null) missing += "cliente existente"
            else if (operationReason.isBlank()) missing += "motivo técnico"
            if (serviceOperation == "migrate_pon" && selectedExistingClient != null && targetPonIndex.isBlank()) missing += "PON de destino"
        }
        return if (missing.isEmpty()) "" else "Falta: ${missing.joinToString(", ")}"
    }
    fun wifiMissing(): String {
        if (serviceMode != "router" || !wifiEnabled) return ""
        if (wifiSsid.isBlank()) return "Falta: nombre de la red WiFi"
        if (wifiPassword.length < 8) return "Falta: clave WiFi de al menos 8 caracteres"
        return ""
    }

    private suspend fun dispatchInspectionCheck(): JSONObject? {
        prepareOperationDefaults()
        if (adapterIndex == null) { error = "El agente no reportó una tarjeta Ethernet compatible para conectar la ONU"; return null }
        val device = JSONObject().put("host", deviceHost).put("model", deviceModel).put("username", deviceUsername)
        wizardMessage = "Entrando a la ONU y leyendo su configuración"
        return createRemoteTask("check", JSONObject().put("device", device)
            .put("local_network", JSONObject().put("adapter_index", adapterIndex).put("address", localAddress).put("prefix_length", prefixLength))
            .put("prepare_adapter", true), refresh = false, announce = false)
    }

    private suspend fun syncGuidedOperation() {
        if (!showOperation || guidedTransitionBusy) return
        val inspection = inspectionTask
        if (inspection?.optString("status") == "failed") {
            wizardBusy = false; wizardMessage = "La ONU respondió, pero no se pudo completar la lectura"; return
        }
        if (inspection?.optString("status") == "success" && inspection.optString("action") == "discover" && onuInventory == null) {
            val result = inspection.optJSONObject("result")
            val discovery = result?.optJSONObject("result") ?: result ?: JSONObject()
            val device = discovery.optJSONObject("device")
            if (!discovery.optBoolean("detected") || device?.trText("host") == null) {
                wizardBusy = false; wizardMessage = discovery.trText("next_action") ?: "Conecta la ONU por Ethernet y vuelve a intentar"; return
            }
            deviceHost = device.optString("host")
            deviceModel = onuNormalizeModel(device.trText("model") ?: deviceModel)
            if (device.has("adapter_index") && !device.isNull("adapter_index")) device.optString("adapter_index").toDoubleOrNull()?.takeIf { it % 1.0 == 0.0 }?.let { adapterIndex = it.toInt() }
            guidedTransitionBusy = true
            try { dispatchInspectionCheck()?.let { inspectionTaskId = it.optString("id") } } finally { guidedTransitionBusy = false }
            return
        }
        if (inspection?.optString("status") == "success" && inspection.optString("action") == "check" && onuInventory == null) {
            val result = inspection.optJSONObject("result")?.optJSONObject("result") ?: JSONObject()
            val inventory = result.optJSONObject("inventory")
            if (inventory == null) { error = "El agente inició sesión, pero no devolvió el inventario completo de la ONU"; return }
            onuInventory = inventory
            deviceModel = onuNormalizeModel(result.trText("model") ?: inventory.trPath("device.model")?.toString() ?: deviceModel)
            deviceHost = result.trText("host") ?: deviceHost
            deviceUsername = if (deviceModel == "F670L") "admin" else "telecomadmin"
            wizardMessage = "ONU autenticada e inventario leído"
            loadWizardCatalogs()
            applyAutomaticProfile()
            if (operationMode == "check") wizardComplete = true else wizardStep = 2
        }
        when (provisionTask?.optString("status")) {
            "success" -> { wizardComplete = true; wizardMessage = "ONU configurada y verificada correctamente" }
            "failed" -> wizardMessage = "El agente detuvo la configuración para proteger el servicio"
        }
    }

    private suspend fun loadWizardCatalogs() {
        if (zones.isNotEmpty() && modelProfiles.isNotEmpty() && ipCatalogLoaded) return
        wizardBusy = true
        try {
            val cidrs = activeAgentRanges().map { it.optString("cidr") }
            coroutineScope {
                val commercial = async { vm.web("GET", "/provisioning/commercial-catalog") }
                val profiles = async { runCatching { vm.web("GET", "/olt-api/model-profiles").optJSONArray("items").objects() }.getOrElse { if (it is CancellationException) throw it; emptyList() } }
                val ipam = async { if (cidrs.isNotEmpty()) vm.web("POST", "/provisioning/ip-catalog/query", JSONObject().put("cidrs", JSONArray(cidrs))) else vm.web("GET", "/provisioning/ip-catalog") }
                val commercialBody = commercial.await(); val ipamBody = ipam.await()
                zones = commercialBody.optJSONArray("zones").objects(); plans = commercialBody.optJSONArray("plans").objects(); modelProfiles = profiles.await()
                val filtered = filterIpRows(ipamBody.optJSONArray("rows").objects())
                ipRows = filtered; ipCatalogStale = ipamBody.optBoolean("stale"); ipCatalogLoaded = true
                filtered.firstOrNull()?.let { if (wanIp.isBlank()) chooseIp(JSONObject(it.toString()).put("recommended", true)) }
            }
        } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudieron cargar planes e IP disponibles" }
        finally { wizardBusy = false }
    }

    private fun filterIpRows(rows: List<JSONObject>): List<JSONObject> {
        val policies = activeAgentRanges().associateBy { it.optString("cidr") }
        return rows.filter { row ->
            val policy = policies[row.optString("cidr")] ?: return@filter false
            if (!row.optBoolean("available")) return@filter false
            val ip = row.optString("ip")
            if (policy.optJSONArray("exclusions").trStrings().contains(ip) || ip == policy.optString("gateway")) return@filter false
            policy.trText("allocation_start")?.let { if (onuCompareIp(ip, it) < 0) return@filter false }
            policy.trText("allocation_end")?.let { if (onuCompareIp(ip, it) > 0) return@filter false }
            true
        }.sortedWith { a, b ->
            val pa = policies[a.optString("cidr")].truthyInt("priority") ?: 100
            val pb = policies[b.optString("cidr")].truthyInt("priority") ?: 100
            if (pa != pb) pa - pb else onuCompareIp(a.optString("ip"), b.optString("ip"))
        }.mapIndexed { index, row ->
            JSONObject(row.toString()).put("recommended", index == 0).put("rangeName", policies[row.optString("cidr")]?.trText("name") ?: row.optString("cidr"))
        }
    }

    private fun validateServiceStep(): Boolean {
        fun fail(text: String): Boolean { error = text; return false }
        if (detectedSerial.isBlank()) return fail("La operación requiere el serial real leído por el agente")
        if (serviceOperation == "new_client") {
            if (clientName.isBlank()) return fail("Escribe el nombre del cliente")
            if (zoneId == null || planId == null) return fail("Selecciona la zona y el plan")
            if ((uploadMbps.toDoubleOrNull() ?: 0.0) == 0.0 || (downloadMbps.toDoubleOrNull() ?: 0.0) == 0.0) return fail("El plan necesita velocidades válidas")
            if (serviceMode == "router" && activeAgentRanges().isEmpty()) return fail("Configura al menos un rango IP activo en el agente")
            if (serviceMode == "router" && wanIp.isBlank()) return fail("Selecciona una IP disponible")
        } else {
            if (selectedExistingClient == null) return fail("Busca y selecciona el cliente existente")
            if (operationReason.isBlank()) return fail("Indica brevemente el motivo del trabajo")
            if (serviceOperation == "migrate_pon" && targetPonIndex.isBlank()) return fail("Indica el PON de destino")
        }
        return true
    }

    private fun applyAutomaticProfile() {
        val profile = matchedModelProfile
        val selectedCidr = selectedIp?.trText("cidr")
        val range = activeAgentRanges().firstOrNull { selectedCidr == null || it.optString("cidr") == selectedCidr }
        vlan = (range.truthyInt("vlan") ?: profile?.optJSONObject("defaults").truthyInt("vlan") ?: 101).toString()
        range?.trText("gateway")?.let { gateway = it }; range?.trText("primary_dns")?.let { primaryDns = it }
        range?.trText("secondary_dns")?.let { secondaryDns = it }
        omciEnabled = true
        val capabilities = profile?.optJSONArray("capabilities")
        val hasTr069 = capabilities?.objects()?.any { it.optString("channel") == "TR069" && it.optString("status") in listOf("verified", "detected") } ?: true
        tr069Enabled = serviceMode == "router" && hasTr069
        remoteAccessEnabled = serviceMode == "router"
        wifiEnabled = serviceMode == "router"
        if (serviceMode == "bridge") { wifiSsid = ""; wifiPassword = ""; wanIp = "" }
        else if (wanIp.isBlank()) selectedIp?.trText("ip")?.let { wanIp = it }
    }

    private fun configurationManifest(verified: Boolean): JSONObject {
        val routed = serviceMode == "router"
        return JSONObject().put("schemaVersion", 1).put("serviceMode", serviceMode).put("serial", detectedSerial).put("model", deviceModel)
            .put("firmware", inventoryFact("device.software_version", "")).put("vlan", vlan.toIntOrNull() ?: JSONObject.NULL)
            .put("wan", JSONObject().put("mode", if (routed) "static" else "bridge").put("ip", if (routed) wanIp else JSONObject.NULL)
                .put("gateway", if (routed) gateway else JSONObject.NULL).put("nat", routed))
            .put("lanPorts", JSONArray(listOf(1, 2, 3, 4))).put("ssidBinding", routed)
            .put("wifi", if (routed) JSONObject().put("enabled", wifiEnabled).put("ssid", wifiSsid) else JSONObject.NULL)
            .put("channels", JSONObject().put("tr069", tr069Enabled).put("omci", omciEnabled).put("webLocal", true)).put("verified", verified)
    }

    private fun resetGuidedOperation() {
        wizardStep = 1; wizardBusy = false; wizardComplete = false
        inspectionTaskId = null; provisionTaskId = null; onuInventory = null
        servicePrepared = false; selectedExistingClient = null; clientResults = emptyList()
        selectedIp = null; ipRows = emptyList(); ipCatalogLoaded = false; ipCatalogStale = false; error = null; cloudJobId = ""; reservationToken = ""
        serviceOperation = "new_client"; serviceMode = "router"; clientName = ""
        clientSearch = ""; zoneId = null; planId = null; uploadMbps = ""; downloadMbps = ""
        operationReason = ""; targetPonIndex = ""; wifiSsid = ""; wifiPassword = ""
        wizardIdempotencyKey = "web-onu:${UUID.randomUUID()}"
    }

    private suspend fun createRemoteTask(action: String, payload: JSONObject, refresh: Boolean = true, announce: Boolean = true): JSONObject? {
        val agent = selectedAgent
        if (agent?.optBoolean("online") != true) { error = "El agente seleccionado no está conectado"; return null }
        creatingTask = true; error = null
        return try {
            val body = JSONObject().put("agentId", agent.optString("id")).put("action", action).put("payload", payload)
                .put("idempotencyKey", "cloud:${agent.optString("agentId")}:$action:${System.currentTimeMillis()}")
            val task = if (refresh) vm.web("POST", "/agent-api/tasks", body, ONU_TASKS_PATH, ONU_AGENTS_PATH) else vm.web("POST", "/agent-api/tasks", body)
            if (task.trText("id") == null || task.optString("action") != action) throw IllegalStateException("El servidor no confirmó el trabajo")
            localTasks[task.optString("id")] = task
            if (announce) notice = "${onuActionLabel(action)} enviado a ${agent.optString("displayName")}"
            tab = "operation"
            task
        } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) {
            error = failure.message ?: "No se pudo enviar el trabajo al agente"; null
        } finally { creatingTask = false }
    }

    private fun prepareOperationDefaults() {
        val agent = selectedAgent ?: return
        val discovery = agent.optJSONObject("discovery")?.optJSONObject("device")
        val capability = agent.optJSONObject("capabilities") ?: JSONObject()
        val recommended = capability.optJSONObject("recommendedLocalNetwork")
        val range = capability.optJSONArray("networkRanges").objects().firstOrNull { it.optBoolean("active") }
        deviceModel = onuNormalizeModel(discovery?.trText("model") ?: deviceModel)
        deviceHost = discovery?.trText("host") ?: deviceHost
        deviceUsername = if (deviceModel == "F670L") "admin" else "telecomadmin"
        adapterIndex = recommended.truthyInt("adapter_index")
            ?: capability.optJSONArray("adapters").objects().firstOrNull { it.optString("status") == "Up" && it.optBoolean("supported") }.truthyInt("index")
        localAddress = recommended?.trText("address") ?: "192.168.100.10"; prefixLength = recommended.truthyInt("prefix_length") ?: 24
        if (range != null) {
            vlan = (range.truthyInt("vlan") ?: 101).toString(); gateway = range.trText("gateway") ?: "192.168.16.1"
            primaryDns = range.trText("primary_dns") ?: "8.8.8.8"; secondaryDns = range.trText("secondary_dns") ?: ""
        }
    }
}

/** Lista «¿Listo para configurar?» (agent-readiness.ts de la web). */
internal data class OnuReadinessCheck(val key: String, val label: String, val ok: Boolean, val optional: Boolean, val detail: String)
internal fun onuReadinessChecks(agent: JSONObject, latestVersion: String?): List<OnuReadinessCheck> {
    val capabilities = agent.optJSONObject("capabilities")
    val adapters = capabilities?.optJSONArray("adapters").objects()
    val usable = adapters.filter { (!it.has("supported") || it.optBoolean("supported", true)) && it.optString("status").lowercase() == "up" }
    val ranges = capabilities?.optJSONArray("networkRanges").objects().filter { it.optBoolean("active") }
    val version = agent.trText("version")
    val outdated = latestVersion != null && version != null && onuCompareVersions(version, latestVersion) < 0
    val discovery = agent.optJSONObject("discovery"); val device = discovery?.optJSONObject("device")
    val lastSeen = onuSeenAgo(agent.trText("lastSeenAt"))
    return listOf(
        OnuReadinessCheck("online", "Agente conectado", agent.optBoolean("online"), false,
            if (agent.optBoolean("online")) "ONU Studio responde ($lastSeen)." else "Abra ONU Studio en esa PC y verifique que tenga Internet."),
        OnuReadinessCheck("admin", "Permisos de administrador", agent.optBoolean("isAdmin"), false,
            if (agent.optBoolean("isAdmin")) "Puede preparar la tarjeta de red automáticamente." else "Cierre ONU Studio y ábralo con clic derecho → «Ejecutar como administrador»."),
        OnuReadinessCheck("adapter", "Cable Ethernet conectado", usable.isNotEmpty(), false,
            if (usable.isNotEmpty()) "Tarjeta lista: ${usable[0].optString("name")}." else if (adapters.isNotEmpty()) "Conecte el cable de red entre la PC y un puerto LAN de la ONU." else "El agente no reportó tarjetas de red. Reinicie ONU Studio."),
        OnuReadinessCheck("detected", "ONU detectada", discovery?.optBoolean("detected") == true, false,
            if (discovery?.optBoolean("detected") == true) "${device?.trText("model") ?: "ONU"} responde en ${device?.trText("host") ?: "la red local"}."
            else discovery?.trText("next_action") ?: "Encienda la ONU, espere 1 minuto y pulse «Actualizar detección»."),
        OnuReadinessCheck("ranges", "Rangos de IP para clientes", ranges.isNotEmpty(), true,
            if (ranges.isNotEmpty()) "${ranges.size} ${if (ranges.size == 1) "rango activo" else "rangos activos"} para asignar IP." else "Necesario solo en modo Router: configure un rango activo en el agente."),
        OnuReadinessCheck("version", "Versión del agente", !outdated, true,
            if (outdated) "Tiene v$version; hay v$latestVersion. Descárguela con «Descargar agente para Windows»." else "v${version ?: "--"}${if (latestVersion != null) " (al día)" else ""}."),
    )
}
internal fun onuCompareVersions(left: String, right: String): Int {
    fun parts(value: String) = value.replace(Regex("^v", RegexOption.IGNORE_CASE), "").split(Regex("[.-]")).map { Regex("^\\d+").find(it)?.value?.toIntOrNull() ?: 0 }
    val a = parts(left); val b = parts(right)
    for (index in 0 until maxOf(a.size, b.size)) { val diff = (a.getOrNull(index) ?: 0) - (b.getOrNull(index) ?: 0); if (diff != 0) return diff }
    return 0
}
