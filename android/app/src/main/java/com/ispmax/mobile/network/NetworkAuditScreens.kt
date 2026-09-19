package com.ispmax.mobile

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import java.net.URLEncoder

@Composable
fun NetworkAuditScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var query by rememberSaveable { mutableStateOf("") }
    var days by rememberSaveable { mutableIntStateOf(30) }
    var stateFilter by rememberSaveable { mutableStateOf("all") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val path = "/network/audit/clients?q=${URLEncoder.encode(query, "UTF-8")}&days=$days&state=$stateFilter&page=$page&pageSize=40"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    val summary = body?.optJSONObject("summary")
    val rows = body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Estabilidad de clientes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Muestras persistidas cada 10 minutos", style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AuditKpi("Monitoreados", summary?.optInt("monitoredClients")?.toString() ?: "--", IspBlue, Modifier.weight(1f))
            AuditKpi("Atencion", summary?.optInt("attentionClients")?.toString() ?: "--", IspAmber, Modifier.weight(1f))
            AuditKpi("Estabilidad", summary?.let { "${it.optDouble("stabilityPercent")}%" } ?: "--", IspGreen, Modifier.weight(1f))
        }
        OutlinedTextField(query, { query = it; page = 1 }, label = { Text("Cliente, usuario, IP o zona") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf(7, 30, 90).forEach { value -> FilterChip(selected = days == value, onClick = { days = value; page = 1 }, label = { Text("${value}d") }) }
            FilterChip(selected = stateFilter == "offline", onClick = { stateFilter = if (stateFilter == "offline") "all" else "offline"; page = 1 }, label = { Text("Sin linea") })
            FilterChip(selected = stateFilter == "degraded", onClick = { stateFilter = if (stateFilter == "degraded") "all" else "degraded"; page = 1 }, label = { Text("Degradados") })
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("Aun no hay muestras para estos filtros") }
            items(rows, key = { it.optInt("idServicio") }) { row ->
                val condition = row.text("latestState", "unknown")
                OutlinedCard(onClick = { selected = row.optInt("idServicio") }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.text("name"), fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text("${row.text("ip")} · ${row.text("plan")}\nDisponible ${row.optDouble("availabilityPercent")}% · RX ${row.text("latestRxPowerDbm")} dBm") },
                        leadingContent = { Icon(if (condition == "stable") Icons.Outlined.Wifi else Icons.Outlined.SignalWifiStatusbarConnectedNoInternet4, null, tint = healthColor(condition)) },
                        trailingContent = { Column(horizontalAlignment = Alignment.End) { StatusBadge(condition); Text("${row.optDouble("latestDownloadMbps")} Mbps", style = MaterialTheme.typography.labelSmall) } },
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }
            Text("Pagina $page · ${body?.optInt("total") ?: 0} clientes", style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { page++ }, enabled = body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") }
        }
    }
    if (selected > 0) ClientAuditDialog(selected, vm, pages) { selected = 0 }
}

@Composable
private fun AuditKpi(label: String, value: String, color: Color, modifier: Modifier) {
    OutlinedCard(modifier) { Column(Modifier.padding(12.dp)) { Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium); Text(label, style = MaterialTheme.typography.labelSmall) } }
}

@Composable
private fun ClientAuditDialog(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = "/network/audit/clients/$id?days=7"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val client = state.body?.optJSONObject("client")
    val samples = state.body?.optJSONArray("samples").objects()
    AlertDialog(onDismissRequest = close, title = { Text(client?.let { it.text("aliasNombre", it.text("nombre")) } ?: "Auditoria del cliente") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            ReadStatus(state) { vm.load(path, true) }
            client?.let { Text("${it.text("ip")} · ${it.text("planInternetName")} · ${it.text("zonaNombre")}") }
            if (samples.isNotEmpty()) {
                val latest = samples.first(); Row { ValueBlock("Descarga", "${"%.2f".format(latest.optDouble("downloadBps") / 1e6)} Mbps", Modifier.weight(1f)); ValueBlock("Subida", "${"%.2f".format(latest.optDouble("uploadBps") / 1e6)} Mbps", Modifier.weight(1f)) }
                Row { ValueBlock("Fibra RX", "${latest.text("rxPowerDbm")} dBm", Modifier.weight(1f)); ValueBlock("Estado", latest.text("healthState"), Modifier.weight(1f)) }
                MiniLine(samples.reversed().map { it.optDouble("downloadBps") / 1e6 }, IspBlue)
                Text("Ultimas muestras", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                samples.take(30).forEach { row -> Text("${row.text("capturedAt")} · ${"%.2f".format(row.optDouble("downloadBps") / 1e6)} / ${"%.2f".format(row.optDouble("uploadBps") / 1e6)} Mbps · ${row.text("healthState")}", style = MaterialTheme.typography.bodySmall) }
            } else if (!state.loading) EmptyState("No hay muestras detalladas en los ultimos 7 dias")
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cerrar") } })
}

@Composable private fun ValueBlock(label: String, value: String, modifier: Modifier) { Column(modifier) { Text(label, style = MaterialTheme.typography.labelSmall); Text(value, fontWeight = FontWeight.Bold) } }

@Composable
fun WanHistoryScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var hours by rememberSaveable { mutableIntStateOf(24) }
    val path = "/network/wan?hours=$hours"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body; val summary = body?.optJSONObject("summary"); val rows = body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Historico WAN", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Consumo y calidad del enlace", style = MaterialTheme.typography.bodySmall) }; IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar") } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf(6 to "6 h", 24 to "24 h", 168 to "7 d", 720 to "30 d").forEach { (value, label) -> FilterChip(selected = hours == value, onClick = { hours = value }, label = { Text(label) }) } }
        ReadStatus(state) { vm.load(path, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AuditKpi("Pico descarga", summary?.let { formatBps(it.optDouble("peakRxBps")) } ?: "--", IspBlue, Modifier.weight(1f)); AuditKpi("Pico subida", summary?.let { formatBps(it.optDouble("peakTxBps")) } ?: "--", IspGreen, Modifier.weight(1f)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AuditKpi("Prom. descarga", summary?.let { formatBps(it.optDouble("avgRxBps")) } ?: "--", IspBlue, Modifier.weight(1f)); AuditKpi("Prom. subida", summary?.let { formatBps(it.optDouble("avgTxBps")) } ?: "--", IspGreen, Modifier.weight(1f)) }
        OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("Trafico", fontWeight = FontWeight.SemiBold); MiniLine(rows.map { it.optDouble("rxBps") }, IspBlue); MiniLine(rows.map { it.optDouble("txBps") }, IspGreen) } }
        Text("Ultimas muestras", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        rows.asReversed().take(30).forEach { row -> OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text("${formatBps(row.optDouble("rxBps"))} / ${formatBps(row.optDouble("txBps"))}") }, supportingContent = { Text("${row.text("capturedAt")} · ${row.text("ifaceName")} · ${row.optDouble("pingAvgMs")} ms · perdida ${row.optDouble("pingLossPercent")}%") }, trailingContent = { StatusBadge(row.text("healthState")) }) } }
        if (rows.isEmpty() && !state.loading) EmptyState("Todavia no hay muestras WAN en este periodo")
    }
}

@Composable
fun IpamScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    val networksPath = "/ipam/networks"
    var selectedCidr by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var onlyFree by rememberSaveable { mutableStateOf(false) }
    var onlyConflict by rememberSaveable { mutableStateOf(false) }
    var page by rememberSaveable { mutableIntStateOf(1) }
    val addressesPath = "/ipam/addresses?q=${URLEncoder.encode(query, "UTF-8")}&cidr=${URLEncoder.encode(selectedCidr, "UTF-8")}&available=$onlyFree&conflict=$onlyConflict&page=$page&pageSize=50"
    LaunchedEffect(Unit) { vm.load(networksPath, true) }
    LaunchedEffect(addressesPath) { vm.load(addressesPath) }
    val networkState = pages[networksPath] ?: PageState(loading = true); val addressState = pages[addressesPath] ?: PageState(loading = true)
    val networks = networkState.body?.optJSONArray("items").objects(); val rows = addressState.body?.optJSONArray("items").objects(); val totals = networkState.body?.optJSONObject("summary")
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Direcciones IP", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Inventario SQLite; validar en vivo antes de asignar", style = MaterialTheme.typography.bodySmall) }; IconButton(onClick = { vm.load(networksPath, true); vm.load(addressesPath, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar") } }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { AuditKpi("Libres", totals?.optInt("available")?.toString() ?: "--", IspGreen, Modifier.weight(1f)); AuditKpi("Usadas", totals?.optInt("used")?.toString() ?: "--", IspBlue, Modifier.weight(1f)); AuditKpi("Uso", totals?.let { "${it.optDouble("utilization")}%" } ?: "--", IspAmber, Modifier.weight(1f)) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) { FilterChip(selected = selectedCidr.isBlank(), onClick = { selectedCidr = ""; page = 1 }, label = { Text("Todos") }); networks.take(4).forEach { network -> FilterChip(selected = selectedCidr == network.text("cidr"), onClick = { selectedCidr = network.text("cidr"); page = 1 }, label = { Text(network.text("cidr")) }) } }
        OutlinedTextField(query, { query = it; page = 1 }, label = { Text("IP, cliente, MAC o cola") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { FilterChip(selected = onlyFree, onClick = { onlyFree = !onlyFree; page = 1 }, label = { Text("Solo libres") }, leadingIcon = { Icon(Icons.Outlined.CheckCircle, null) }); FilterChip(selected = onlyConflict, onClick = { onlyConflict = !onlyConflict; page = 1 }, label = { Text("Conflictos") }, leadingIcon = { Icon(Icons.Outlined.WarningAmber, null) }) }
        ReadStatus(addressState) { vm.load(addressesPath, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (rows.isEmpty() && !addressState.loading && addressState.error == null) item { EmptyState("No hay direcciones para estos filtros") }
            items(rows, key = { it.text("ip") }) { row ->
                OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("ip"), fontWeight = FontWeight.Bold) }, supportingContent = { Text("${row.text("clientName", row.text("queueName", row.text("hostName")))}\n${row.text("macAddress")} · ${row.optJSONArray("sources")?.let { list -> (0 until list.length()).joinToString(", ") { list.optString(it) } } ?: "sin fuente"}") }, leadingContent = { Icon(if (row.optBoolean("available")) Icons.Outlined.CheckCircle else Icons.Outlined.Devices, null, tint = if (row.optBoolean("conflict")) IspRed else if (row.optBoolean("available")) IspGreen else IspBlue) }, trailingContent = { StatusBadge(if (row.optBoolean("conflict")) "Conflicto" else if (row.optBoolean("available")) "Libre" else row.text("classification")) }) }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }; Text("${addressState.body?.optInt("total") ?: 0} direcciones", style = MaterialTheme.typography.bodySmall); IconButton(onClick = { page++ }, enabled = addressState.body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") } }
    }
}

@Composable
private fun MiniLine(values: List<Double>, color: Color) {
    val finite = values.filter { it.isFinite() }
    Canvas(Modifier.fillMaxWidth().height(76.dp)) {
        if (finite.size < 2) return@Canvas
        val min = finite.minOrNull() ?: 0.0; val max = finite.maxOrNull() ?: 1.0; val span = (max - min).coerceAtLeast(1.0)
        val path = Path()
        finite.forEachIndexed { index, value ->
            val x = size.width * index / (finite.size - 1).coerceAtLeast(1)
            val y = size.height - ((value - min) / span * size.height).toFloat()
            if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
        }
        drawPath(path, color, style = androidx.compose.ui.graphics.drawscope.Stroke(width = 3.dp.toPx(), cap = StrokeCap.Round))
    }
}

private fun healthColor(value: String) = when (value) { "stable" -> IspGreen; "degraded" -> IspAmber; "offline" -> IspRed; else -> IspBlue }
private fun formatBps(value: Double) = when { value >= 1e9 -> "%.2f Gbps".format(value / 1e9); value >= 1e6 -> "%.2f Mbps".format(value / 1e6); else -> "%.0f Kbps".format(value / 1e3) }
