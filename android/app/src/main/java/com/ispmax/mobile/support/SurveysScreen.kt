package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLEncoder
import java.util.UUID

/**
 * Encuestas de satisfaccion: como van las respuestas y la pausa global de recordatorios.
 * Enviar encuestas nuevas se hace desde la web, porque hay que elegir clientes y listas del MikroTik.
 */
@Composable internal fun SurveysScreen(vm: MainViewModel, pages: Map<String, PageState>, onClient: (Int) -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var confirm by remember { mutableStateOf<Boolean?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val path = "/surveys?q=${URLEncoder.encode(query, "UTF-8")}&status=$status&page=$page&pageSize=30"
    LaunchedEffect(search) { if (search != query) { delay(350); query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    val summary = body?.optJSONObject("summary")
    val reminders = body?.optJSONObject("reminders")
    val paused = reminders?.optBoolean("pausedGlobally") == true
    val rows = body?.optJSONArray("items").objects()

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${summary?.optDouble("responseRate") ?: 0.0}% respondieron", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = IspGreen)
                    Text("${summary?.optInt("submitted") ?: 0} de ${summary?.optInt("sent") ?: 0} encuestas enviadas", style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar encuestas") }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SurveyMetric("Pendientes", summary?.optInt("pending") ?: 0, Modifier.weight(1f))
                SurveyMetric("Respondidas", summary?.optInt("submitted") ?: 0, Modifier.weight(1f))
                SurveyMetric("Vencidas", summary?.optInt("expired") ?: 0, Modifier.weight(1f))
            }
        }
        item {
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(if (paused) "Recordatorios en pausa" else "Recordatorios activos", fontWeight = FontWeight.Bold) },
                    supportingContent = { Text(reminders?.let { "Cada ${it.optInt("intervalHours")} horas, hasta ${it.optInt("maxReminders")} veces por cliente" } ?: "Consultando configuracion") },
                    leadingContent = { Icon(if (paused) Icons.Outlined.PauseCircle else Icons.Outlined.NotificationsActive, null, tint = if (paused) IspAmber else IspGreen) },
                    trailingContent = { Switch(checked = !paused, onCheckedChange = { active -> confirm = !active }, enabled = body?.optBoolean("canManage") == true && !busy) },
                )
            }
            if (body != null && !body.optBoolean("canManage")) Text("Solo un administrador puede pausar o reanudar los recordatorios.", style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
            error?.let { Notice(it, true) }
        }
        item {
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Cliente, telefono o IP") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
            Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                listOf("" to "Todas", "pending" to "Pendientes", "submitted" to "Respondidas", "expired" to "Vencidas", "cancelled" to "Canceladas").forEach { (value, label) ->
                    FilterChip(status == value, { status = value; page = 1 }, label = { Text(label) })
                }
            }
            ReadStatus(state) { vm.load(path, true) }
        }
        if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay encuestas con estos filtros") }
        items(rows, key = { it.optInt("id") }) { row ->
            val idServicio = row.optInt("idServicio")
            OutlinedCard(onClick = { if (idServicio > 0) onClient(idServicio) }, enabled = idServicio > 0, modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(row.text("clientName", row.text("fullName", row.text("clientIp"))), fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("${surveyStatus(row.optString("status"))} · enviada ${row.text("sentAt").take(10)}" + (if (row.optInt("reminderCount") > 0) " · ${row.optInt("reminderCount")} recordatorio(s)" else "") + (if (row.optBoolean("paused")) " · pausada" else "")) },
                    leadingContent = { Icon(if (row.optString("status") == "submitted") Icons.Outlined.TaskAlt else Icons.Outlined.Schedule, null, tint = if (row.optString("status") == "submitted") IspGreen else IspAmber) },
                )
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
                Text("Pagina $page · ${body?.optInt("total") ?: 0}", style = MaterialTheme.typography.labelLarge)
                IconButton(onClick = { page++ }, enabled = body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
            }
        }
    }
    confirm?.let { pause ->
        AlertDialog(onDismissRequest = { if (!busy) confirm = null },
            title = { Text(if (pause) "Pausar recordatorios" else "Reanudar recordatorios") },
            text = { Text(if (pause) "Ningun cliente recibira recordatorios de encuesta hasta que los reanudes." else "Los clientes con encuesta pendiente volveran a recibir recordatorios segun la configuracion.") },
            confirmButton = { Button(enabled = !busy, onClick = { scope.launch { busy = true; error = null; try { vm.setSurveyReminders(pause, UUID.randomUUID().toString()); confirm = null } catch (failure: Exception) { error = failure.message } finally { busy = false } } }) { Text("Confirmar") } },
            dismissButton = { TextButton(onClick = { confirm = null }, enabled = !busy) { Text("Cancelar") } })
    }
}

private fun surveyStatus(value: String) = when (value) { "pending" -> "Pendiente"; "submitted" -> "Respondida"; "expired" -> "Vencida"; "cancelled" -> "Cancelada"; else -> value }

@Composable private fun SurveyMetric(label: String, value: Int, modifier: Modifier) {
    OutlinedCard(modifier) { Column(Modifier.padding(12.dp)) { Text("$value", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.labelSmall) } }
}
