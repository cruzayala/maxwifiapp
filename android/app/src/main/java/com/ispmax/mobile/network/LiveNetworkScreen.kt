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
import org.json.JSONObject
import java.net.URLEncoder

@Composable
fun LiveNetworkScreen(vm: MainViewModel, pages: Map<String, PageState>, onClient: (Int) -> Unit = {}) {
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
            items(rows, key = { "${it.optInt("idServicio")}-${it.text("ip", it.text("queueName"))}" }) { row -> LiveClientCard(row) { row.optInt("idServicio").takeIf { it > 0 }?.let(onClient) } }
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

@Composable private fun LiveClientCard(row: JSONObject, open: () -> Unit = {}) {
    val activeColor = if (row.optBoolean("online")) IspGreen else IspRed
    val maxDown = row.optDouble("maxDownloadBps").coerceAtLeast(1.0)
    val usage = (row.optDouble("downloadBps") / maxDown).toFloat().coerceIn(0f, 1f)
    OutlinedCard(onClick = open, modifier = Modifier.fillMaxWidth()) {
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
