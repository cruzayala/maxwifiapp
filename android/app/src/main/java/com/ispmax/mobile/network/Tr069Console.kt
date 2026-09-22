package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.pow

private val TR069_TABS = listOf(
    "overview" to "Resumen", "fiber" to "Fibra", "wifi" to "WiFi", "lan" to "LAN", "wan" to "WAN", "clients" to "Clientes",
    "diagnostics" to "Diagnósticos", "security" to "Seguridad", "system" to "Sistema", "history" to "Historial", "parameters" to "Parámetros",
)
/** Igual que la web: las rutas de parametros con estos nombres nunca se muestran en claro. */
private val TR069_SECRET_PATH = Regex("password|passphrase|secret|credential|key", RegexOption.IGNORE_CASE)
private const val TR069_PARAMETER_PAGE = 100

private fun tr069TaskStatusLabel(status: String) = mapOf("pending" to "En cola", "processing" to "Ejecutando", "success" to "Completada", "failed" to "Con error", "cancelled" to "Cancelada")[status] ?: status
private fun tr069CapabilityLabel(status: String?) = mapOf("verified" to "Verificado", "detected" to "Detectado", "failed" to "Con fallo", "blocked" to "Bloqueado")[status ?: ""] ?: "Sin datos"
private fun tr069LinkLabel(status: String?): String {
    val key = status.orEmpty().lowercase()
    return when { key == "up" -> "activo"; key == "down" || key == "nolink" -> "caído"; !status.isNullOrBlank() -> status; else -> "desconocido" }
}
private fun tr069DiagnosticState(state: Any?): String {
    val key = state?.toString().orEmpty().lowercase()
    return when { key.isBlank() || key == "none" || key == "null" -> "Sin ejecutar"; key == "complete" || key == "completed" -> "Completado"; key == "requested" -> "En curso"; key.startsWith("error") -> "Con error"; else -> state.toString() }
}
private fun tr069Uptime(seconds: Double?): String {
    val total = maxOf(0L, floor(seconds ?: 0.0).toLong())
    val days = total / 86400; val hours = (total % 86400) / 3600; val minutes = (total % 3600) / 60
    return if (days > 0) "$days d $hours h" else if (hours > 0) "$hours h $minutes min" else "$minutes min"
}
private fun tr069Bytes(value: Double?): String {
    val bytes = value ?: 0.0
    if (bytes <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB")
    val index = minOf(units.size - 1, floor(ln(bytes) / ln(1024.0)).toInt()).coerceAtLeast(0)
    val scaled = bytes / 1024.0.pow(index)
    return if (index == 0) "${scaled.toLong()} ${units[index]}" else String.format(java.util.Locale.US, "%.1f %s", scaled, units[index])
}
private fun JSONObject.num(key: String): Double? = if (!has(key) || isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
private fun Double?.plain(): String = when { this == null -> "--"; this % 1.0 == 0.0 -> this.toLong().toString(); else -> this.toString() }

private data class LanPortForm(val port: Int, val status: String, val speed: String, val duplex: String, val enabled: Boolean, val flowControl: Any?, val l3Enabled: Any?)

/**
 * Consola TR-069 / OMCI de una ONU. Replica src/app/pages/olt/tr069-console de la web con las mismas rutas
 * (/tr069-api), validaciones, bloqueos, explicaciones y confirmaciones. Solo administradores (igual que la web
 * y el servidor). La clave WiFi solo vive en memoria del formulario y se borra al enviar la tarea.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun Tr069Console(serial: String, vm: MainViewModel, pages: Map<String, PageState>, onClose: () -> Unit) {
    val app by vm.app.collectAsState()
    val isAdmin = tr069HasRole(app.user?.optString("role"), "admin")
    val encoded = tr069Encode(serial.trim())
    val route = "/tr069-api/devices/$encoded"
    val devicePath = "web:$route"
    val telemetryPath = "web:$route/telemetry?limit=96"
    val scope = rememberCoroutineScope()

    LaunchedEffect(devicePath, isAdmin) { if (isAdmin && serial.isNotBlank()) vm.load(devicePath, true) }
    val state = pages[devicePath] ?: PageState(loading = true)
    val device = state.body
    val snapshot = device?.optJSONObject("snapshot") ?: JSONObject()
    val channels = device?.optJSONObject("managementChannels")
    val tr069 = channels?.optJSONObject("tr069")
    val omci = channels?.optJSONObject("omci")
    val remoteOnline = tr069?.optBoolean("online") == true
    val remoteRegistered = tr069?.optBoolean("available") == true
    val omciOnline = omci?.optBoolean("available") == true
    val capabilities = device?.optJSONObject("capabilities")
    val actions = capabilities?.optJSONArray("actions").objects()
    val tasks = device?.optJSONArray("tasks").objects()
    fun capability(action: String) = actions.firstOrNull { it.optString("name") == action }
    fun blocked(action: String): Boolean {
        if (action == "reboot" && omciOnline) return false
        if (action != "reboot" && !remoteOnline) return true
        return capability(action)?.optBoolean("executable") != true
    }
    fun actionLabel(task: JSONObject) = capability(task.optString("action"))?.trText("label") ?: task.optString("action").replace('_', ' ')

    var saving by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var confirm by remember { mutableStateOf<Triple<String, String, () -> Unit>?>(null) }
    var tab by rememberSaveable { mutableStateOf("overview") }

    // Formularios (se rellenan con la ultima lectura, igual que populate() de la web).
    var wifiSsid by remember { mutableStateOf("") }
    var wifiPassword by remember { mutableStateOf("") } // Nunca en rememberSaveable ni en cache.
    var wifiEnabled by remember { mutableStateOf(true) }
    var wifiBroadcast by remember { mutableStateOf(true) }
    var wifiChannel by remember { mutableIntStateOf(0) }
    var wifiPower by remember { mutableIntStateOf(100) }
    var wifiStandard by remember { mutableStateOf("11bgn") }
    var wifiMaxClients by remember { mutableStateOf("32") }
    var wifiWmm by remember { mutableStateOf(true) }
    var wifiWps by remember { mutableStateOf(false) }
    var dhcpEnabled by remember { mutableStateOf(true) }
    var dhcpMin by remember { mutableStateOf("") }; var dhcpMax by remember { mutableStateOf("") }
    var dhcpMask by remember { mutableStateOf("") }; var dhcpRouter by remember { mutableStateOf("") }
    var dhcpDns by remember { mutableStateOf("") }; var dhcpLease by remember { mutableStateOf("86400") }
    var timeEnabled by remember { mutableStateOf(true) }
    var ntp1 by remember { mutableStateOf("pool.ntp.org") }; var ntp2 by remember { mutableStateOf("") }
    var timeZone by remember { mutableStateOf("-04:00") }; var timeZoneName by remember { mutableStateOf("America/Santo_Domingo") }
    var informInterval by remember { mutableStateOf("300") }
    var diagHost by remember { mutableStateOf("8.8.8.8") }
    var downloadUrl by remember { mutableStateOf("") }; var uploadUrl by remember { mutableStateOf("") }
    val lanPorts = remember { mutableStateListOf<LanPortForm>() }

    val populateKey = device?.let { "${it.optString("id")}|${snapshot.optString("collectedAt")}|${it.optBoolean("enabled")}" }
    LaunchedEffect(populateKey) {
        if (device == null) return@LaunchedEffect
        val wifi = snapshot.optJSONObject("wifi") ?: JSONObject()
        wifiSsid = wifi.trText("ssid") ?: ""; wifiEnabled = wifi.optBoolean("enabled"); wifiBroadcast = wifi.optBoolean("broadcast", true)
        wifiChannel = wifi.num("channel")?.toInt() ?: 0; wifiPower = wifi.num("transmitPower")?.toInt() ?: 100
        wifiStandard = wifi.trText("standard") ?: "11bgn"; wifiMaxClients = (wifi.num("maxClients")?.toInt() ?: 32).toString()
        wifiWmm = wifi.optBoolean("wmm"); wifiWps = wifi.optBoolean("wps")
        val dhcp = snapshot.optJSONObject("dhcp") ?: JSONObject()
        dhcpEnabled = dhcp.optBoolean("enabled"); dhcpMin = dhcp.trText("minAddress") ?: ""; dhcpMax = dhcp.trText("maxAddress") ?: ""
        dhcpMask = dhcp.trText("subnetMask") ?: ""; dhcpRouter = dhcp.trText("router") ?: ""; dhcpDns = dhcp.trText("dnsServers") ?: ""
        dhcpLease = (dhcp.num("leaseTime")?.toLong()?.takeIf { it > 0 } ?: 86400L).toString()
        val system = snapshot.optJSONObject("system") ?: JSONObject()
        timeEnabled = system.optBoolean("timeEnabled"); timeZone = system.trText("timeZone") ?: "-04:00"
        timeZoneName = system.trText("timeZoneName") ?: "America/Santo_Domingo"
        informInterval = (system.num("periodicInformInterval")?.toLong()?.takeIf { it > 0 } ?: 300L).toString()
        lanPorts.clear()
        snapshot.optJSONArray("lanPorts").objects().forEach { port ->
            lanPorts += LanPortForm(port.optInt("port"), port.optString("status"), port.trText("speed") ?: "Auto", port.trText("duplex") ?: "Auto",
                port.optBoolean("enabled"), if (port.has("flowControl")) port.opt("flowControl") else null, if (port.has("l3Enabled")) port.opt("l3Enabled") else null)
        }
    }

    // Igual que la web: mientras haya tareas en cola o ejecutando se vuelve a leer cada 3 s.
    val hasActive = tasks.any { it.optString("status") in listOf("pending", "processing") }
    LaunchedEffect(device, hasActive) { if (hasActive) { delay(3000); vm.load(devicePath, true) } }

    fun fail(error: Exception, fallback: String) { message = (error.message ?: fallback) to true }

    fun rebootThroughOlt() {
        val onuIndex = device?.trText("onuIndex")
        val match = onuIndex?.let { Regex("^(\\d+)/(\\d+)/(\\d+):(\\d+)$").find(it) }
        if (match == null) { message = "No se pudo reiniciar la ONU desde la OLT: ubicación OLT desconocida" to true; return }
        val (rack, shelf, pon, onu) = match.destructured
        saving = true
        scope.launch {
            try {
                val result = vm.web("POST", "/olt-api/onus/$rack/$shelf/$pon/$onu/operations", JSONObject().put("action", "reboot").put("confirmation", "REINICIAR $onuIndex"))
                if (!result.optBoolean("ok")) throw IllegalStateException("La OLT no confirmó el reinicio")
                message = (result.trText("message") ?: "Reinicio enviado por el canal nativo de la OLT") to false
                saving = false
                delay(12_000); vm.load(devicePath, true)
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { fail(error, "No se pudo reiniciar la ONU desde la OLT"); saving = false }
        }
    }

    fun queue(action: String, payload: JSONObject = JSONObject(), onSent: () -> Unit = {}) {
        if (serial.isBlank() || saving) return
        if (action == "reboot" && omciOnline) { rebootThroughOlt(); return }
        val cap = capability(action)
        if (cap != null && !cap.optBoolean("executable")) { message = "Acción bloqueada hasta certificar este firmware" to true; return }
        saving = true
        scope.launch {
            try {
                val task = vm.web("POST", "$route/tasks", JSONObject().put("action", action).put("payload", payload), route)
                if (task.optString("id").isBlank() || task.optString("action") != action) throw IllegalStateException("El servidor no confirmó la tarea")
                onSent()
                message = "${actionLabel(task)} enviada" to false
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { fail(error, "No se pudo crear la tarea") }
            saving = false
        }
    }

    fun setEnabled(enabled: Boolean) {
        if (serial.isBlank() || saving) return
        saving = true
        scope.launch {
            try {
                val updated = vm.web("PATCH", route, JSONObject().put("enabled", enabled), route)
                if (updated.optBoolean("enabled") != enabled) throw IllegalStateException("El servidor no confirmó el cambio")
                message = (if (enabled) "Control de ONU activado" else "Control de ONU desactivado") to false
                saving = false
                if (enabled) {
                    // Igual que la web: al activar se pide un inventario completo.
                    val task = vm.web("POST", "$route/tasks", JSONObject().put("action", "refresh").put("payload", JSONObject()), route)
                    if (task.optString("id").isNotBlank()) message = "Control de ONU activado · ${actionLabel(task)} enviada" to false
                }
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { fail(error, "No se pudo cambiar el control de la ONU"); saving = false }
        }
    }

    fun cancelTask(task: JSONObject) {
        scope.launch {
            try {
                val result = vm.web("POST", "/tr069-api/tasks/${tr069Encode(task.optString("id"))}/cancel", JSONObject(), route)
                if (result.optString("status") == "cancelled") message = "Tarea cancelada" to false
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { fail(error, "No se pudo cancelar") }
        }
    }
    fun retryTask(task: JSONObject) {
        scope.launch {
            try {
                val result = vm.web("POST", "/tr069-api/tasks/${tr069Encode(task.optString("id"))}/retry", JSONObject(), route)
                if (result.optString("id").isNotBlank()) message = "Reintento enviado" to false
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { fail(error, "No se pudo reintentar") }
        }
    }

    // Parametros: se leen sin cache (pueden contener rutas sensibles) y se ocultan los valores secretos.
    val parameters = remember { mutableStateListOf<JSONObject>() }
    var parameterSearch by remember { mutableStateOf("") }
    var parameterPage by remember { mutableIntStateOf(1) }
    var parameterLoading by remember { mutableStateOf(false) }
    fun loadParameters() {
        if (serial.isBlank() || parameterLoading) return
        parameterLoading = true
        scope.launch {
            try {
                val query = parameterSearch.trim()
                val result = vm.web("GET", "$route/parameters" + if (query.isNotEmpty()) "?q=${tr069Encode(query)}" else "")
                parameters.clear(); parameters.addAll(result.optJSONArray("items").objects()); parameterPage = 1
            } catch (cancel: CancellationException) { throw cancel } catch (_: Exception) { message = "No se pudo leer el inventario técnico de la ONU" to true }
            parameterLoading = false
        }
    }
    fun selectTab(id: String) {
        tab = id
        if (id == "parameters" && parameters.isEmpty()) loadParameters()
        if (id == "overview") vm.load(telemetryPath)
    }
    LaunchedEffect(isAdmin) { if (isAdmin) vm.load(telemetryPath) }

    val visibleTabs = when {
        remoteRegistered -> TR069_TABS
        omciOnline -> TR069_TABS.filter { it.first in listOf("overview", "fiber", "wan", "system", "history") }
        else -> TR069_TABS.filter { it.first in listOf("overview", "history") }
    }
    val activeTab = if (visibleTabs.any { it.first == tab }) tab else "overview"

    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!saving) onClose() }) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = {
                TopAppBar(
                    title = { Column { Text("Control ONU", fontWeight = FontWeight.Bold); Text("Gestión remota · ${capabilities?.trText("profileKey") ?: "Esperando perfil del equipo"}", style = MaterialTheme.typography.labelSmall) } },
                    navigationIcon = { IconButton(onClick = onClose, enabled = !saving) { Icon(Icons.Outlined.Close, "Cerrar") } },
                    actions = {
                        if (device != null && remoteRegistered) Switch(checked = device.optBoolean("enabled"), enabled = !saving, onCheckedChange = { checked ->
                            if (!checked) confirm = Triple("Desactivar control", "¿Desactivar el control remoto de esta ONU? No se podrán cambiar WiFi ni LAN desde aquí hasta volver a activarlo.") { setEnabled(false) }
                            else setEnabled(true)
                        })
                        if (device != null && remoteOnline) IconButton(onClick = { queue("refresh") }, enabled = !saving && device.optBoolean("enabled")) { Icon(Icons.Outlined.Refresh, "Actualizar datos de la ONU") }
                    },
                )
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize()) {
                    if (!isAdmin) { Box(Modifier.padding(16.dp)) { Notice("Permisos insuficientes: el control de la ONU requiere rol administrador.", true) }; return@Column }
                    if (saving) LinearProgressIndicator(Modifier.fillMaxWidth())
                    Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        message?.let { (text, error) -> Tr069Banner(text, error) { message = null } }
                        if (device != null) Tr069Channels(device, remoteOnline, omciOnline)
                        if (state.error != null && device == null) { Notice(state.error, true); TextButton(onClick = { vm.load(devicePath, true) }) { Text("Reintentar") } }
                    }
                    when {
                        device == null && state.loading -> Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Spacer(Modifier.height(8.dp)); Text("Consultando canales de administración...") }
                        device == null -> Unit
                        (!device.optBoolean("enrolled") || !device.optBoolean("enabled")) && !omciOnline -> Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Outlined.LockOpen, null, Modifier.size(32.dp), tint = IspBlue)
                            Text("Control selectivo desactivado", fontWeight = FontWeight.Bold)
                            Text("Active esta ONU para inventariarla y administrar solamente las funciones compatibles.", style = MaterialTheme.typography.bodySmall)
                            Button(onClick = { setEnabled(true) }, enabled = !saving) { Text("Activar control") }
                        }
                        else -> {
                            ScrollableTabRow(selectedTabIndex = visibleTabs.indexOfFirst { it.first == activeTab }.coerceAtLeast(0), edgePadding = 8.dp) {
                                visibleTabs.forEach { (id, label) -> Tab(selected = activeTab == id, onClick = { selectTab(id) }, text = { Text(label) }) }
                            }
                            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                when (activeTab) {
                                    "overview" -> {
                                        val overview = snapshot.optJSONObject("overview") ?: JSONObject(); val wan = snapshot.optJSONObject("wan") ?: JSONObject()
                                        Row { Tr069Fact("Encendida hace", tr069Uptime(overview.num("uptime")), Modifier.weight(1f)); Tr069Fact("CPU", "${overview.num("cpuUsage").plain()}%", Modifier.weight(1f)) }
                                        Row { Tr069Fact("Memoria libre", tr069Bytes(overview.num("memoryFree")), Modifier.weight(1f)); Tr069Fact("Último reporte", tr069Date(snapshot.trText("lastInformAt")), Modifier.weight(1f)) }
                                        HorizontalDivider()
                                        Tr069Fact("Equipo", "${device.trText("manufacturer") ?: ""} ${device.trText("model") ?: ""}".trim().ifBlank { "--" })
                                        Tr069Fact("Firmware", device.trText("softwareVersion") ?: "--")
                                        Tr069Fact("WAN", wan.trText("ip") ?: "--", mono = true)
                                        Tr069Fact("VLAN / servicio", "${wan.trText("vlan") ?: "--"} / ${wan.trText("serviceList") ?: "--"}")
                                        val interval = capabilities?.optInt("telemetryIntervalSeconds", 900) ?: 900
                                        Notice("Lectura automática cada ${interval / 60} minutos; cada minuto cuando hay fallas.")
                                        val telemetry = pages[telemetryPath]?.body?.optJSONArray("items").objects()
                                        if (telemetry.isNotEmpty()) Text("${telemetry.size} lecturas guardadas · última ${tr069Date(telemetry.first().trText("collectedAt"))}", style = MaterialTheme.typography.bodySmall)
                                    }
                                    "fiber" -> {
                                        val fiber = snapshot.optJSONObject("fiber") ?: JSONObject()
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Outlined.Circle, null, tint = if (fiber.optString("status") == "Up") IspGreen else IspRed, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(8.dp))
                                            Column { Text("Enlace de fibra ${tr069LinkLabel(fiber.trText("status"))}", fontWeight = FontWeight.Bold); Text("Lectura directa de la interfaz GPON", style = MaterialTheme.typography.bodySmall) }
                                        }
                                        Row { Tr069Fact("RX", "${fiber.num("rxPower").plain()} dBm", Modifier.weight(1f)); Tr069Fact("TX", "${fiber.num("txPower").plain()} dBm", Modifier.weight(1f)) }
                                        Row { Tr069Fact("Temperatura", "${fiber.num("temperature").plain()} °C", Modifier.weight(1f)); Tr069Fact("Voltaje", "${fiber.num("voltage").plain()} mV", Modifier.weight(1f)) }
                                        Row { Tr069Fact("Errores FEC / HEC", "${(fiber.num("fecErrors") ?: 0.0).plain()} / ${(fiber.num("hecErrors") ?: 0.0).plain()}", Modifier.weight(1f)); Tr069Fact("Paquetes descartados", (fiber.num("dropPackets") ?: 0.0).plain(), Modifier.weight(1f)) }
                                    }
                                    "wifi" -> {
                                        val limits = capabilities?.optJSONObject("limits")?.optJSONObject("wifi") ?: JSONObject()
                                        val wifiBlocked = blocked("set_wifi")
                                        Text("WiFi principal", fontWeight = FontWeight.Bold)
                                        Text(if (capability("set_wifi")?.optString("status") == "verified") "Verificado" else "Detectado", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                                        Text("La clave actual nunca se muestra ni se guarda en texto plano.", style = MaterialTheme.typography.bodySmall)
                                        OutlinedTextField(wifiSsid, { if (it.length <= 32) wifiSsid = it }, label = { Text("Nombre de red") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(wifiPassword, { if (it.length <= 64) wifiPassword = it }, label = { Text("Nueva clave") }, placeholder = { Text("Sin cambios") }, singleLine = true,
                                            visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false), modifier = Modifier.fillMaxWidth())
                                        val channels = listOf("0" to "Automático") + limits.optJSONArray("channels").trStrings().map { it to it }
                                        Tr069Dropdown("Canal", channels, wifiChannel.toString(), { wifiChannel = it.toIntOrNull() ?: 0 })
                                        val powers = limits.optJSONArray("transmitPowers").trStrings().ifEmpty { listOf("100") }
                                        Tr069Dropdown("Potencia", powers.map { it to "$it%" }, wifiPower.toString(), { wifiPower = it.toIntOrNull() ?: 100 })
                                        val standards = limits.optJSONArray("standards").trStrings().ifEmpty { listOf("11bgn") }
                                        Tr069Dropdown("Estándar", standards.map { it to it }, wifiStandard, { wifiStandard = it })
                                        val maxLimit = limits.optInt("maxClients", 32).takeIf { it > 0 } ?: 32
                                        OutlinedTextField(wifiMaxClients, { wifiMaxClients = it.filter(Char::isDigit).take(3) }, label = { Text("Máximo clientes (1-$maxLimit)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                                        FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                            Tr069Check("Radio", wifiEnabled, { wifiEnabled = it }); Tr069Check("SSID visible", wifiBroadcast, { wifiBroadcast = it })
                                            Tr069Check("WMM", wifiWmm, { wifiWmm = it }); Tr069Check("WPS", wifiWps, { wifiWps = it })
                                        }
                                        Button(onClick = {
                                            val password = wifiPassword
                                            if (password.isNotEmpty() && !Regex("^[A-Fa-f0-9]{64}$").matches(password) && (password.length < 8 || password.length > 63)) { message = "La clave WiFi debe tener entre 8 y 63 caracteres" to true; return@Button }
                                            val maxClients = wifiMaxClients.toIntOrNull()
                                            if (maxClients == null || maxClients < 1 || maxClients > maxLimit) { message = "Maximo de clientes invalido" to true; return@Button }
                                            val warning = if (password.isNotEmpty()) "¿Aplicar los cambios de WiFi? Los equipos del cliente se desconectarán y deberán entrar con la nueva clave."
                                                else "¿Aplicar los cambios de WiFi? Los equipos del cliente pueden desconectarse unos segundos."
                                            confirm = Triple("Aplicar WiFi", warning) {
                                                val payload = JSONObject().put("ssid", wifiSsid).put("enabled", wifiEnabled).put("broadcast", wifiBroadcast).put("channel", wifiChannel)
                                                    .put("transmitPower", wifiPower).put("standard", wifiStandard).put("maxClients", maxClients).put("wmm", wifiWmm).put("wps", wifiWps)
                                                if (wifiPassword.isNotEmpty()) payload.put("password", wifiPassword)
                                                queue("set_wifi", payload) { wifiPassword = "" }
                                            }
                                        }, enabled = !saving && !wifiBlocked && wifiSsid.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Aplicar y verificar WiFi") }
                                        if (wifiBlocked) Text("No disponible: la ONU debe tener el canal remoto activo y esta función certificada.", style = MaterialTheme.typography.bodySmall, color = IspAmber)
                                        else if (wifiSsid.isBlank()) Text("Escriba el nombre de la red", style = MaterialTheme.typography.bodySmall, color = IspAmber)
                                    }
                                    "lan" -> {
                                        val lanBlocked = blocked("set_lan_port")
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Column(Modifier.weight(1f)) { Text("Puertos Ethernet", fontWeight = FontWeight.Bold); Text("Estado y configuración individual", style = MaterialTheme.typography.bodySmall) }
                                            StatusBadge(if (lanBlocked) "Bloqueado" else tr069CapabilityLabel(capability("set_lan_port")?.trText("status")))
                                        }
                                        if (lanPorts.isEmpty()) Text("La ONU no reporta puertos LAN.", style = MaterialTheme.typography.bodySmall)
                                        lanPorts.forEachIndexed { index, port ->
                                            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                                Row(verticalAlignment = Alignment.CenterVertically) { Text("LAN ${port.port}", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(if (port.status == "Up") "Conectado" else "Desconectado", color = if (port.status == "Up") IspGreen else MaterialTheme.colorScheme.onSurfaceVariant) }
                                                Tr069Dropdown("Velocidad", listOf("Auto" to "Auto", "10" to "10 Mbps", "100" to "100 Mbps", "1000" to "1 Gbps"), port.speed, { lanPorts[index] = port.copy(speed = it) })
                                                Tr069Dropdown("Dúplex", listOf("Auto" to "Dúplex auto", "Half" to "Half", "Full" to "Full"), port.duplex, { lanPorts[index] = port.copy(duplex = it) })
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    Tr069Check("Activo", port.enabled, { lanPorts[index] = port.copy(enabled = it) })
                                                    Spacer(Modifier.weight(1f))
                                                    OutlinedButton(onClick = {
                                                        confirm = Triple("Puerto LAN ${port.port}", "¿Aplicar cambios al puerto LAN ${port.port}? El equipo conectado puede perder conexión unos segundos.") {
                                                            val payload = JSONObject().put("port", port.port).put("enabled", port.enabled).put("speed", port.speed).put("duplex", port.duplex)
                                                            if (port.flowControl is Boolean) payload.put("flowControl", port.flowControl)
                                                            if (port.l3Enabled is Boolean) payload.put("l3Enabled", port.l3Enabled)
                                                            queue("set_lan_port", payload)
                                                        }
                                                    }, enabled = !saving && !lanBlocked) { Text("Guardar") }
                                                }
                                            } }
                                        }
                                        HorizontalDivider()
                                        Text("LAN y DHCP", fontWeight = FontWeight.Bold); Text(tr069CapabilityLabel(capability("set_dhcp")?.trText("status")), style = MaterialTheme.typography.labelSmall, color = IspBlue)
                                        OutlinedTextField(dhcpMin, { dhcpMin = it.trim() }, label = { Text("IP inicial") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(dhcpMax, { dhcpMax = it.trim() }, label = { Text("IP final") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(dhcpMask, { dhcpMask = it.trim() }, label = { Text("Máscara") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(dhcpRouter, { dhcpRouter = it.trim() }, label = { Text("Gateway") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(dhcpDns, { dhcpDns = it.trim() }, label = { Text("DNS") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(dhcpLease, { dhcpLease = it.filter(Char::isDigit).take(9) }, label = { Text("Concesión (segundos)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                                        Tr069Check("Servidor DHCP habilitado", dhcpEnabled, { dhcpEnabled = it })
                                        Button(onClick = {
                                            confirm = Triple("LAN y DHCP", "¿Aplicar la configuración LAN y DHCP? Los equipos del cliente pueden perder conexión hasta renovar su IP.") {
                                                val payload = JSONObject().put("enabled", dhcpEnabled).put("minAddress", dhcpMin).put("maxAddress", dhcpMax).put("subnetMask", dhcpMask)
                                                    .put("router", dhcpRouter).put("dnsServers", dhcpDns)
                                                dhcpLease.toLongOrNull()?.let { payload.put("leaseTime", it) }
                                                queue("set_dhcp", payload)
                                            }
                                        }, enabled = !saving && !blocked("set_dhcp"), modifier = Modifier.fillMaxWidth()) { Text("Aplicar LAN y DHCP") }
                                    }
                                    "wan" -> {
                                        val wan = snapshot.optJSONObject("wan") ?: JSONObject()
                                        Notice("WAN visible, cambios bloqueados. Debe certificarse con una ONU recuperable antes de habilitar esta acción.", true)
                                        Tr069Fact("Direccionamiento", wan.trText("addressingType") ?: "Static"); Tr069Fact("IP WAN", wan.trText("ip") ?: "--", mono = true)
                                        Tr069Fact("Gateway", wan.trText("gateway") ?: "--", mono = true); Tr069Fact("DNS", wan.trText("dnsServers") ?: "--")
                                        Row { Tr069Fact("VLAN", wan.trText("vlan") ?: "101", Modifier.weight(1f)); Tr069Fact("MTU", wan.trText("mtu") ?: "1500", Modifier.weight(1f)) }
                                        Tr069Fact("Lista de servicios", wan.trText("serviceList") ?: "TR069_INTERNET")
                                        Button(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth()) { Text("Bloqueado hasta certificación") }
                                    }
                                    "clients" -> {
                                        val clients = snapshot.optJSONArray("clients").objects()
                                        Row { Column(Modifier.weight(1f)) { Text("Equipos conectados", fontWeight = FontWeight.Bold); Text("WiFi y tabla DHCP reportada por la ONU", style = MaterialTheme.typography.bodySmall) }; Text("${clients.size}", fontWeight = FontWeight.Bold) }
                                        if (clients.isEmpty()) EmptyState("La ONU no reporta clientes conectados.")
                                        clients.forEach { client ->
                                            OutlinedCard(Modifier.fillMaxWidth()) { ListItem(
                                                headlineContent = { Text(client.trText("hostName") ?: "Sin nombre", fontWeight = FontWeight.SemiBold) },
                                                supportingContent = { Text("${client.trText("mac") ?: "--"} · ${client.trText("ip") ?: "--"}\n${client.trText("source") ?: ""}") },
                                                trailingContent = { Text(client.num("signal")?.let { "${it.plain()} dBm" } ?: if (client.optBoolean("active")) "Conectado" else "--") },
                                            ) }
                                        }
                                    }
                                    "diagnostics" -> {
                                        OutlinedTextField(diagHost, { diagHost = it.trim() }, label = { Text("Host o IP") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                            OutlinedButton(onClick = { queue("run_ping", JSONObject().put("host", diagHost).put("repetitions", 4).put("timeout", 10000).put("blockSize", 56)) }, enabled = !saving && !blocked("run_ping"), modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.PlayArrow, null); Text("Ping") }
                                            OutlinedButton(onClick = { queue("run_traceroute", JSONObject().put("host", diagHost).put("maxHops", 30).put("timeout", 10000)) }, enabled = !saving && !blocked("run_traceroute"), modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Lan, null); Text("Traceroute") }
                                        }
                                        OutlinedTextField(downloadUrl, { downloadUrl = it.trim() }, label = { Text("URL de descarga") }, placeholder = { Text("http://servidor/archivo.bin") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedButton(onClick = { queue("run_download_diagnostic", JSONObject().put("url", downloadUrl)) }, enabled = !saving && downloadUrl.isNotEmpty() && !blocked("run_download_diagnostic"), modifier = Modifier.fillMaxWidth()) { Text("Probar descarga") }
                                        OutlinedTextField(uploadUrl, { uploadUrl = it.trim() }, label = { Text("URL de subida") }, placeholder = { Text("http://servidor/upload") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedButton(onClick = { queue("run_upload_diagnostic", JSONObject().put("url", uploadUrl).put("testFileLength", 1048576)) }, enabled = !saving && uploadUrl.isNotEmpty() && !blocked("run_upload_diagnostic"), modifier = Modifier.fillMaxWidth()) { Text("Probar subida") }
                                        val results = snapshot.optJSONObject("diagnostics") ?: JSONObject()
                                        results.keys().asSequence().sorted().forEach { key ->
                                            val entry = results.optJSONObject(key)
                                            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                Row { Text(key, Modifier.weight(1f), fontWeight = FontWeight.Bold); Text(tr069DiagnosticState(entry?.opt("DiagnosticsState"))) }
                                                Text((entry ?: results.opt(key))?.let { if (it is JSONObject) it.toString(2) else it.toString() } ?: "", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                                            } }
                                        }
                                    }
                                    "security" -> {
                                        Notice("NAT y seguridad detectados. DMZ, redirecciones, ACL y reglas permanecen bloqueadas hasta certificar AddObject/DeleteObject.")
                                        val mappings = snapshot.optJSONArray("portMappings").objects()
                                        if (mappings.isEmpty()) EmptyState("No hay redirecciones configuradas.")
                                        mappings.forEach { mapping ->
                                            OutlinedCard(Modifier.fillMaxWidth()) { ListItem(
                                                headlineContent = { Text("${mapping.optString("protocol")} · externo ${mapping.optString("externalPort")}") },
                                                supportingContent = { Text("${mapping.optString("internalClient")}:${mapping.optString("internalPort")}", fontFamily = FontFamily.Monospace) },
                                                trailingContent = { StatusBadge(if (mapping.optBoolean("enabled")) "Activo" else "Inactivo") },
                                            ) }
                                        }
                                    }
                                    "system" -> {
                                        Text("Hora, NTP y reportes", fontWeight = FontWeight.Bold); Text(tr069CapabilityLabel(capability("set_time")?.trText("status")), style = MaterialTheme.typography.labelSmall, color = IspBlue)
                                        OutlinedTextField(ntp1, { ntp1 = it.trim() }, label = { Text("NTP principal") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(ntp2, { ntp2 = it.trim() }, label = { Text("NTP alterno") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(timeZone, { timeZone = it.trim() }, label = { Text("Zona") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                        OutlinedTextField(informInterval, { informInterval = it.filter(Char::isDigit).take(6) }, label = { Text("Intervalo de gestión (s)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                                        Button(onClick = {
                                            val payload = JSONObject().put("enabled", timeEnabled).put("ntpServer1", ntp1).put("ntpServer2", ntp2).put("timeZone", timeZone).put("timeZoneName", timeZoneName)
                                            informInterval.toLongOrNull()?.let { payload.put("informInterval", it) }
                                            queue("set_time", payload)
                                        }, enabled = !saving && !blocked("set_time"), modifier = Modifier.fillMaxWidth()) { Text("Aplicar tiempo") }
                                        HorizontalDivider()
                                        OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text("Reiniciar ONU", fontWeight = FontWeight.Bold)
                                            Text(if (omciOnline) "Se enviará directamente por la OLT y quedará auditado." else "Se enviará por el canal remoto disponible.", style = MaterialTheme.typography.bodySmall)
                                            Button(onClick = {
                                                val label = device.trText("onuIndex") ?: serial
                                                confirm = Triple("Reiniciar ONU", "¿Reiniciar la ONU $label? El cliente se quedará sin Internet de 1 a 3 minutos.") {
                                                    val canonical = (device.trText("serial") ?: serial).uppercase().filter { it.isLetterOrDigit() }
                                                    queue("reboot", JSONObject().put("confirmation", "REINICIAR $canonical"))
                                                }
                                            }, enabled = !saving, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Outlined.RestartAlt, null); Spacer(Modifier.width(6.dp)); Text("Reiniciar") }
                                        } }
                                        OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text("Firmware", fontWeight = FontWeight.Bold); Text("Bloqueado hasta validar fabricante, versión y recuperación.", style = MaterialTheme.typography.bodySmall)
                                            OutlinedButton(onClick = {}, enabled = false) { Text("Actualizar firmware") }
                                        } }
                                        OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                            Text("Restauración de fábrica", fontWeight = FontWeight.Bold); Text("No certificada para este firmware.", style = MaterialTheme.typography.bodySmall)
                                            OutlinedButton(onClick = {}, enabled = false) { Text("Restaurar") }
                                        } }
                                    }
                                    "history" -> {
                                        if (tasks.isEmpty()) EmptyState("No hay actividad remota.")
                                        tasks.forEach { task ->
                                            val status = task.optString("status")
                                            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                                Row(verticalAlignment = Alignment.CenterVertically) {
                                                    Icon(when (status) { "success" -> Icons.Outlined.CheckCircle; "failed" -> Icons.Outlined.Warning; else -> Icons.Outlined.Sync }, null,
                                                        tint = when (status) { "success" -> IspGreen; "failed" -> IspRed; else -> IspBlue })
                                                    Spacer(Modifier.width(8.dp))
                                                    Column(Modifier.weight(1f)) { Text(actionLabel(task), fontWeight = FontWeight.SemiBold); Text("${tr069Date(task.trText("createdAt"))} · ${task.optString("createdBy")}", style = MaterialTheme.typography.bodySmall) }
                                                    StatusBadge(tr069TaskStatusLabel(status))
                                                }
                                                task.trText("errorMessage")?.let { Text("${task.trText("errorCode") ?: ""} · $it", color = IspRed, style = MaterialTheme.typography.bodySmall) }
                                                if (status == "processing") LinearProgressIndicator(progress = { task.optInt("progress") / 100f }, modifier = Modifier.fillMaxWidth())
                                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                    if (status == "pending") TextButton(onClick = { cancelTask(task) }) { Icon(Icons.Outlined.Block, null); Text("Cancelar tarea") }
                                                    if (status == "failed" || status == "cancelled") TextButton(onClick = { retryTask(task) }) { Icon(Icons.Outlined.Replay, null); Text("Reintentar tarea") }
                                                }
                                            } }
                                        }
                                    }
                                    "parameters" -> {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            OutlinedTextField(parameterSearch, { parameterSearch = it }, label = { Text("Buscar parámetro técnico") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.weight(1f))
                                            Spacer(Modifier.width(8.dp)); Button(onClick = { loadParameters() }, enabled = !parameterLoading) { Text("Buscar") }
                                        }
                                        val pageCount = maxOf(1, (parameters.size + TR069_PARAMETER_PAGE - 1) / TR069_PARAMETER_PAGE)
                                        if (parameters.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                                            Text("${parameters.size} parámetros encontrados", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                                            TextButton(onClick = { parameterPage = maxOf(1, parameterPage - 1) }, enabled = parameterPage > 1) { Text("Anterior") }
                                            Text("$parameterPage / $pageCount", fontWeight = FontWeight.Bold)
                                            TextButton(onClick = { parameterPage = minOf(pageCount, parameterPage + 1) }, enabled = parameterPage < pageCount) { Text("Siguiente") }
                                        }
                                        val visible = parameters.drop((parameterPage - 1) * TR069_PARAMETER_PAGE).take(TR069_PARAMETER_PAGE)
                                        if (visible.isEmpty()) Text(if (parameterLoading) "Leyendo parámetros..." else "Escriba un término y pulse «Buscar» para ver los parámetros.", style = MaterialTheme.typography.bodySmall)
                                        visible.forEach { parameter ->
                                            val path = parameter.optString("path")
                                            val secret = TR069_SECRET_PATH.containsMatchIn(path)
                                            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                                                Text(path, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                                                Row { Text(if (secret) "•••••• (protegido)" else parameter.trText("value") ?: "", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium); Text(if (parameter.optBoolean("writable")) "Editable" else "Lectura", style = MaterialTheme.typography.labelSmall, color = if (parameter.optBoolean("writable")) IspGreen else MaterialTheme.colorScheme.onSurfaceVariant) }
                                                HorizontalDivider()
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        confirm?.let { (title, text, action) -> Tr069Confirm(title, text, "Aceptar", danger = title.startsWith("Reiniciar") || title.startsWith("Desactivar"), onDismiss = { confirm = null }, onConfirm = action) }
    }
}

@Composable private fun Tr069Channels(device: JSONObject, remoteOnline: Boolean, omciOnline: Boolean) {
    val channels = device.optJSONObject("managementChannels") ?: return
    val tr069 = channels.optJSONObject("tr069") ?: JSONObject(); val omci = channels.optJSONObject("omci") ?: JSONObject()
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Circle, null, tint = if (remoteOnline || omciOnline) IspGreen else IspRed, modifier = Modifier.size(12.dp)); Spacer(Modifier.width(6.dp))
        Text(if (remoteOnline || omciOnline) "Gestión disponible" else "Sin canal activo", style = MaterialTheme.typography.labelMedium)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (tr069.optBoolean("available")) OutlinedCard(Modifier.weight(1f)) { Column(Modifier.padding(10.dp)) {
            Text("Canal remoto", style = MaterialTheme.typography.labelSmall)
            Text(if (tr069.optBoolean("online")) "Activo y verificado" else "Registrado sin reporte reciente", fontWeight = FontWeight.SemiBold, color = if (tr069.optBoolean("online")) IspGreen else IspAmber)
        } }
        OutlinedCard(Modifier.weight(1f)) { Column(Modifier.padding(10.dp)) {
            Text("Canal nativo OLT", style = MaterialTheme.typography.labelSmall)
            Text(if (omci.optBoolean("available")) "OMCI activo" else "No disponible", fontWeight = FontWeight.SemiBold, color = if (omci.optBoolean("available")) (if (omci.optBoolean("profileMatched")) IspGreen else IspAmber) else MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${omci.trText("oltProfile") ?: "--"} → ${omci.trText("detectedModel") ?: "--"}", style = MaterialTheme.typography.bodySmall)
        } }
    }
    if (omci.optBoolean("available") && !omci.optBoolean("profileMatched")) Notice("OMCI responde, pero el perfil OLT no coincide con el modelo detectado. Las lecturas y el reinicio están disponibles; los cambios avanzados siguen bloqueados.")
    if (!tr069.optBoolean("online") && omci.optBoolean("available")) Notice("Modo OLT nativo: se ocultan las funciones que requieren el canal remoto y permanecen disponibles las funciones OMCI verificadas.")
}
