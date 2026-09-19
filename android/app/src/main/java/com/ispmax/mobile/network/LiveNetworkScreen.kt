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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

@Composable
fun LiveNetworkScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var committed by rememberSaveable { mutableStateOf("") }
    var stateFilter by rememberSaveable { mutableStateOf("all") }
    var sort by rememberSaveable { mutableStateOf("traffic") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    LaunchedEffect(search) { delay(300); committed = search; page = 1 }
    val path = "/network/live?q=${URLEncoder.encode(committed, "UTF-8")}&state=$stateFilter&sort=$sort&page=$page&pageSize=30"
    val state = pages[path] ?: PageState(loading = true)
    val latestLiveError by rememberUpdatedState(state.error)
    LaunchedEffect(path) {
        while (true) {
            vm.load(path, true)
            delay(if (latestLiveError == null) 5_000 else 15_000)
        }
    }
    val body = state.body
    val summary = body?.optJSONObject("summary")
    val rows = body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Clientes en vivo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(body?.text("sampledAt", "Esperando lectura") ?: "Esperando lectura", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar") }
        }
        ReadStatus(state) { vm.load(path, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiveMetric("En linea", summary?.optInt("onlineClients")?.toString() ?: "--", IspGreen, Modifier.weight(1f))
            LiveMetric("Sin presencia", summary?.optInt("offlineClients")?.toString() ?: "--", IspRed, Modifier.weight(1f))
            LiveMetric("Consumo", compactBps((summary?.optDouble("totalUploadBps") ?: 0.0) + (summary?.optDouble("totalDownloadBps") ?: 0.0)), IspBlue, Modifier.weight(1f))
        }
        OutlinedTextField(search, { search = it }, modifier = Modifier.fillMaxWidth(), singleLine = true, label = { Text("Nombre, usuario o IP") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar") } })
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "Todos", "online" to "En linea", "offline" to "Sin presencia", "transmitting" to "Transmitiendo", "differences" to "Diferencias").forEach { (key, label) ->
                FilterChip(selected = stateFilter == key, onClick = { stateFilter = key; page = 1 }, label = { Text(label) })
            }
            AssistChip(onClick = { sort = if (sort == "traffic") "name" else "traffic"; page = 1 }, label = { Text(if (sort == "traffic") "Mayor consumo" else "Nombre") }, leadingIcon = { Icon(Icons.Outlined.Sort, null, Modifier.size(18.dp)) })
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay clientes para estos filtros") }
            items(rows, key = { "${it.optInt("idServicio")}-${it.text("ip", it.text("queueName"))}" }) { row -> LiveClientCard(row) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }
            Text("${body?.optInt("total") ?: 0} clientes · pagina $page", style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { page++ }, enabled = body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") }
        }
    }
}

@Composable private fun LiveMetric(label: String, value: String, color: Color, modifier: Modifier) {
    OutlinedCard(modifier) { Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) { Text(value, color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium, maxLines = 1); Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1) } }
}

@Composable private fun LiveClientCard(row: JSONObject) {
    val activeColor = if (row.optBoolean("online")) IspGreen else IspRed
    val maxDown = row.optDouble("maxDownloadBps").coerceAtLeast(1.0)
    val usage = (row.optDouble("downloadBps") / maxDown).toFloat().coerceIn(0f, 1f)
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(if (row.optBoolean("online")) Icons.Outlined.Wifi else Icons.Outlined.WifiOff, null, tint = activeColor, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) { Text(row.text("name"), fontWeight = FontWeight.SemiBold, maxLines = 1); Text("${row.text("ip")} · ${row.text("plan")}", style = MaterialTheme.typography.bodySmall, maxLines = 1) }
                StatusBadge(if (row.optBoolean("transmitting")) "Transmitiendo" else if (row.optBoolean("online")) "En linea" else "Sin presencia")
            }
            LinearProgressIndicator(progress = { usage }, modifier = Modifier.fillMaxWidth(), color = if (usage > .85f) IspRed else IspGreen)
            Row {
                Text("RX ${compactBps(row.optDouble("downloadBps"))}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                Text("TX ${compactBps(row.optDouble("uploadBps"))}", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
            }
            if (row.text("syncState", "synced") != "synced") Text("Diferencia: ${row.text("syncState")}", color = IspAmber, style = MaterialTheme.typography.labelSmall)
        }
    }
}

internal fun compactBps(value: Double): String = when {
    value >= 1e9 -> "%.1f Gbps".format(value / 1e9)
    value >= 1e6 -> "%.1f Mbps".format(value / 1e6)
    value >= 1e3 -> "%.0f Kbps".format(value / 1e3)
    else -> "0 bps"
}

@Composable
fun MikrotikOverviewScreen(vm: MainViewModel, pages: Map<String, PageState>, capabilities: JSONObject?) {
    val path = "/mikrotik/summary"
    val state = pages[path] ?: PageState(loading = true)
    val latestMikrotikError by rememberUpdatedState(state.error)
    LaunchedEffect(Unit) {
        while (true) { vm.load(path, true); delay(if (latestMikrotikError == null) 10_000 else 30_000) }
    }
    val body = state.body
    val system = body?.optJSONObject("system")
    val interfaces = body?.optJSONArray("interfaces").objects()
    val canPing = capabilities?.optBoolean("mikrotikDiagnostics") == true
    val scope = rememberCoroutineScope()
    var pingAddress by rememberSaveable { mutableStateOf("8.8.8.8") }
    var pingBusy by remember { mutableStateOf(false) }
    var pingResult by remember { mutableStateOf<JSONObject?>(null) }
    var pingError by remember { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text(system?.text("identity", "MikroTik") ?: "MikroTik", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(system?.text("boardName", body?.text("error", "Sin lectura") ?: "Sin lectura") ?: "Sin lectura", style = MaterialTheme.typography.bodySmall) }
                StatusBadge(if (body?.optBoolean("connected") == true) "Conectado" else "Sin conexion")
                IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar") }
            }
        }
        item { ReadStatus(state) { vm.load(path, true) } }
        body?.text("error", "")?.takeIf { it.isNotBlank() }?.let { error -> item { Notice(error, true) } }
        system?.let { data ->
            item {
                OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Recursos", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Row { NetworkDatum("CPU", "${data.optInt("cpuLoadPercent")}%", Modifier.weight(1f)); NetworkDatum("Memoria libre", memory(data.optDouble("freeMemoryBytes")), Modifier.weight(1f)) }
                    Row { NetworkDatum("Uptime", data.text("uptime"), Modifier.weight(1f)); NetworkDatum("RouterOS", data.text("version"), Modifier.weight(1f)) }
                } }
            }
        }
        if (canPing) item {
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Diagnostico ping", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    OutlinedTextField(pingAddress, { pingAddress = it.take(45) }, label = { Text("Direccion IP") }, singleLine = true, modifier = Modifier.fillMaxWidth(), leadingIcon = { Icon(Icons.Outlined.NetworkPing, null) })
                    Button(onClick = {
                        pingBusy = true; pingError = null; pingResult = null
                        scope.launch {
                            try { pingResult = vm.mikrotikPing(pingAddress) }
                            catch (error: Exception) { pingError = error.message ?: "No se pudo completar el ping" }
                            finally { pingBusy = false }
                        }
                    }, enabled = !pingBusy && pingAddress.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        if (pingBusy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.NetworkPing, null)
                        Spacer(Modifier.width(8.dp)); Text(if (pingBusy) "Consultando MikroTik" else "Ejecutar ping")
                    }
                    pingResult?.let { result ->
                        Text("${result.optInt("received")}/${result.optInt("sent")} respuestas · perdida ${result.optDouble("lossPercent")}% · promedio ${result.optDouble("avgMs")} ms", color = IspGreen, style = MaterialTheme.typography.bodySmall)
                    }
                    pingError?.let { Text(it, color = IspRed, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
        item { Text("Interfaces", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
        if (interfaces.isEmpty() && !state.loading) item { EmptyState("No hay interfaces disponibles") }
        items(interfaces, key = { it.text("name") }) { iface ->
            OutlinedCard(Modifier.fillMaxWidth()) { ListItem(
                headlineContent = { Text(iface.text("name"), fontWeight = FontWeight.SemiBold) },
                supportingContent = { Text("${iface.text("type")} · MTU ${iface.text("mtu")}\nRX ${memory(iface.optDouble("rxBytes"))} · TX ${memory(iface.optDouble("txBytes"))}") },
                leadingContent = { Icon(Icons.Outlined.SettingsEthernet, null, tint = if (iface.optBoolean("running")) IspGreen else IspAmber) },
                trailingContent = { StatusBadge(if (iface.optBoolean("disabled")) "Deshabilitada" else if (iface.optBoolean("running")) "Activa" else "Sin enlace") },
            ) }
        }
    }
}

@Composable private fun NetworkDatum(label: String, value: String, modifier: Modifier) { Column(modifier) { Text(label, style = MaterialTheme.typography.labelSmall); Text(value, fontWeight = FontWeight.SemiBold) } }
private fun memory(value: Double): String = when { value >= 1e9 -> "%.1f GB".format(value / 1e9); value >= 1e6 -> "%.1f MB".format(value / 1e6); else -> "%.0f KB".format(value / 1e3) }
