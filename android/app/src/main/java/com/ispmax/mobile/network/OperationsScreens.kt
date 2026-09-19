package com.ispmax.mobile

import android.content.Intent
import android.net.Uri
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import java.net.URLEncoder

@Composable
fun ClientMapScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var query by rememberSaveable { mutableStateOf("") }; var page by rememberSaveable { mutableIntStateOf(1) }
    val path = "/map/clients?q=${URLEncoder.encode(query, "UTF-8")}&page=$page&pageSize=50"
    LaunchedEffect(path) { vm.load(path) }; val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects(); val context = LocalContext.current
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Mapa de clientes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Ubicaciones tecnicas y WispHub verificables", style = MaterialTheme.typography.bodySmall) }; IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar") } }
        OutlinedTextField(query, { query = it; page = 1 }, label = { Text("Cliente, zona, IP o direccion") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            if (rows.isEmpty() && !state.loading) item { EmptyState("No hay clientes con coordenadas validas") }
            items(rows, key = { it.optInt("idServicio") }) { row -> OutlinedCard(onClick = { val geo = Uri.parse("geo:${row.optDouble("lat")},${row.optDouble("lng")}?q=${row.optDouble("lat")},${row.optDouble("lng")}(${Uri.encode(row.text("name"))})"); runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, geo)) } }, modifier = Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("name"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("zone")} · ${row.text("address")}\n${row.text("ip")} · ${row.optDouble("lat")}, ${row.optDouble("lng")}") }, leadingContent = { Icon(Icons.Outlined.LocationOn, null, tint = if (row.text("source") == "technician") IspGreen else IspBlue) }, trailingContent = { Column(horizontalAlignment = Alignment.End) { StatusBadge(row.text("status")); Text(if (row.text("source") == "technician") "Tecnico" else "WispHub", style = MaterialTheme.typography.labelSmall) } }) } }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }; Text("${state.body?.optInt("total") ?: 0} ubicados", style = MaterialTheme.typography.bodySmall); IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") } }
    }
}

@Composable
fun SystemStatusScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    val path = "/system/status"; LaunchedEffect(Unit) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val body = state.body; val company = body?.optJSONObject("company"); val integrations = body?.optJSONObject("integrations")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Estado del sistema", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Configuracion publica y ultimas sincronizaciones", style = MaterialTheme.typography.bodySmall) }; IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar") } }
        ReadStatus(state) { vm.load(path, true) }
        company?.let { OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) { Row { Icon(Icons.Outlined.Business, null, tint = IspGreen); Spacer(Modifier.width(8.dp)); Text(it.text("companyName", "ISP Max"), fontWeight = FontWeight.Bold) }; Text(it.text("companySlogan", "")); Text(it.text("companyPhone")); Text(it.text("companyAddress")); Text("RNC ${it.text("rnc")}", style = MaterialTheme.typography.bodySmall) } } }
        integrations?.let {
            SystemRow("WispHub clientes", it.optJSONObject("wisphub")?.text("lastClientSyncAt") ?: "Sin sincronizacion", Icons.Outlined.CloudSync, IspBlue)
            SystemRow("WispHub facturas", it.optJSONObject("wisphub")?.text("lastInvoiceSyncAt") ?: "Sin sincronizacion", Icons.Outlined.ReceiptLong, IspBlue)
            val mt = it.optJSONObject("mikrotik"); SystemRow("MikroTik", mt?.let { row -> "${row.text("healthState")} · ${row.text("capturedAt")}" } ?: "Sin muestra", Icons.Outlined.Router, if (mt?.optBoolean("mikrotikConnected") == true) IspGreen else IspAmber)
            val olt = it.optJSONObject("olt"); SystemRow("OLT", olt?.let { row -> "${row.text("status")} · ${row.text("capturedAt")}" } ?: "Sin muestra", Icons.Outlined.Hub, if (olt?.text("status") == "online") IspGreen else IspAmber)
            SystemRow("IPAM", it.optJSONObject("ipam")?.text("lastChangedAt") ?: "Sin inventario", Icons.Outlined.Lan, IspBlue)
            SystemRow("Sesiones moviles", it.optInt("mobileSessions").toString(), Icons.Outlined.PhonelinkLock, IspGreen)
        }
        Notice("No se muestran tokens, claves WiFi, credenciales WispHub, MikroTik, OLT ni ACS.")
    }
}

@Composable private fun SystemRow(title: String, subtitle: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: androidx.compose.ui.graphics.Color) { OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(title, fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(subtitle) }, leadingContent = { Icon(icon, null, tint = color) }) } }
