package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.Normalizer
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

/*
 * Utilidades compartidas por la administracion OLT de Android. Son el equivalente de
 * src/app/pages/olt/olt-helpers.ts y de las etiquetas de olt.ts: mismos umbrales, mismos textos.
 */

internal const val OLT_RX_WEAK = -27.0
internal const val OLT_RX_CRITICAL = -30.0
internal val OltGray = Color(0xFF7D8C95)

/** Rutas (claves de [PageState]) que la web lee en loadAll(). */
internal object OltPaths {
    const val STATUS = "web:/olt-api/status"
    const val PONS = "web:/olt-api/pons"
    const val ALARMS = "web:/olt-api/alarms?active=true"
    const val SIGNAL = "web:/olt-api/signal-alerts?active=true"
    const val TOPOLOGY = "web:/olt-api/topology"
    const val PROFILES = "web:/olt-api/profiles?active=true"
    const val PROFILES_ALL = "web:/olt-api/profiles?active=false"
    const val MAP = "web:/olt-api/onus?page=1&limit=500"
    const val UNCONFIGURED = "web:/olt-api/unconfigured"
    const val JOBS = "web:/provisioning/jobs"
    const val ACTIVITY = "web:/olt-api/activity"
    const val MODELS = "web:/olt-api/model-profiles?active=false"
    val ALL = listOf(STATUS, PONS, ALARMS, SIGNAL, TOPOLOGY, PROFILES, MAP, UNCONFIGURED, JOBS, ACTIVITY, MODELS)
}

/** Prefijos que se vuelven a leer despues de cada escritura (equivale a loadAll(true) de la web). */
internal val OLT_REFRESH = arrayOf(
    "/olt-api/status", "/olt-api/pons", "/olt-api/alarms", "/olt-api/signal-alerts", "/olt-api/topology",
    "/olt-api/profiles?", "/olt-api/onus?", "/olt-api/unconfigured", "/provisioning/jobs", "/olt-api/activity",
    "/olt-api/model-profiles",
)

/** Contexto comun de la pantalla OLT. */
internal class OltCtx(
    val vm: MainViewModel,
    val pages: Map<String, PageState>,
    val admin: Boolean,
    val notify: (String) -> Unit,
    val onClient: (Int) -> Unit,
    val onTr069: (String) -> Unit,
) {
    fun page(path: String) = pages[path] ?: PageState(loading = true)
    fun items(path: String): List<JSONObject> = pages[path]?.body?.optJSONArray("items").objects()
    fun loadAll(refresh: Boolean = true) = OltPaths.ALL.forEach { vm.load(it, refresh) }
    suspend fun write(method: String, path: String, body: JSONObject? = null): JSONObject = vm.web(method, path, body, *OLT_REFRESH)
    suspend fun read(path: String): JSONObject = vm.web("GET", path, null)
}

internal fun oltEnc(value: String): String = URLEncoder.encode(value, "UTF-8")
internal fun JSONObject.oltStr(key: String): String? = if (isNull(key)) null else optString(key).ifBlank { null }
internal fun JSONObject.oltNum(key: String): Double? = if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }
internal fun JSONObject.oltInt(key: String): Int? = if (isNull(key)) null else optDouble(key).takeIf { !it.isNaN() }?.toInt()
internal fun JSONArray?.oltStrings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).ifBlank { null } }
internal fun oltNumText(value: Double?): String = when {
    value == null -> "--"
    value == Math.floor(value) && kotlin.math.abs(value) < 1e9 -> value.toLong().toString()
    else -> value.toString()
}

internal fun oltIsWeak(value: Double?) = value != null && value <= OLT_RX_WEAK
internal fun oltIsCritical(value: Double?) = value != null && value <= OLT_RX_CRITICAL
internal fun oltDbm(value: Double?) = if (value != null) "${oltNumText(value)} dBm" else "--"

internal enum class OnuHealth { ONLINE, WARNING, CRITICAL, OFFLINE }

internal fun onuHealth(onu: JSONObject): OnuHealth {
    val rx = onu.oltNum("rxPowerDbm")
    return when {
        !onu.optBoolean("online") -> OnuHealth.OFFLINE
        oltIsCritical(rx) -> OnuHealth.CRITICAL
        oltIsWeak(rx) -> OnuHealth.WARNING
        else -> OnuHealth.ONLINE
    }
}

internal fun OnuHealth.color(): Color = when (this) {
    OnuHealth.ONLINE -> IspGreen; OnuHealth.WARNING -> IspAmber; OnuHealth.CRITICAL -> IspRed; OnuHealth.OFFLINE -> OltGray
}

internal fun oltSignalColor(value: Double?): Color = when {
    value == null -> OltGray; oltIsCritical(value) -> IspRed; oltIsWeak(value) -> IspAmber; else -> IspGreen
}

/** Semaforo de senal optica: Buena / Debil / Critica. */
internal fun oltSignalLabel(value: Double?) = when {
    value == null -> "Sin lectura"; oltIsCritical(value) -> "Crítica"; oltIsWeak(value) -> "Débil"; else -> "Buena"
}

/** Estados de fase que reporta la ZTE C320, traducidos para el operador. */
internal fun oltPhaseLabel(phase: String?): String {
    val labels = mapOf(
        "los" to "Sin señal óptica (LOS)", "dyinggasp" to "Sin energía", "offline" to "Fuera de línea",
        "not-seen" to "Nunca vista", "syncmib" to "Sincronizando", "logging" to "Registrándose",
        "authfailed" to "Autenticación fallida", "working" to "Operativa",
    )
    val key = phase.orEmpty().trim().lowercase()
    return labels[key] ?: phase?.ifBlank { null } ?: "Fuera de línea"
}

internal fun oltOfflineCause(onu: JSONObject): String = when (onu.oltStr("phaseState")?.trim()?.lowercase()) {
    "los" -> "los"; "dyinggasp" -> "power"; else -> "other"
}

internal fun oltOnuStatusLabel(onu: JSONObject): String {
    val rx = onu.oltNum("rxPowerDbm")
    return when {
        !onu.optBoolean("online") -> oltPhaseLabel(onu.oltStr("phaseState"))
        oltIsCritical(rx) -> "Señal crítica"
        oltIsWeak(rx) -> "Señal débil"
        else -> "ONU en línea"
    }
}

/** Nombre visible: cliente asociado, nombre en la OLT o su indice. */
internal fun oltOnuName(onu: JSONObject): String =
    onu.optJSONObject("client")?.oltStr("nombre") ?: onu.oltStr("name") ?: onu.text("onuIndex", "ONU")

internal fun oltOnuMac(onu: JSONObject): String = onu.optJSONObject("agentInventory")?.optJSONObject("summary")?.oltStr("mac") ?: ""
internal fun oltOnuIp(onu: JSONObject): String =
    onu.optJSONObject("client")?.oltStr("ip") ?: onu.optJSONObject("agentInventory")?.optJSONObject("summary")?.oltStr("wanIp") ?: ""

internal fun oltNormalize(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").trim().lowercase()

private fun oltSearchText(onu: JSONObject): String {
    val client = onu.optJSONObject("client")
    return listOf(
        client?.oltStr("nombre"), client?.oltStr("usuario"), client?.oltStr("telefono"), oltOnuIp(onu), onu.oltStr("serial"),
        oltOnuMac(onu), onu.oltStr("name"), onu.oltStr("onuIndex"), onu.oltStr("model"),
        onu.oltInt("clientIdServicio")?.let { "#$it" },
    ).filter { !it.isNullOrBlank() }.joinToString(" ").lowercase()
}

/** Coincidencia tolerante: todas las palabras deben aparecer (sin tildes ni mayusculas; MAC sin separadores). */
internal fun oltMatchesOnu(onu: JSONObject, query: String): Boolean {
    val terms = oltNormalize(query).split(Regex("\\s+")).filter { it.isNotBlank() }
    if (terms.isEmpty()) return true
    val haystack = oltNormalize(oltSearchText(onu))
    val compact = haystack.replace(Regex("[:.-]"), "")
    return terms.all { haystack.contains(it) || compact.contains(it.replace(Regex("[:.-]"), "")) }
}

private val oltDateFormat = DateTimeFormatter.ofPattern("dd/MM/yy HH:mm").withZone(ZoneId.systemDefault())
internal fun oltInstant(value: String?): Instant? = value?.let { runCatching { Instant.parse(it) }.getOrNull() }
internal fun oltDate(value: String?): String = oltInstant(value)?.let { oltDateFormat.format(it) } ?: if (value.isNullOrBlank()) "Sin registro" else value

/** Tiempo relativo legible: «hace 3 min», «hace 2 h», «hace 4 días». */
internal fun oltAgo(value: String?, now: Long = System.currentTimeMillis()): String {
    val time = oltInstant(value)?.toEpochMilli() ?: return "sin registro"
    return oltAgoMillis(time, now) ?: oltDate(value)
}

internal fun oltAgoMillis(time: Long, now: Long = System.currentTimeMillis()): String? {
    val seconds = ((now - time) / 1000.0).roundToInt()
    if (seconds < 0) return "ahora"
    if (seconds < 45) return "hace unos segundos"
    val minutes = (seconds / 60.0).roundToInt()
    if (minutes < 60) return "hace $minutes min"
    val hours = (minutes / 60.0).roundToInt()
    if (hours < 24) return "hace $hours h"
    val days = (hours / 24.0).roundToInt()
    if (days < 30) return "hace $days ${if (days == 1) "día" else "días"}"
    return null
}

internal fun oltAlarmLevel(level: String?): String {
    val labels = mapOf("critical" to "Crítica", "major" to "Mayor", "minor" to "Menor", "warning" to "Aviso", "info" to "Informativa", "normal" to "Normal")
    return labels[level.orEmpty().trim().lowercase()] ?: level?.ifBlank { null } ?: "Aviso"
}

internal fun oltTraffic(value: Double?): String {
    val bps = value ?: 0.0
    return when {
        bps < 1 -> "0 bps"
        bps < 1_000 -> "${bps.roundToInt()} bps"
        bps < 1_000_000 -> "%.1f Kbps".format(java.util.Locale.US, bps / 1_000)
        bps < 1_000_000_000 -> (if (bps >= 10_000_000) "%.1f Mbps" else "%.2f Mbps").format(java.util.Locale.US, bps / 1_000_000)
        else -> "%.2f Gbps".format(java.util.Locale.US, bps / 1_000_000_000)
    }
}

/** Mismo saneado que safeProvisioningName() de la web. */
internal fun oltSafeName(value: String): String =
    Normalizer.normalize(value, Normalizer.Form.NFD).replace(Regex("[\\u0300-\\u036f]"), "").trim()
        .replace(Regex("\\s+"), "_").replace(Regex("[^A-Za-z0-9_.-]"), "").take(32).ifBlank { "ONU_nueva" }

/** Velocidad comercial del plan, igual que commercialPlanSpeed() de la web. */
internal fun oltPlanSpeed(value: String?): Int? {
    val name = value.orEmpty()
    Regex("\\b(\\d{1,4})\\s*M(?:BPS|B|EGAS?)?", RegexOption.IGNORE_CASE).find(name)?.let { return it.groupValues[1].toInt() }
    if (Regex("fi(?:bra|nra)", RegexOption.IGNORE_CASE).containsMatchIn(name)) {
        Regex("\\b(\\d{1,4})\\b").find(name)?.let { return it.groupValues[1].toInt() }
    }
    return null
}

internal fun oltInstallationStage(stage: String?): String {
    val labels = mapOf(
        "draft" to "Borrador", "onu_detected" to "ONU identificada", "client_validating" to "Validando cliente",
        "wisphub_ready" to "WispHub listo", "client_ready" to "Cliente listo", "waiting_optical" to "Esperando fibra",
        "onu_configured" to "ONU configurada", "olt_discovered" to "Detectada por OLT", "service_ready" to "Servicio listo",
        "local_network" to "Red local preparada", "local_reachability" to "ONU accesible", "local_login" to "Sesión ONU iniciada",
        "local_identity" to "Identidad confirmada", "local_backup_before" to "Respaldo previo", "local_wan" to "WAN configurada",
        "local_tr069" to "TR-069 configurado", "local_wifi" to "WiFi configurado", "local_remote" to "Acceso remoto configurado",
        "local_save" to "Configuración guardada", "local_verify" to "Verificación local", "local_failed" to "Fallo en el agente local",
        "client_partial" to "Alta parcial", "client_failed" to "Fallo en alta", "olt_failed" to "Fallo en OLT", "olt_rolled_back" to "OLT revertida",
        "cancelled" to "Cancelada",
    )
    val key = stage.orEmpty()
    return labels[key] ?: key.replace("_", " ")
}

internal fun oltInstallationStatus(job: JSONObject): String {
    if (job.oltStr("localStatus") == "error") return "Error en el agente"
    val status = job.oltStr("status").orEmpty()
    return mapOf("in_progress" to "En curso", "waiting_optical" to "Esperando fibra", "partial" to "Incompleta", "failed" to "Fallida", "complete" to "Completada", "cancelled" to "Cancelada")[status] ?: status
}

internal fun oltInstallationHasError(job: JSONObject): Boolean {
    val status = job.oltStr("status")
    if (status == "complete" || status == "cancelled") return false
    return status == "failed" || status == "partial" || job.oltStr("localStatus") == "error" || job.oltStr("errorMessage") != null
}

internal fun oltNapPortStatus(status: String?): String =
    mapOf("available" to "Libre", "reserved" to "Reservado", "assigned" to "Ocupado", "damaged" to "Averiado")[status.orEmpty()] ?: status ?: "Libre"

internal fun oltOperationConfirmLabel(action: String) = mapOf(
    "rename" to "Cambiar nombre y verificar", "reboot" to "Reiniciar ONU",
    "retire-stale" to "Retirar ubicación anterior", "retire-full" to "Eliminar de la OLT",
)[action] ?: "Confirmar y verificar"

internal fun oltOperationTitle(action: String) = mapOf(
    "rename" to "Cambiar nombre en la OLT", "reboot" to "Reiniciar ONU",
    "retire-stale" to "Retirar ubicación anterior", "retire-full" to "Eliminar ONU de la OLT",
)[action] ?: "Confirmar operación"

internal fun oltActivityLabel(action: String) = mapOf(
    "olt_onu_renamed" to "Nombre ONU cambiado", "olt_onu_rebooted" to "ONU reiniciada",
    "olt_stale_locations_retired" to "Ubicación anterior retirada", "olt_onu_retired_for_reassociation" to "ONU eliminada para reasociar",
    "olt_onu_full_retirement_failed" to "Error eliminando ONU", "olt_stale_location_cleanup_failed" to "Limpieza de ubicación fallida",
)[action] ?: action.removePrefix("olt_").replace("_", " ")

internal fun oltActivityDetail(event: JSONObject): String {
    val details = event.optJSONObject("details") ?: JSONObject()
    return when (event.oltStr("action")) {
        "olt_onu_renamed" -> "${details.oltStr("oldName") ?: "sin nombre"} → ${details.oltStr("newName") ?: "--"}"
        "olt_stale_locations_retired" -> "${details.optJSONArray("removed").oltStrings().joinToString(", ").ifBlank { "--" }} → ${details.oltStr("activeLocation") ?: "--"}"
        else -> details.oltStr("clientName") ?: details.oltInt("totalOnus")?.let { "$it ONUs" } ?: "--"
    }
}

internal fun oltConflictLabel(reason: String?) = mapOf(
    "ambiguous_client" to "Varios clientes coinciden", "client_already_linked" to "El cliente ya tiene otra ONU",
    "multiple_onus_for_client" to "Dos ONU coinciden con el mismo cliente", "no_match" to "Sin coincidencia verificable",
)[reason.orEmpty()] ?: reason.orEmpty()

internal fun oltOnuRoute(onu: JSONObject) =
    "/olt-api/onus/${onu.optInt("rack")}/${onu.optInt("shelf")}/${onu.optInt("pon")}/${onu.optInt("onuId")}"

/** Filas planas para exportar ONUs a CSV (mismas columnas que ONU_CSV_COLUMNS de la web). */
internal fun oltOnuCsvRows(rows: List<JSONObject>): List<JSONObject> = rows.map { onu ->
    val client = onu.optJSONObject("client")
    JSONObject().put("ONU", onu.text("onuIndex", "")).put("PON", onu.optInt("pon")).put("ID ONU", onu.optInt("onuId"))
        .put("Estado", oltOnuStatusLabel(onu)).put("Cliente", client?.oltStr("nombre") ?: "").put("Usuario", client?.oltStr("usuario") ?: "")
        .put("ID servicio", onu.oltInt("clientIdServicio")?.toString() ?: "").put("IP", oltOnuIp(onu)).put("Nombre en OLT", onu.oltStr("name") ?: "")
        .put("Modelo", onu.oltStr("model") ?: "").put("Serial", onu.oltStr("serial") ?: "").put("MAC", oltOnuMac(onu))
        .put("RX (dBm)", onu.oltNum("rxPowerDbm")?.let(::oltNumText) ?: "").put("TX (dBm)", onu.oltNum("txPowerDbm")?.let(::oltNumText) ?: "")
        .put("Señal", oltSignalLabel(onu.oltNum("rxPowerDbm"))).put("Distancia (m)", onu.oltNum("distanceM")?.let(::oltNumText) ?: "")
        .put("Tiempo en línea", onu.oltStr("onlineDuration") ?: "").put("Última desconexión", onu.oltStr("lastOfflineCause") ?: "")
        .put("Última lectura", oltDate(onu.oltStr("lastDetailAt") ?: onu.oltStr("lastSeenAt")))
}

// ---------- Piezas visuales comunes ----------

@Composable internal fun OltPill(text: String, color: Color) {
    Text(text, color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.background(color.copy(alpha = 0.10f), MaterialTheme.shapes.extraSmall).padding(horizontal = 8.dp, vertical = 4.dp))
}

@Composable internal fun OltDot(color: Color, size: Int = 10) {
    Box(Modifier.size(size.dp).background(color, MaterialTheme.shapes.extraLarge))
}

@Composable internal fun OltMono(text: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified, weight: FontWeight? = null) {
    Text(text, modifier, color = color, fontFamily = FontFamily.Monospace, fontWeight = weight, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable internal fun OltField(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = Color.Unspecified, mono: Boolean = false) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, color = valueColor, fontWeight = FontWeight.SemiBold, fontFamily = if (mono) FontFamily.Monospace else null, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable internal fun OltSectionTitle(title: String, subtitle: String? = null, trailing: (@Composable () -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        trailing?.invoke()
    }
}

/** Selector simple (evita las API experimentales de ExposedDropdownMenuBox). */
@Composable internal fun OltSelect(label: String, value: String, options: List<Pair<String, String>>, modifier: Modifier = Modifier, enabled: Boolean = true, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedTextField(options.firstOrNull { it.first == value }?.second ?: value, {}, readOnly = true, enabled = enabled, singleLine = true,
            label = { Text(label) }, trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, null) }, modifier = Modifier.fillMaxWidth())
        Box(Modifier.matchParentSize().clickable(enabled = enabled) { open = true })
        DropdownMenu(open, { open = false }) {
            options.forEach { (key, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onSelect(key) }) }
        }
    }
}

/** Fila de filtros rapidos con contador (equivale a app-quick-chips). */
@Composable internal fun OltChips(chips: List<Triple<String, String, Int>>, active: String?, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        chips.forEach { (key, label, count) -> FilterChip(selected = active == key, onClick = { onSelect(key) }, label = { Text("$label  $count") }) }
    }
}

/** Confirmacion escrita: el boton solo se habilita cuando coincide con el texto que exige el servidor. */
@Composable internal fun OltTypedConfirmation(required: String, value: String, onChange: (String) -> Unit, enabled: Boolean = true) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Para confirmar, escriba exactamente:", style = MaterialTheme.typography.bodySmall)
        OltMono(required, weight = FontWeight.Bold)
        OutlinedTextField(value, onChange, enabled = enabled, singleLine = true, label = { Text("Confirmación") }, modifier = Modifier.fillMaxWidth())
    }
}
internal fun oltConfirmed(required: String?, typed: String) = !required.isNullOrBlank() && typed.trim().uppercase() == required.trim().uppercase()

/** Dialogo a pantalla completa para formularios y asistentes. */
@Composable internal fun OltFullDialog(
    title: String, subtitle: String? = null, eyebrow: String? = null, closeEnabled: Boolean = true, onClose: () -> Unit,
    footer: (@Composable RowScope.() -> Unit)? = null, scrollable: Boolean = true, content: @Composable ColumnScope.() -> Unit,
) {
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (closeEnabled) onClose() }, dismissOnClickOutside = false) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().imePadding()) {
                Surface(tonalElevation = 2.dp, shadowElevation = 2.dp) {
                    Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            eyebrow?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, fontFamily = FontFamily.Monospace, maxLines = 2) }
                        }
                        IconButton(onClick = onClose, enabled = closeEnabled, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Close, "Cerrar") }
                    }
                }
                Column(Modifier.weight(1f).fillMaxWidth().then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier).padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
                if (footer != null) Surface(tonalElevation = 3.dp, shadowElevation = 4.dp) {
                    Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(10.dp, Alignment.End), verticalAlignment = Alignment.CenterVertically, content = footer)
                }
            }
        }
    }
}

/** Dialogo de confirmacion simple (equivale a window.confirm de la web). */
@Composable internal fun OltConfirmDialog(text: String, confirm: String = "Confirmar", onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirm) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } })
}

@Composable internal fun OltCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, accent: Color? = null, content: @Composable ColumnScope.() -> Unit) {
    val inner: @Composable () -> Unit = {
        Row(if (accent != null) Modifier.height(IntrinsicSize.Min) else Modifier) {
            if (accent != null) Box(Modifier.width(4.dp).heightIn(min = 40.dp).fillMaxHeight().background(accent))
            Column(Modifier.padding(14.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp), content = content)
        }
    }
    if (onClick != null) OutlinedCard(onClick = onClick, modifier = modifier.fillMaxWidth()) { inner() }
    else OutlinedCard(modifier.fillMaxWidth()) { inner() }
}

