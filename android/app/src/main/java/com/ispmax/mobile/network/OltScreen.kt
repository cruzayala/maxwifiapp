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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import java.net.URLEncoder

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OltScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val statusPath = "/olt/status"
    LaunchedEffect(Unit) { vm.load(statusPath, true); vm.load("/pons", true) }
    val state = pages[statusPath] ?: PageState(loading = true)
    val totals = state.body?.optJSONObject("totals")
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("OLT y ONU", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Inventario, fibra y autorizacion", style = MaterialTheme.typography.bodySmall) }
                IconButton(onClick = { vm.load(statusPath, true); vm.load("/pons", true) }) { Icon(Icons.Outlined.Refresh, "Actualizar OLT") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OltKpi("En linea", totals?.optInt("online")?.toString() ?: "--", IspGreen, Modifier.weight(1f))
                OltKpi("Sin linea", totals?.optInt("offline")?.toString() ?: "--", IspRed, Modifier.weight(1f))
                OltKpi("Pendientes", totals?.optInt("pending")?.toString() ?: "--", IspAmber, Modifier.weight(1f))
            }
            ReadStatus(state) { vm.load(statusPath, true) }
        }
        PrimaryTabRow(selectedTabIndex = tab) {
            listOf("PON", "ONU", "Pendientes", "Alarmas").forEachIndexed { index, label -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) }) }
        }
        when (tab) {
            0 -> OltPorts(vm, pages) { tab = 1 }
            1 -> OltOnus(vm, pages)
            2 -> OltPending(vm, pages)
            else -> OltAlarms(vm, pages)
        }
    }
}

@Composable private fun OltKpi(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier) { OutlinedCard(modifier) { Column(Modifier.padding(11.dp)) { Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium); Text(label, style = MaterialTheme.typography.labelSmall) } } }

@Composable
private fun OltPorts(vm: MainViewModel, pages: Map<String, PageState>, showOnus: () -> Unit) {
    val state = pages["/pons"] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (rows.isEmpty() && !state.loading) item { EmptyState("No hay puertos PON almacenados") }
        items(rows, key = { it.text("key") }) { port -> OutlinedCard(onClick = showOnus, modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.AccountTree, null, tint = IspBlue); Spacer(Modifier.width(8.dp)); Text("PON ${port.text("key")}", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text("${port.optInt("total")} ONU") }; LinearProgressIndicator(progress = { port.optInt("online").toFloat() / port.optInt("total").coerceAtLeast(1) }, modifier = Modifier.fillMaxWidth()); Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { Text("${port.optInt("online")} en linea", color = IspGreen); Text("${port.optInt("offline")} sin linea", color = IspRed) }; Text("Lectura ${port.text("lastSeenAt")}", style = MaterialTheme.typography.bodySmall) } } }
    }
}

@Composable
private fun OltOnus(vm: MainViewModel, pages: Map<String, PageState>) {
    var query by rememberSaveable { mutableStateOf("") }; var status by rememberSaveable { mutableStateOf("all") }; var page by rememberSaveable { mutableIntStateOf(1) }; var detail by rememberSaveable { mutableIntStateOf(0) }
    val path = "/olt/onus?q=${URLEncoder.encode(query, "UTF-8")}&status=$status&page=$page&pageSize=40"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(query, { query = it; page = 1 }, label = { Text("Nombre, serial, modelo o posicion") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("all" to "Todas", "online" to "En linea", "offline" to "Sin linea").forEach { (key, label) -> FilterChip(selected = status == key, onClick = { status = key; page = 1 }, label = { Text(label) }) } }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            if (rows.isEmpty() && !state.loading) item { EmptyState("No hay ONU para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                val client = row.optJSONObject("client")
                OutlinedCard(onClick = { detail = row.optInt("id") }, modifier = Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("name", row.text("serial")), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("serial")} · ${row.text("onuIndex")} · ${row.text("model")}\n${client?.let { it.text("aliasNombre", it.text("nombre")) } ?: "Sin asociar"} · RX ${row.text("rxPowerDbm")} dBm") }, leadingContent = { Icon(Icons.Outlined.Router, null, tint = if (row.optBoolean("online")) IspGreen else IspRed) }, trailingContent = { StatusBadge(if (row.optBoolean("online")) "En linea" else "Sin linea") }) }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }; Text("${state.body?.optInt("total") ?: 0} ONU", style = MaterialTheme.typography.bodySmall); IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") } }
    }
    if (detail > 0) OltOnuDialog(detail, vm, pages) { detail = 0 }
}

@Composable
private fun OltOnuDialog(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = "/olt/onus/$id"; LaunchedEffect(id) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val body = state.body; val onu = body?.optJSONObject("onu"); val client = body?.optJSONObject("client"); val tr069 = body?.optJSONObject("tr069"); val readings = body?.optJSONArray("opticalHistory").objects(); val alerts = body?.optJSONArray("alerts").objects()
    AlertDialog(onDismissRequest = close, title = { Text(onu?.let { it.text("name", it.text("serial")) } ?: "Detalle ONU") }, text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ReadStatus(state) { vm.load(path, true) }
        onu?.let { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusBadge(if (it.optBoolean("online")) "En linea" else "Sin linea"); AssistChip({}, label = { Text(it.text("onuIndex")) }) }; Text("${it.text("model")} · ${it.text("serial")}"); Row { OltValue("RX", "${it.text("rxPowerDbm")} dBm", Modifier.weight(1f)); OltValue("TX", "${it.text("txPowerDbm")} dBm", Modifier.weight(1f)) }; Row { OltValue("Distancia", "${it.text("distanceM")} m", Modifier.weight(1f)); OltValue("Fase", it.text("phaseState"), Modifier.weight(1f)) } }
        Text("Cliente", fontWeight = FontWeight.SemiBold); if (client == null) Text("Sin asociar", color = IspAmber) else Text("${client.text("aliasNombre", client.text("nombre"))}\n${client.text("ip")} · ${client.text("planInternetName")}")
        Text("Administracion remota", fontWeight = FontWeight.SemiBold); if (tr069 == null) Text("TR-069 no registrado para este serial", color = MaterialTheme.colorScheme.onSurfaceVariant) else { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusBadge(tr069.text("status")); AssistChip({}, label = { Text(if (tr069.optBoolean("enabled")) "Habilitado" else "Deshabilitado") }) }; Text("${tr069.text("manufacturer")} ${tr069.text("model")} · ${tr069.text("softwareVersion")}"); Text("Ultimo Inform: ${tr069.text("lastInformAt")}", style = MaterialTheme.typography.bodySmall) }
        Text("Historial optico", fontWeight = FontWeight.SemiBold); if (readings.isEmpty()) Text("Sin lecturas historicas") else { OpticalLine(readings.map { it.optDouble("rxPowerDbm", Double.NaN) }); readings.takeLast(8).asReversed().forEach { Text("${it.text("capturedAt")} · RX ${it.text("rxPowerDbm")} dBm", style = MaterialTheme.typography.bodySmall) } }
        if (alerts.isNotEmpty()) { Text("Alertas", fontWeight = FontWeight.SemiBold); alerts.take(10).forEach { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.WarningAmber, null, tint = if (it.text("severity") == "critical") IspRed else IspAmber); Spacer(Modifier.width(8.dp)); Text(it.text("message"), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall) } } }
        Notice("Las acciones remotas estan bloqueadas en Android hasta verificar ejecucion y lectura posterior contra la OLT.")
    } }, confirmButton = { TextButton(onClick = close) { Text("Cerrar") } })
}

@Composable private fun OltValue(label: String, value: String, modifier: Modifier) { Column(modifier) { Text(label, style = MaterialTheme.typography.labelSmall); Text(value, fontWeight = FontWeight.Bold) } }

@Composable
private fun OpticalLine(values: List<Double>) {
    val clean = values.filter { it.isFinite() }; androidx.compose.foundation.Canvas(Modifier.fillMaxWidth().height(64.dp)) { if (clean.size > 1) { val min = clean.minOrNull()!!; val max = clean.maxOrNull()!!; val span = (max - min).coerceAtLeast(1.0); val path = androidx.compose.ui.graphics.Path(); clean.forEachIndexed { index, value -> val x = size.width * index / (clean.size - 1); val y = size.height - ((value - min) / span * size.height).toFloat(); if (index == 0) path.moveTo(x, y) else path.lineTo(x, y) }; drawPath(path, IspBlue, style = androidx.compose.ui.graphics.drawscope.Stroke(3.dp.toPx())) } }
}

@Composable
private fun OltPending(vm: MainViewModel, pages: Map<String, PageState>) {
    val path = "/olt/unconfigured?page=1&pageSize=100"; LaunchedEffect(Unit) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects()
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { item { ReadStatus(state) { vm.load(path, true) } }; if (rows.isEmpty() && !state.loading) item { EmptyState("No hay ONU pendientes de autorizacion") }; items(rows, key = { it.text("serial") }) { row -> OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("serial"), fontWeight = FontWeight.Bold) }, supportingContent = { Text("PON ${row.text("ponIndex")} · vista ${row.text("lastSeenAt")}\n${row.text("authorizationReason", "Pendiente de revision")}") }, leadingContent = { Icon(Icons.Outlined.PendingActions, null, tint = IspAmber) }, trailingContent = { StatusBadge(row.text("authorizationStatus")) }) } }; item { Notice("La autorizacion desde Android se habilitara solo con perfil, serial y lectura posterior verificados.") } }
}

@Composable
private fun OltAlarms(vm: MainViewModel, pages: Map<String, PageState>) {
    val path = "/olt/alarms?active=true&page=1&pageSize=100"; LaunchedEffect(Unit) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects()
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { item { ReadStatus(state) { vm.load(path, true) } }; if (rows.isEmpty() && !state.loading) item { EmptyState("No hay alarmas activas") }; items(rows, key = { it.text("alarmId") }) { row -> OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("description"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("code")} · ${row.text("lastSeenAt")}") }, leadingContent = { Icon(Icons.Outlined.WarningAmber, null, tint = if (row.text("level").lowercase() in listOf("critical", "danger")) IspRed else IspAmber) }, trailingContent = { StatusBadge(row.text("level")) }) } } }
}
