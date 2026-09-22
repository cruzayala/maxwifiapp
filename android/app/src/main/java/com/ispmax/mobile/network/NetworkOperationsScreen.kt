package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

@Composable
fun NetworkHome(vm: MainViewModel, pages: Map<String, PageState>, capabilities: JSONObject?, open: (String) -> Unit) {
    val path = "/network/summary"
    LaunchedEffect(Unit) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    val incidents = body?.optJSONObject("incidents")
    val wan = body?.optJSONObject("wan")
    val onus = body?.optJSONObject("onus")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("Centro de red", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Datos operativos persistidos en SQLite", style = MaterialTheme.typography.bodySmall) }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar red") }
        }
        ReadStatus(state) { vm.load(path, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NetworkMetric("Incidentes", incidents?.optInt("open")?.toString() ?: "--", Icons.Outlined.WarningAmber, IspAmber, Modifier.weight(1f)) { open("incidents") }
            NetworkMetric("Afectados", incidents?.optInt("affectedClients")?.toString() ?: "--", Icons.Outlined.Groups, IspRed, Modifier.weight(1f)) { open("incidents") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            NetworkMetric("ONU en linea", onus?.optInt("online")?.toString() ?: "--", Icons.Outlined.Hub, IspGreen, Modifier.weight(1f)) { open("onus") }
            NetworkMetric("ONU sin linea", onus?.optInt("offline")?.toString() ?: "--", Icons.Outlined.PortableWifiOff, IspAmber, Modifier.weight(1f)) { open("onus") }
        }
        OutlinedCard(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.SwapVert, null, tint = IspBlue); Spacer(Modifier.width(8.dp)); Text("Enlace WAN", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold) }
                if (wan == null) Text("Todavia no hay muestras WAN", color = MaterialTheme.colorScheme.onSurfaceVariant) else {
                    Row { NetworkValue("Descarga", bps(wan.optDouble("rxBps")), Modifier.weight(1f)); NetworkValue("Subida", bps(wan.optDouble("txBps")), Modifier.weight(1f)) }
                    Row { NetworkValue("Perdida", "${wan.optDouble("pingLossPercent", 0.0)}%", Modifier.weight(1f)); NetworkValue("Latencia", "${wan.optDouble("pingAvgMs", 0.0)} ms", Modifier.weight(1f)) }
                    StatusBadge(wan.text("healthState")); Text("Muestra ${wan.text("capturedAt")}", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (capabilities?.optBoolean("networkLive") == true) MenuRow("Monitoreo en vivo", "Presencia y consumo actual por cliente", Icons.Outlined.Podcasts) { open("live") }
        if (capabilities?.optBoolean("mikrotikRead") == true) MenuRow("MikroTik", "Colas, IPs, firewall, netwatch, respaldos y seguridad", Icons.Outlined.Router) { open("mikrotik") }
        MenuRow("Incidentes NOC", "Reconocer, asignar y resolver", Icons.Outlined.CrisisAlert) { open("incidents") }
        MenuRow("Estabilidad por cliente", "Disponibilidad, consumo y fibra por periodos", Icons.Outlined.QueryStats) { open("network-audit") }
        MenuRow("Historico WAN", "Consumo, latencia, perdida y estabilidad", Icons.Outlined.ShowChart) { open("wan-history") }
        MenuRow("Direcciones IP", "Disponibles, ocupadas y conflictos por segmento", Icons.Outlined.Lan) { open("ipam") }
        MenuRow("OLT y ONU", "Autorizar, reiniciar, asociar clientes, perfiles y NAP", Icons.Outlined.AccountTree) { open("onus") }
        MenuRow("Configurar ONU", "Agentes, asistente guiado, expedientes y reservas IP", Icons.Outlined.SettingsInputAntenna) { open("onu-provisioner") }
        MenuRow("Prueba de velocidad", "Medir desde este telefono y comparar con el plan", Icons.Outlined.Speed) { open("web-bandwidth") }
    }
}

@Composable
private fun NetworkMetric(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, modifier: Modifier, click: () -> Unit) {
    OutlinedCard(onClick = click, modifier = modifier) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) { Icon(icon, null, tint = color); Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.bodySmall) } }
}

@Composable private fun NetworkValue(label: String, value: String, modifier: Modifier) { Column(modifier) { Text(label, style = MaterialTheme.typography.labelSmall); Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) } }
private fun bps(value: Double) = if (value >= 1e9) "%.2f Gbps".format(value / 1e9) else if (value >= 1e6) "%.2f Mbps".format(value / 1e6) else "%.0f Kbps".format(value / 1e3)

@Composable
fun IncidentsScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String = "") {
    var search by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("active") }
    var severity by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var selectedId by rememberSaveable { mutableIntStateOf(0) }
    val path = "/incidents?q=${URLEncoder.encode(search, "UTF-8")}&status=$status&severity=$severity&page=$page&pageSize=30"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        WebParityNocPanel(vm, pages, role)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("${state.body?.optInt("total") ?: 0} incidencias", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Abiertas ${state.body?.optJSONObject("summary")?.optInt("open") ?: 0} · reconocidas ${state.body?.optJSONObject("summary")?.optInt("acknowledged") ?: 0}", style = MaterialTheme.typography.bodySmall) }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar incidencias") }
        }
        OutlinedTextField(search, { search = it; page = 1 }, label = { Text("Buscar incidencia, zona o tecnico") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = status == "active", onClick = { status = "active"; page = 1 }, label = { Text("Activas") })
            FilterChip(selected = status == "resolved", onClick = { status = "resolved"; page = 1 }, label = { Text("Resueltas") })
            FilterChip(selected = severity == "critical", onClick = { severity = if (severity == "critical") "" else "critical"; page = 1 }, label = { Text("Criticas") })
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay incidencias para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selectedId = row.optInt("id") }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(headlineContent = { Text(row.text("title"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("scopeLabel")} · ${row.optInt("affectedClients")} clientes\n${row.text("lastSeenAt")}") }, leadingContent = { Icon(Icons.Outlined.CrisisAlert, null, tint = severityColor(row.optString("severity"))) }, trailingContent = { StatusBadge(row.text("status")) })
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }; Text("Pagina $page"); IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") } }
    }
    if (selectedId > 0) IncidentDialog(selectedId, vm, pages) { selectedId = 0; vm.load(path, true) }
}

@Composable
private fun IncidentDialog(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = "/incidents/$id"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val row = state.body
    var action by rememberSaveable(id) { mutableStateOf("") }
    var note by rememberSaveable(id) { mutableStateOf("") }
    var assignedTo by rememberSaveable(id) { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var key by rememberSaveable(id) { mutableStateOf(UUID.randomUUID().toString()) }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(row?.text("title", "Incidente") ?: "Incidente") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ReadStatus(state) { vm.load(path, true) }
            row?.let {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusBadge(it.text("status")); AssistChip(onClick = {}, label = { Text(it.text("severity")) }) }
                Text(it.text("description")); Text("${it.optInt("affectedClients")} clientes · ${it.text("scopeLabel")}")
                if (action == "assign") OutlinedTextField(assignedTo, { assignedTo = it }, label = { Text("Asignar a") }, singleLine = true)
                if (action in listOf("acknowledge", "resolve", "note")) OutlinedTextField(note, { note = it }, label = { Text(if (action == "resolve") "Nota de solucion" else "Nota") }, modifier = Modifier.fillMaxWidth())
                if (action.isNotBlank()) Notice("La accion quedara en el historial del incidente.")
                Text("Clientes afectados", style = MaterialTheme.typography.titleSmall)
                it.optJSONArray("clients").objects().take(30).forEach { client -> Text("${client.text("nombre")} · ${client.text("ip")}", style = MaterialTheme.typography.bodySmall) }
                Text("Historial", style = MaterialTheme.typography.titleSmall)
                it.optJSONArray("events").objects().take(20).forEach { event -> Text("${event.text("message")} · ${event.text("createdAt")}", style = MaterialTheme.typography.bodySmall) }
            }
            error?.let { Notice(it, true) }
        }
    }, confirmButton = {
        if (row != null && action.isNotBlank()) Button(enabled = !busy && (action != "note" || note.isNotBlank()), onClick = {
            scope.launch { busy = true; error = null; try {
                vm.changeIncident(id, JSONObject().put("action", action).put("note", note).put("assignedTo", assignedTo), key, row.getString("version")); action = ""; note = ""; assignedTo = ""; key = UUID.randomUUID().toString(); vm.load(path, true)
            } catch (e: Exception) { error = e.message } finally { busy = false } }
        }) { Icon(Icons.Outlined.Done, null); Spacer(Modifier.width(8.dp)); Text("Aplicar") }
    }, dismissButton = {
        if (row == null || action.isNotBlank()) TextButton(onClick = { if (action.isNotBlank()) action = "" else close() }) { Text(if (action.isNotBlank()) "Volver" else "Cerrar") }
        else Row { when (row.optString("status")) { "open" -> IconButton(onClick = { action = "acknowledge" }) { Icon(Icons.Outlined.Visibility, "Reconocer") }; "acknowledged" -> IconButton(onClick = { action = "resolve" }) { Icon(Icons.Outlined.TaskAlt, "Resolver") }; "resolved" -> IconButton(onClick = { action = "reopen" }) { Icon(Icons.Outlined.Restore, "Reabrir") } }; IconButton(onClick = { action = "assign"; assignedTo = row.optString("assignedTo") }) { Icon(Icons.Outlined.AssignmentInd, "Asignar") }; IconButton(onClick = { action = "note" }) { Icon(Icons.Outlined.NoteAdd, "Agregar nota") }; TextButton(onClick = close) { Text("Cerrar") } }
    })
}

private fun severityColor(value: String) = when (value) { "critical" -> IspRed; "high" -> IspAmber; else -> IspBlue }
