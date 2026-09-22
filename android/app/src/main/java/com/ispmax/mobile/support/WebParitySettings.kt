package com.ispmax.mobile

import com.ispmax.mobile.data.WEB_PREFIX
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Claves de /db/settings que maneja la pagina web de configuracion (el resto nunca se lee ni se muestra). */
private val SETTINGS_KEYS = listOf("companyName", "companySlogan", "companyPhone", "companyAddress", "rnc", "defaultPaperSize",
    "autoNotifEnabled", "autoNotifReminderDays", "autoNotifOverdueEnabled", "autoNotifOverdueInterval", "autoNotifScheduleHour",
    "autoNotifReminderMsg", "autoNotifOverdueMsg")

/** Valores por defecto identicos a ConfigService de la web. */
private fun defaultSettings() = mutableMapOf(
    "companyName" to "MaxWiFi RD", "companySlogan" to "Servicio de Internet", "companyPhone" to "", "companyAddress" to "", "rnc" to "",
    "defaultPaperSize" to "80mm", "autoNotifEnabled" to "false", "autoNotifReminderDays" to "3", "autoNotifOverdueEnabled" to "true",
    "autoNotifOverdueInterval" to "3", "autoNotifScheduleHour" to "10",
    "autoNotifReminderMsg" to "Hola {nombre}, le recordamos que su factura de internet con {empresa} vence el {fecha_corte}. Monto: RD$ {precio}. Gracias por su pago puntual.",
    "autoNotifOverdueMsg" to "Hola {nombre}, su servicio de internet con {empresa} tiene un pago pendiente vencido hace {dias_vencido} días. Monto: RD$ {precio}. Para evitar la suspensión, por favor regularice a la brevedad.")

/** Lee la configuracion general de la empresa y avisos (solo las claves conocidas; no se guarda en disco). */
internal suspend fun loadWebSettings(vm: MainViewModel): Map<String, String> {
    val body = vm.web("GET", "/db/settings")
    val values = defaultSettings()
    SETTINGS_KEYS.forEach { key ->
        if (body.has(key) && !body.isNull(key)) {
            val raw = body.optString(key)
            // Igual que ConfigService.apply: los textos vacios no reemplazan el valor por defecto.
            if (raw.isNotEmpty() || key in listOf("autoNotifEnabled", "autoNotifOverdueEnabled", "autoNotifScheduleHour")) values[key] = raw
        }
    }
    return values
}

/**
 * Configuracion (pagina web /settings, solo administradores): datos de la empresa, estado del
 * sistema y reglas del aviso, datos guardados y sincronizacion, avisos automaticos por WhatsApp
 * y pagina de aviso de pago.
 */
@Composable
fun WebParitySettingsScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    if (!webAdmin(role)) { Box(Modifier.fillMaxSize().padding(24.dp)) { Notice("Solo un administrador puede abrir la configuracion.", true) }; return }
    var settings by remember { mutableStateOf<Map<String, String>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    LaunchedEffect(reload) {
        loadError = null
        try { settings = loadWebSettings(vm) } catch (e: CancellationException) { throw e } catch (e: Exception) { loadError = e.message ?: "No se pudo leer la configuracion" }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        WebHeader("Configuracion", "Mismos datos y acciones que la web", refresh = { reload++ })
        loadError?.let { Notice(it, true); TextButton(onClick = { reload++ }) { Text("Reintentar") } }
        val current = settings
        if (current == null && loadError == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (current != null) {
            CompanySettingsSection(vm, current) { settings = it }
        }
        OpsHealthSection(vm, pages, role)
        StoredDataSection(vm, pages)
        if (current != null) AutoNotificationsSection(vm, current) { settings = it }
        PaymentWarningSection(vm, pages, role)
        WebSection("Informacion tecnica", "Solo para soporte o el administrador") {
            WebValue("Aplicacion Android", BuildConfig.VERSION_NAME)
            WebValue("Base de datos", "SQLite + Prisma en el servidor (volumen /data)")
            WebValue("Claves de WispHub, MikroTik y WhatsApp", "Se configuran solo en el servidor; nunca se muestran en la app")
            Notice("El respaldo completo de la base de datos contiene sesiones, claves WiFi y credenciales: se descarga solo desde la web en una computadora de confianza.")
        }
    }
}

/** Envia a /db/settings la misma instantanea de 13 claves que la web. */
private suspend fun saveSnapshot(vm: MainViewModel, values: Map<String, String>): Map<String, String> {
    val body = JSONObject()
    SETTINGS_KEYS.forEach { key ->
        val value = values[key].orEmpty()
        when (key) {
            "autoNotifEnabled", "autoNotifOverdueEnabled" -> body.put(key, value == "true")
            "autoNotifReminderDays", "autoNotifOverdueInterval", "autoNotifScheduleHour" -> body.put(key, value.toIntOrNull() ?: 0)
            else -> body.put(key, value)
        }
    }
    val result = vm.web("PUT", "/db/settings", body)
    result.serverRejected()?.let { throw IllegalStateException(it) }
    if (!result.optBoolean("success")) throw IllegalStateException("El servidor no confirmo el guardado")
    return values
}

@Composable
private fun CompanySettingsSection(vm: MainViewModel, values: Map<String, String>, saved: (Map<String, String>) -> Unit) {
    val actions = rememberWebActions()
    var name by rememberSaveable { mutableStateOf(values["companyName"].orEmpty()) }
    var slogan by rememberSaveable { mutableStateOf(values["companySlogan"].orEmpty()) }
    var phone by rememberSaveable { mutableStateOf(values["companyPhone"].orEmpty()) }
    var rnc by rememberSaveable { mutableStateOf(values["rnc"].orEmpty()) }
    var address by rememberSaveable { mutableStateOf(values["companyAddress"].orEmpty()) }
    var paper by rememberSaveable { mutableStateOf(values["defaultPaperSize"] ?: "80mm") }
    WebSection("Datos de la empresa", "Aparecen en los recibos y mensajes") {
        OutlinedTextField(name, { name = it.take(120) }, label = { Text("Nombre de la empresa") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(slogan, { slogan = it.take(160) }, label = { Text("Eslogan / descripcion") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(phone, { phone = it.take(40) }, label = { Text("Telefono") }, placeholder = { Text("809-000-0000") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        OutlinedTextField(rnc, { rnc = it.take(40) }, label = { Text("RNC / Cedula") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(address, { address = it.take(240) }, label = { Text("Direccion") }, modifier = Modifier.fillMaxWidth())
        Text("Tamano de papel para recibos", style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(paper == "58mm", { paper = "58mm" }, label = { Text("58 mm (pequena)") })
            FilterChip(paper == "80mm", { paper = "80mm" }, label = { Text("80 mm (estandar)") })
        }
        WebActionFeedback(actions)
        Button(onClick = {
            actions.run {
                val next = values + mapOf("companyName" to name.trim(), "companySlogan" to slogan.trim(), "companyPhone" to phone.trim(), "rnc" to rnc.trim(), "companyAddress" to address.trim(), "defaultPaperSize" to paper)
                saved(saveSnapshot(vm, next)); "Configuracion guardada"
            }
        }, enabled = !actions.busy && name.isNotBlank()) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text("Guardar datos") }
    }
}

@Composable
private fun OpsHealthSection(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    val path = webPath("/ops/status")
    LaunchedEffect(Unit) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val health = state.body
    val actions = rememberWebActions()
    WebSection("Estado del sistema", health?.text("checkedAt", "")?.takeIf { it.isNotBlank() }?.let { "Ultima revision: $it" }) {
        ReadStatus(state) { vm.load(path, true) }
        if (health != null) {
            HealthRow("Base de datos", health.optJSONObject("database")?.optBoolean("connected") == true, if (health.optJSONObject("database")?.optBoolean("connected") == true) "Conectada" else "Con error")
            HealthRow("WispHub", health.optJSONObject("wisphub")?.optBoolean("configured") == true, if (health.optJSONObject("wisphub")?.optBoolean("configured") == true) "Conectado" else "Sin configurar")
            HealthRow("MikroTik", health.optJSONObject("mikrotik")?.optBoolean("connected") == true, if (health.optJSONObject("mikrotik")?.optBoolean("connected") == true) "Conectado" else "Desconectado")
            val wa = health.optJSONObject("whatsapp")?.optString("status").orEmpty()
            HealthRow("WhatsApp", wa == "connected", waStatusLabel(wa))
            val counts = health.optJSONObject("counts")
            WebValue("Clientes / facturas", "${counts?.optInt("clients") ?: 0} / ${counts?.optInt("invoices") ?: 0}")
            WebValue("Encuestas / promesas de pago pendientes", "${counts?.optInt("pendingSurveys") ?: 0} / ${counts?.optInt("pendingPromises") ?: 0}")
            health.optJSONObject("mikrotik")?.optJSONObject("captiveRules")?.let { captive ->
                HorizontalDivider()
                Text("Reglas del aviso de pago en el MikroTik", fontWeight = FontWeight.SemiBold)
                val rules = captive.optJSONObject("rules")
                listOf("morosoRedirect" to "Aviso a morosos", "bloqueadoRedirect" to "Aviso a bloqueados", "allowDns" to "Permitir DNS", "allowCaptive" to "Permitir pagina de aviso", "dropRest" to "Cortar resto a bloqueados").forEach { (key, label) ->
                    val ok = rules?.optJSONObject(key)?.optBoolean("ok") == true
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(if (ok) Icons.Outlined.CheckCircle else Icons.Outlined.Cancel, null, tint = if (ok) IspGreen else IspRed, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text(label, style = MaterialTheme.typography.bodySmall) }
                }
                captive.optJSONObject("target")?.let { Text("Destino del aviso: ${it.text("address")}:${it.text("port")}", style = MaterialTheme.typography.labelSmall) }
            }
        }
        WebActionFeedback(actions)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Revisar ahora") }
            if (webAdmin(role)) OutlinedButton(onClick = {
                actions.confirm("Reparar reglas del aviso", "Se actualizan las reglas de morosos-crm y bloqueados-crm en el MikroTik para que apunten a este servidor. Afecta a los clientes morosos y bloqueados que esten navegando.", "Reparar", danger = true) {
                    val result = vm.web("POST", "/ops/repair-captive", JSONObject())
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    if (!result.optBoolean("ok")) throw IllegalStateException("El MikroTik no confirmo la reparacion")
                    vm.load(path, true); "Reglas del aviso de pago reparadas correctamente."
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.Build, null); Spacer(Modifier.width(6.dp)); Text("Reparar reglas del aviso") }
        }
    }
}

internal fun waStatusLabel(status: String?): String = when (status) {
    "connected" -> "Conectado"; "disconnected" -> "Desconectado"; "qr" -> "Esperando QR"; "connecting" -> "Conectando"
    "conflict" -> "Sesion en conflicto"; "logged_out" -> "Sesion cerrada"; "error" -> "Con error"; null, "" -> "Sin datos"; else -> status
}

@Composable private fun HealthRow(label: String, ok: Boolean, value: String) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Icon(if (ok) Icons.Outlined.CheckCircle else Icons.Outlined.ErrorOutline, null, tint = if (ok) IspGreen else IspAmber, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp)); Text(value, fontWeight = FontWeight.SemiBold, color = if (ok) IspGreen else IspAmber)
    }
}

@Composable
private fun StoredDataSection(vm: MainViewModel, pages: Map<String, PageState>) {
    val statsPath = webPath("/db/stats"); val syncPath = webPath("/sync/status")
    LaunchedEffect(Unit) { vm.load(statsPath, true); vm.load(syncPath, true) }
    val stats = pages[statsPath]?.body; val sync = pages[syncPath]?.body
    val actions = rememberWebActions()
    WebSection("Datos guardados", "Al sincronizar con WispHub se actualizan los registros existentes y se agregan los nuevos; no se borra nada.") {
        ReadStatus(pages[statsPath] ?: PageState(loading = true)) { vm.load(statsPath, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WebKpi("Clientes", "${stats?.optJSONObject("clients")?.optInt("count") ?: 0}", Modifier.weight(1f))
            WebKpi("Facturas", "${stats?.optJSONObject("invoices")?.optInt("count") ?: 0}", Modifier.weight(1f))
            WebKpi("IP registradas", "${stats?.optJSONObject("ipam")?.optInt("count") ?: 0}", Modifier.weight(1f))
        }
        WebValue("Ultima sincronizacion", sync?.text("lastSyncAt", "Nunca") ?: "Nunca")
        sync?.optJSONObject("lastSyncResult")?.let { last -> Text("Ultimo resultado: ${last.optInt("updated")} actualizados · ${last.optInt("errors")} con errores", style = MaterialTheme.typography.bodySmall) }
        WebActionFeedback(actions)
        OutlinedButton(onClick = {
            actions.confirm("Sincronizar con WispHub", "Se leen ahora los clientes y facturas de WispHub y se actualizan en el servidor. Puede tardar varios minutos.", "Sincronizar") {
                try {
                    val result = vm.web("POST", "/sync/run", JSONObject(), WEB_PREFIX + "/db/stats", WEB_PREFIX + "/sync/status")
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    val errors = result.optInt("errors")
                    "Sincronizacion completa: ${result.optInt("updated")} clientes actualizados" + if (errors > 0) ", $errors con errores" else ""
                } catch (e: java.io.InterruptedIOException) {
                    vm.load(syncPath, true); throw IllegalStateException("La sincronizacion sigue en el servidor y tarda mas de lo que espera el telefono. Revisa la ultima sincronizacion en unos minutos.")
                }
            }
        }, enabled = !actions.busy) { Icon(Icons.Outlined.CloudSync, null); Spacer(Modifier.width(6.dp)); Text("Sincronizar ahora") }
    }
}

@Composable
private fun AutoNotificationsSection(vm: MainViewModel, values: Map<String, String>, saved: (Map<String, String>) -> Unit) {
    val actions = rememberWebActions()
    var enabled by remember(values) { mutableStateOf(values["autoNotifEnabled"] == "true") }
    var overdueEnabled by remember(values) { mutableStateOf(values["autoNotifOverdueEnabled"] == "true") }
    var hour by rememberSaveable { mutableStateOf(values["autoNotifScheduleHour"].orEmpty()) }
    var reminderDays by rememberSaveable { mutableStateOf(values["autoNotifReminderDays"].orEmpty()) }
    var interval by rememberSaveable { mutableStateOf(values["autoNotifOverdueInterval"].orEmpty()) }
    var reminderMsg by rememberSaveable { mutableStateOf(values["autoNotifReminderMsg"].orEmpty()) }
    var overdueMsg by rememberSaveable { mutableStateOf(values["autoNotifOverdueMsg"].orEmpty()) }
    val validHour = hour.toIntOrNull()?.let { it in 0..23 } == true
    val validDays = reminderDays.toIntOrNull()?.let { it in 1..10 } == true
    val validInterval = interval.toIntOrNull()?.let { it in 1..30 } == true
    fun snapshot(nextEnabled: Boolean = enabled, nextOverdue: Boolean = overdueEnabled) = values + mapOf(
        "autoNotifEnabled" to nextEnabled.toString(), "autoNotifOverdueEnabled" to nextOverdue.toString(), "autoNotifScheduleHour" to hour,
        "autoNotifReminderDays" to reminderDays, "autoNotifOverdueInterval" to interval, "autoNotifReminderMsg" to reminderMsg, "autoNotifOverdueMsg" to overdueMsg)
    WebSection("Avisos automaticos por WhatsApp", "Envia mensajes a clientes con pago pendiente o cerca de la fecha de corte. Necesita WhatsApp conectado.") {
        WebSwitchRow("Envio automatico ${if (enabled) "activado" else "apagado"}", "La web revisa cada 30 minutos si debe enviar. Se guarda al tocar el interruptor.", enabled, !actions.busy && validHour && validDays && validInterval) { next ->
            actions.run { saved(saveSnapshot(vm, snapshot(nextEnabled = next))); enabled = next; "Configuracion guardada" }
        }
        OutlinedTextField(hour, { hour = it.filter(Char::isDigit).take(2) }, label = { Text("Hora del dia para enviar (0 a 23)") }, isError = !validHour, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            supportingText = { Text(if (validHour) "Se enviara a las ${formatHour(hour.toInt())}." else "Escribe una hora entre 0 y 23.") })
        OutlinedTextField(reminderDays, { reminderDays = it.filter(Char::isDigit).take(2) }, label = { Text("Dias antes del corte para recordar") }, isError = !validDays, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), supportingText = { Text("Entre 1 y 10 dias.") })
        OutlinedTextField(reminderMsg, { reminderMsg = it.take(1000) }, label = { Text("Mensaje de recordatorio (antes del corte)") }, minLines = 3, modifier = Modifier.fillMaxWidth(), supportingText = { Text("Datos: {nombre} {empresa} {fecha_corte} {precio} {plan}") })
        WebSwitchRow("Avisar a clientes ya vencidos (morosos)", "Se repite cada ${interval.ifBlank { "?" }} dias mientras no pague.", overdueEnabled, !actions.busy && validHour && validDays && validInterval) { next ->
            actions.run { saved(saveSnapshot(vm, snapshot(nextOverdue = next))); overdueEnabled = next; "Configuracion guardada" }
        }
        OutlinedTextField(interval, { interval = it.filter(Char::isDigit).take(2) }, label = { Text("Cada cuantos dias reenviar al moroso") }, isError = !validInterval, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        OutlinedTextField(overdueMsg, { overdueMsg = it.take(1000) }, label = { Text("Mensaje para morosos (ya vencido)") }, minLines = 3, modifier = Modifier.fillMaxWidth(), supportingText = { Text("Datos: {nombre} {empresa} {fecha_corte} {precio} {dias_vencido}") })
        WebActionFeedback(actions)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { actions.run { saved(saveSnapshot(vm, snapshot())); "Configuracion guardada" } }, enabled = !actions.busy && validHour && validDays && validInterval) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(6.dp)); Text("Guardar avisos") }
            OutlinedButton(onClick = {
                actions.confirm("Enviar avisos ahora", "Se enviaran mensajes reales por WhatsApp a los clientes que cumplan las condiciones, sin esperar la hora programada.", "Enviar ahora", danger = true) {
                    val result = runAutoNotificationsNow(vm, snapshot())
                    "${result.first} notificaciones automaticas enviadas de ${result.second}" + if (result.third > 0) " · ${result.third} sin confirmar (no se repiten)" else ""
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.Send, null); Spacer(Modifier.width(6.dp)); Text("Enviar ahora") }
        }
    }
}

internal fun formatHour(hour: Int): String { val suffix = if (hour < 12) "a. m." else "p. m."; val h12 = if (hour % 12 == 0) 12 else hour % 12; return "$h12:00 $suffix" }

/** Fecha dd/MM/yyyy de WispHub (o ISO) como en el programador de la web. */
private fun parseCutDate(value: String): Calendar? {
    if (value.isBlank()) return null
    val parts = value.split("/")
    return try {
        if (parts.size == 3) Calendar.getInstance().apply { clear(); set(parts[2].trim().toInt(), parts[1].trim().toInt() - 1, parts[0].trim().toInt()) }
        else Calendar.getInstance().apply { time = SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(value.take(10))!! }
    } catch (_: Exception) { null }
}

/**
 * Mismo trabajo que NotificationSchedulerService.runNow de la web: calcula los recordatorios y
 * avisos de mora, envia por /wa/send-bulk (en tandas para no superar el tiempo de espera) y
 * registra en /db/notification-sent solo lo que el servidor confirmo como enviado.
 * Devuelve (enviados, candidatos, sin confirmar).
 */
private suspend fun runAutoNotificationsNow(vm: MainViewModel, cfg: Map<String, String>): Triple<Int, Int, Int> {
    val state = vm.web("GET", "/db/notification-state")
    val sentLog = mutableMapOf<String, Long>()
    val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
    state.optJSONArray("sent").objects().forEach { row ->
        val key = "${row.optString("type")}_${row.optString("phone").filter(Char::isDigit)}"
        val at = runCatching { iso.parse(row.optString("sentAt").take(19))!!.time }.getOrNull()
        if (at != null && key !in sentLog) sentLog[key] = at
    }
    fun recentlySent(phone: String, type: String, maxDays: Int): Boolean {
        val at = sentLog["${type}_${phone.filter(Char::isDigit)}"] ?: return false
        return (System.currentTimeMillis() - at) / 86_400_000.0 < maxDays
    }
    val company = cfg["companyName"].orEmpty()
    val reminderDays = cfg["autoNotifReminderDays"]?.toIntOrNull() ?: 3
    val overdueEnabled = cfg["autoNotifOverdueEnabled"] == "true"
    val overdueInterval = cfg["autoNotifOverdueInterval"]?.toIntOrNull() ?: 3
    fun build(template: String, client: JSONObject, days: Int) = template
        .replace("{nombre}", client.text("nombre", "")).replace("{empresa}", company)
        .replace("{fecha_corte}", client.text("fechaCorte", "")).replace("{precio}", client.text("precioPlan", "0"))
        .replace("{dias_vencido}", days.toString()).replace("{plan}", client.text("planInternetName", ""))
    // Clientes completos del servidor: solo en memoria durante el envio (traen datos sensibles).
    val clients = vm.web("GET", "/db/clients?limit=100000").optJSONArray("items").objects()
    val today = Calendar.getInstance()
    val contacts = mutableListOf<JSONObject>()
    clients.forEach { client ->
        val phone = client.text("telefono", "")
        if (phone.length < 7 || !client.text("estado", "").equals("activo", true)) return@forEach
        val cut = parseCutDate(client.text("fechaCorte", "")) ?: return@forEach
        val daysToCut = Math.floorDiv(cut.timeInMillis - today.timeInMillis, 86_400_000L).toInt()
        val pending = client.text("estadoFacturas", "").lowercase().contains("pendiente")
        if (daysToCut in 0..reminderDays && pending && !recentlySent(phone, "reminder", 7))
            contacts += JSONObject().put("phone", phone).put("idServicio", client.optInt("idServicio")).put("clientName", client.text("nombre", "")).put("message", build(cfg["autoNotifReminderMsg"].orEmpty(), client, kotlin.math.abs(daysToCut))).put("type", "reminder")
        if (overdueEnabled && daysToCut < 0 && pending && !recentlySent(phone, "overdue", overdueInterval))
            contacts += JSONObject().put("phone", phone).put("idServicio", client.optInt("idServicio")).put("clientName", client.text("nombre", "")).put("message", build(cfg["autoNotifOverdueMsg"].orEmpty(), client, kotlin.math.abs(daysToCut))).put("type", "overdue")
    }
    var sent = 0; var uncertain = 0
    contacts.chunked(10).forEachIndexed { index, chunk ->
        val response = try { vm.web("POST", "/wa/send-bulk", JSONObject().put("contacts", JSONArray(chunk.map { JSONObject(it.toString()).apply { remove("type") } }))) }
        catch (e: java.io.InterruptedIOException) { uncertain += contacts.size - index * 10; vm.web("POST", "/db/notification-state/run", JSONObject()); return Triple(sent, contacts.size, uncertain) }
        response.optJSONArray("results").objects().filter { it.optString("status") == "sent" }.forEach { result ->
            chunk.firstOrNull { it.optString("phone") == result.optString("phone") }?.let { item ->
                vm.web("POST", "/db/notification-sent", JSONObject().put("phone", item.optString("phone")).put("type", item.optString("type")).put("idServicio", item.optInt("idServicio")))
                sent++
            }
        }
    }
    vm.web("POST", "/db/notification-state/run", JSONObject())
    return Triple(sent, contacts.size, uncertain)
}

@Composable
private fun PaymentWarningSection(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    val path = webPath("/payment-warning/status")
    LaunchedEffect(Unit) { vm.load(path, true) }
    val config = pages[path]?.body?.optJSONObject("config")
    val actions = rememberWebActions()
    var enabled by remember(config) { mutableStateOf(config?.optBoolean("enabled") == true) }
    var days by remember(config) { mutableStateOf((config?.optInt("overdueDays")?.takeIf { it > 0 } ?: 15).toString()) }
    var hour by remember(config) { mutableStateOf((if (config?.has("runHour") == true) config.optInt("runHour") else 9).toString()) }
    var preview by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val validHour = hour.toIntOrNull()?.let { it in 0..23 } == true
    val validDays = days.toIntOrNull()?.let { it in 1..90 } == true
    suspend fun save(nextEnabled: Boolean): String {
        val result = vm.web("PUT", "/payment-warning/settings", JSONObject().put("enabled", nextEnabled).put("overdueDays", days.toInt()).put("runHour", hour.toInt()), path)
        result.serverRejected()?.let { throw IllegalStateException(it) }
        val saved = result.optJSONObject("config") ?: throw IllegalStateException("El servidor no confirmo el aviso")
        enabled = saved.optBoolean("enabled"); return "Configuracion del aviso guardada."
    }
    WebSection("Pagina de aviso de pago", "Marca como \"moroso suave\" a los clientes con factura vencida. Al navegar veran una pagina con su factura pendiente. No es un corte total.") {
        ReadStatus(pages[path] ?: PageState(loading = true)) { vm.load(path, true) }
        val admin = webAdmin(role)
        WebSwitchRow("Aviso automatico ${if (enabled) "activado" else "apagado"}", "Solo se aplica cuando este interruptor esta encendido.", enabled, admin && config != null && !actions.busy && validDays && validHour) { next -> actions.run { save(next) } }
        OutlinedTextField(days, { days = it.filter(Char::isDigit).take(2) }, label = { Text("Dias de atraso para mostrar el aviso") }, isError = !validDays, singleLine = true, enabled = admin, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        OutlinedTextField(hour, { hour = it.filter(Char::isDigit).take(2) }, label = { Text("Hora de revision diaria (0 a 23)") }, isError = !validHour, singleLine = true, enabled = admin, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            supportingText = { Text(if (validHour) "Se revisa todos los dias a las ${formatHour(hour.toInt())}." else "Escribe una hora entre 0 y 23.") })
        WebActionFeedback(actions)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (admin) Button(onClick = { actions.run { save(enabled) } }, enabled = config != null && !actions.busy && validDays && validHour) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(6.dp)); Text("Guardar aviso") }
            OutlinedButton(onClick = {
                actions.run {
                    val result = vm.web("GET", "/payment-warning/preview")
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    preview = result.optJSONArray("candidates").objects()
                    val n = result.optInt("count")
                    if (n == 0) "Ningun cliente cumple la condicion ahora mismo." else "$n ${if (n == 1) "cliente cumple" else "clientes cumplen"} la condicion actual."
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.Visibility, null); Spacer(Modifier.width(6.dp)); Text("Ver a quien aplica") }
            OutlinedButton(onClick = {
                actions.confirm("Aplicar el aviso de pago ahora", "Los clientes que cumplan la condicion se marcaran como \"moroso suave\" y veran la pagina de aviso al navegar.", "Aplicar ahora", danger = true) {
                    val result = vm.web("POST", "/payment-warning/run", JSONObject())
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    if (result.has("ran") && !result.optBoolean("ran")) throw IllegalStateException("El aviso automatico esta apagado. No se aplico ningun cambio.")
                    preview = result.optJSONArray("actions").objects()
                    "Listo: aviso aplicado a ${result.optInt("applied")}, ${result.optInt("alreadyMoroso")} ya lo tenian y ${result.optInt("cleared")} se quitaron porque ya pagaron."
                }
            }, enabled = admin && enabled && !actions.busy) { Icon(Icons.Outlined.PlayArrow, null); Spacer(Modifier.width(6.dp)); Text("Aplicar ahora") }
        }
        if (!enabled) Text("\"Aplicar ahora\" se habilita cuando el aviso automatico esta activado.", style = MaterialTheme.typography.labelSmall)
        if (preview.isNotEmpty()) {
            Text("${preview.size} ${if (preview.size == 1) "cliente cumple" else "clientes cumplen"} la condicion" + if (preview.size > 10) " · se muestran los primeros 10" else "", fontWeight = FontWeight.SemiBold)
            preview.take(10).forEach { row ->
                val invoice = row.optJSONObject("invoice")
                Text("${row.text("nombre")} · ${row.text("ip", "—")} · ${row.optInt("overdueDays")} dias · factura ${invoice?.text("folio", invoice.text("idFactura", "—")) ?: "—"} · ${wouldDoLabel(row.text("wouldDo", row.text("reason", "")))}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

private fun wouldDoLabel(action: String) = when (action) {
    "moroso" -> "Mostrar aviso"; "block" -> "Bloquear"; "already_moroso" -> "Ya tiene aviso"; "skip_blocked", "already_blocked" -> "Ya esta bloqueado"; "" -> "—"; else -> action
}
