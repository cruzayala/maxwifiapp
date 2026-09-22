package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Gestion de encuestas como en la web (/encuestas): reenviar por WhatsApp, cancelar, eliminar,
 * copiar enlace, mensaje de WhatsApp (cobranza) y frecuencia de recordatorios (administradores).
 * Las respuestas traen enlaces y tokens publicos: solo se leen en memoria (rutas web no se guardan).
 */
@Composable
fun WebParitySurveysScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String, onClient: (Int) -> Unit = {}) {
    if (!webCan(role, "cobranza")) { Box(Modifier.fillMaxSize().padding(24.dp)) { Notice("Solo cobranza y administradores gestionan encuestas.", true) }; return }
    var status by rememberSaveable { mutableStateOf("") }
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var templateOpen by rememberSaveable { mutableStateOf(false) }
    var configOpen by rememberSaveable { mutableStateOf(false) }
    val listPath = webPath("/api/survey/responses" + if (status.isBlank()) "" else "?status=$status")
    val configPath = webPath("/api/survey/reminders/status")
    LaunchedEffect(listPath) { vm.load(listPath, true) }
    LaunchedEffect(Unit) { vm.load(configPath, true) }
    LaunchedEffect(search) { if (search != query) { delay(300); query = search } }
    val state = pages[listPath] ?: PageState(loading = true)
    val config = pages[configPath]?.body
    val rows = state.body?.optJSONArray("rows").objects().filter { row ->
        if (query.isBlank()) true else {
            val client = row.optJSONObject("client")
            listOf(client?.text("nombre", ""), client?.text("telefono", ""), row.text("clientIp", ""), row.text("fullName", ""), row.text("phone", "")).any { it.orEmpty().contains(query, ignoreCase = true) }
        }
    }
    val actions = rememberWebActions()
    val clipboard = LocalClipboardManager.current
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
        item { WebHeader("Gestion de encuestas", "Reenviar, cancelar y configurar", pages[listPath]?.loading == true, refresh = { vm.load(listPath, true); vm.load(configPath, true) }) }
        item {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val paused = config?.optBoolean("pausedGlobally") == true
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(if (paused) Icons.Outlined.PauseCircle else Icons.Outlined.NotificationsActive, null, tint = if (paused) IspAmber else IspGreen)
                        Spacer(Modifier.width(8.dp)); Text(if (paused) "Recordatorios en pausa" else "Recordatorios activos", fontWeight = FontWeight.Bold)
                    }
                    config?.let { Text("Cada ${formatInterval(it.optInt("intervalHours"))} · maximo ${it.optInt("maxReminders")} envios por persona · minimo ${formatInterval(it.optInt("minIntervalHours"))}", style = MaterialTheme.typography.bodySmall) }
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { templateOpen = true }) { Icon(Icons.Outlined.Chat, null); Spacer(Modifier.width(6.dp)); Text("Mensaje de WhatsApp") }
                        if (webAdmin(role)) OutlinedButton(onClick = { configOpen = true }, enabled = config != null) { Icon(Icons.Outlined.Tune, null); Spacer(Modifier.width(6.dp)); Text("Configurar") }
                        if (webAdmin(role) && config != null) OutlinedButton(onClick = {
                            val pause = !paused
                            actions.confirm(if (pause) "Pausar recordatorios" else "Reanudar recordatorios",
                                if (pause) "¿Pausar TODOS los recordatorios de encuestas? Los envios automaticos se detienen hasta que reanudes." else "Los clientes con encuesta pendiente volveran a recibir recordatorios segun la configuracion.",
                                if (pause) "Pausar" else "Reanudar") {
                                val result = vm.web("POST", "/api/survey/reminders/${if (pause) "pause-all" else "resume-all"}", JSONObject(), configPath)
                                result.serverRejected()?.let { throw IllegalStateException(it) }
                                if (result.has("pausedGlobally") && result.optBoolean("pausedGlobally") != pause) throw IllegalStateException("El servidor no confirmo el cambio")
                                vm.reloadMobile(pages, "/surveys")
                                if (pause) "Recordatorios pausados" else "Recordatorios reanudados"
                            }
                        }) { Icon(if (paused) Icons.Outlined.PlayArrow else Icons.Outlined.Pause, null); Spacer(Modifier.width(6.dp)); Text(if (paused) "Reanudar" else "Pausar todo") }
                    }
                }
            }
        }
        item {
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Cliente, telefono o IP") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf("" to "Todas", "pending" to "Pendientes", "submitted" to "Respondidas", "expired" to "Vencidas", "cancelled" to "Canceladas").forEach { (value, label) ->
                    FilterChip(status == value, { status = value }, label = { Text(label) })
                }
            }
            ReadStatus(state) { vm.load(listPath, true) }
            WebActionFeedback(actions)
            Text("${rows.size} encuestas (maximo 500 mas recientes)", style = MaterialTheme.typography.labelMedium)
        }
        if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay encuestas con estos filtros") }
        items(rows, key = { it.optInt("id") }) { row ->
            val client = row.optJSONObject("client")
            val name = client?.text("nombre", "")?.ifBlank { null } ?: row.text("fullName", row.text("clientIp"))
            val phone = client?.text("telefono", "")?.ifBlank { null } ?: row.text("phone", "")
            val rowStatus = row.optString("status")
            val link = row.text("shortUrl", "").ifBlank { row.text("publicUrl", "") }
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(name, fontWeight = FontWeight.SemiBold)
                            Text("${row.text("clientIp", "")} · ${phone.ifBlank { "sin telefono" }} · ${client?.text("planInternetName", "") ?: ""}", style = MaterialTheme.typography.bodySmall)
                        }
                        StatusBadge(surveyStatusLabel(rowStatus))
                    }
                    Text("Enviada ${row.text("sentAt", "").take(16).replace('T', ' ')}" + (if (row.optInt("reminderCount") > 0) " · ${row.optInt("reminderCount")} recordatorio(s)" else "") +
                        (if (!row.isNull("submittedAt") && row.has("submittedAt")) " · respondio ${row.text("submittedAt").take(10)}" else "") +
                        (if (rowStatus == "pending" && row.has("nextReminderAt") && !row.isNull("nextReminderAt")) " · proximo ${row.text("nextReminderAt").take(16).replace('T', ' ')}" else "") +
                        (if (row.text("sentBy", "").isNotBlank()) " · por ${row.text("sentBy")}" else ""), style = MaterialTheme.typography.labelSmall)
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (rowStatus == "pending") {
                            FilledTonalButton(onClick = {
                                actions.confirm("Reenviar encuesta", "¿Reenviar el mensaje de WhatsApp a $name (${phone.ifBlank { "sin telefono" }})?", "Reenviar") {
                                    val result = vm.web("POST", "/api/survey/resend/${row.optInt("id")}", JSONObject(), listPath)
                                    result.serverRejected()?.let { throw IllegalStateException(it) }
                                    if (!result.optBoolean("ok")) throw IllegalStateException("No se pudo enviar")
                                    "WhatsApp enviado"
                                }
                            }, enabled = !actions.busy) { Icon(Icons.Outlined.Send, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("WhatsApp") }
                            OutlinedButton(onClick = {
                                actions.confirm("Cancelar encuesta", "¿Cancelar la encuesta de $name (IP ${row.text("clientIp", "")})? El enlace dejara de aceptar respuestas. Si quedaba una regla antigua en el MikroTik, tambien se limpia.", "Cancelar encuesta", danger = true) {
                                    val result = vm.web("POST", "/api/survey/cancel/${row.optInt("id")}", JSONObject(), listPath)
                                    result.serverRejected()?.let { throw IllegalStateException(it) }
                                    if (!result.optBoolean("ok")) throw IllegalStateException("El servidor no confirmo la cancelacion")
                                    vm.reloadMobile(pages, "/surveys"); "Encuesta cancelada"
                                }
                            }, enabled = !actions.busy) { Text("Cancelar") }
                        }
                        if (link.isNotBlank()) OutlinedButton(onClick = { clipboard.setText(AnnotatedString(link)); actions.message = "Enlace copiado" }) { Icon(Icons.Outlined.ContentCopy, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("Enlace") }
                        if ((client?.optInt("idServicio") ?: row.optInt("idServicio")) > 0) TextButton(onClick = { onClient(client?.optInt("idServicio") ?: row.optInt("idServicio")) }) { Text("Expediente") }
                        IconButton(onClick = {
                            actions.confirm("Eliminar registro", "¿Eliminar este registro de encuesta de $name? Se borra de forma permanente y no se puede deshacer.", "Eliminar", danger = true) {
                                val result = vm.web("DELETE", "/api/survey/responses/${row.optInt("id")}", null, listPath)
                                result.serverRejected()?.let { throw IllegalStateException(it) }
                                if (result.has("ok") && !result.optBoolean("ok")) throw IllegalStateException("El servidor no confirmo la eliminacion")
                                vm.reloadMobile(pages, "/surveys"); "Registro eliminado"
                            }
                        }, enabled = !actions.busy) { Icon(Icons.Outlined.DeleteOutline, "Eliminar registro", tint = IspRed) }
                    }
                }
            }
        }
    }
    if (templateOpen) SurveyTemplateDialog(vm) { templateOpen = false }
    if (configOpen && config != null) SurveyConfigDialog(vm, config, configPath) { configOpen = false }
}

private fun surveyStatusLabel(value: String) = when (value) { "pending" -> "Pendiente"; "submitted" -> "Respondida"; "expired" -> "Vencida"; "cancelled" -> "Cancelada"; else -> value }

/** 168 -> "1 semana", 48 -> "2 dias", 5 -> "5 horas" (como la web). */
internal fun formatInterval(hours: Int): String = when {
    hours <= 0 -> "—"
    hours % 168 == 0 -> "${hours / 168} ${if (hours / 168 == 1) "semana" else "semanas"}"
    hours % 24 == 0 -> "${hours / 24} ${if (hours / 24 == 1) "dia" else "dias"}"
    else -> "$hours horas"
}

@Composable
private fun SurveyTemplateDialog(vm: MainViewModel, close: () -> Unit) {
    val actions = rememberWebActions()
    var template by remember { mutableStateOf<JSONObject?>(null) }
    var draft by rememberSaveable { mutableStateOf("") }
    var loadError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        try { val body = vm.web("GET", "/api/survey/template"); template = body; if (draft.isBlank()) draft = body.optString("template") }
        catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { loadError = e.message ?: "No se pudo cargar la plantilla" }
    }
    AlertDialog(onDismissRequest = { if (!actions.busy) close() }, title = { Text("Mensaje de la encuesta") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            loadError?.let { Notice(it, true) }
            if (template == null && loadError == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            template?.let { body ->
                Text("Datos: ${body.stringList("placeholders").joinToString(" ")}", style = MaterialTheme.typography.labelSmall)
                OutlinedTextField(draft, { draft = it.take(2000) }, label = { Text("Mensaje de WhatsApp") }, minLines = 6, modifier = Modifier.fillMaxWidth(), isError = !draft.contains("{url}"),
                    supportingText = { Text(if (draft.contains("{url}")) "${draft.length}/2000" else "La plantilla debe contener {url}") })
                TextButton(onClick = { draft = body.optString("default") }) { Text("Restaurar mensaje original") }
            }
            WebActionFeedback(actions)
        }
    }, confirmButton = {
        Button(onClick = {
            actions.run {
                val result = vm.web("PUT", "/api/survey/template", JSONObject().put("template", draft))
                result.serverRejected()?.let { throw IllegalStateException(it) }
                if (!result.optBoolean("ok")) throw IllegalStateException("No se pudo guardar")
                close(); "Plantilla guardada"
            }
        }, enabled = template != null && draft.contains("{url}") && !actions.busy) { Text("Guardar") }
    }, dismissButton = { TextButton(onClick = close, enabled = !actions.busy) { Text("Cerrar") } })
}

@Composable
private fun SurveyConfigDialog(vm: MainViewModel, config: JSONObject, configPath: String, close: () -> Unit) {
    val actions = rememberWebActions()
    val minimum = config.optInt("minIntervalHours").takeIf { it > 0 } ?: 168
    var interval by rememberSaveable { mutableStateOf(config.optInt("intervalHours").toString()) }
    var max by rememberSaveable { mutableStateOf(config.optInt("maxReminders").toString()) }
    val intervalValue = interval.toIntOrNull() ?: 0
    val maxValue = max.toIntOrNull() ?: 0
    val intervalError = when { intervalValue <= 0 -> "Escribe cada cuantas horas se envia el recordatorio."; intervalValue < minimum -> "Debe ser al menos $minimum horas (${formatInterval(minimum)})."; intervalValue > 2160 -> "Debe ser como maximo 2160 horas (90 dias)."; else -> null }
    val maxError = if (maxValue !in 1..10) "Debe ser un numero entre 1 y 10." else null
    AlertDialog(onDismissRequest = { if (!actions.busy) close() }, title = { Text("Recordatorios de encuesta") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(interval, { interval = it.filter(Char::isDigit).take(4) }, label = { Text("Cada cuantas horas") }, isError = intervalError != null, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                supportingText = { Text(intervalError ?: "Equivale a ${formatInterval(intervalValue)}.") })
            OutlinedTextField(max, { max = it.filter(Char::isDigit).take(2) }, label = { Text("Maximo de envios por persona") }, isError = maxError != null, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), supportingText = { maxError?.let { Text(it) } })
            WebActionFeedback(actions)
        }
    }, confirmButton = {
        Button(onClick = {
            actions.run {
                val result = vm.web("PUT", "/api/survey/reminders/config", JSONObject().put("intervalHours", intervalValue).put("maxReminders", maxValue), configPath)
                result.serverRejected()?.let { throw IllegalStateException(it) }
                if (!result.optBoolean("ok")) throw IllegalStateException("El servidor no confirmo la configuracion")
                close(); "Configuracion guardada"
            }
        }, enabled = intervalError == null && maxError == null && !actions.busy) { Text("Guardar") }
    }, dismissButton = { TextButton(onClick = close, enabled = !actions.busy) { Text("Cancelar") } })
}
