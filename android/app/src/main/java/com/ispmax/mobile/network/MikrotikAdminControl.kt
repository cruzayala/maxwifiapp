package com.ispmax.mobile

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneOffset

private val GREY = Color(0xFF52646B)

// --- Infraestructura ---
private val INFRA_SECTIONS = listOf("interfaces" to "Interfaces", "sessions" to "Sesiones", "addresses" to "Direcciones IP", "arp" to "ARP", "dhcp" to "DHCP")

@Composable
internal fun MtInfrastructureTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState) {
    val section = ui.infraSection
    var monitor by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("") }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Contadores de interfaces y sesiones se actualizan solos mientras esta pestaña esta visible.
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while (true) { delay(15_000); vm.load(MT_TRAFFIC, true); vm.load(MT_SESSIONS, true) } }
    }
    LaunchedEffect(section) {
        when (section) { "addresses" -> vm.load(MT_ADDRESSES); "arp" -> vm.load(MT_ARP); "dhcp" -> vm.load(MT_DHCP) }
    }
    val traffic = pages[MT_TRAFFIC]?.body?.optJSONArray("items").objects()
    val sessions = pages[MT_SESSIONS]?.body
    val pppoe = sessions?.optJSONArray("pppoe").objects()
    val hotspot = sessions?.optJSONArray("hotspot").objects()
    val sectionPath = when (section) { "addresses" -> MT_ADDRESSES; "arp" -> MT_ARP; "dhcp" -> MT_DHCP; "sessions" -> MT_SESSIONS; else -> MT_TRAFFIC }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Infraestructura de red", "${traffic.count { it.mtBool("running") }} interfaces operativas") {
                TextButton(onClick = { vm.load(sectionPath, true); if (sectionPath != MT_TRAFFIC) vm.load(MT_TRAFFIC, true) }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(4.dp)); Text("Actualizar") }
            }
        }
        item { MtChipRail { INFRA_SECTIONS.forEach { (key, label) -> MtFilterChip(label, null, section == key) { ui.infraSection = key; filter = "" } } } }
        mtReadStatus(pages[sectionPath]) { vm.load(sectionPath, true) }
        when (section) {
            "interfaces" -> {
                item { Text("Contadores desde el último reinicio. Toque una interfaz para ver su tráfico en vivo.", style = MaterialTheme.typography.bodySmall, color = GREY) }
                if (traffic.isEmpty()) item { EmptyState("Sin datos de interfaces. Pulse «Actualizar».") }
                items(traffic) { iface ->
                    val running = iface.mtBool("running")
                    OutlinedCard(onClick = { monitor = iface.mtStr("name") }, modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.Cable, null, tint = if (running) IspGreen else IspRed)
                                Spacer(Modifier.width(8.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(iface.mtStr("name") ?: "-", fontWeight = FontWeight.SemiBold)
                                    Text("${iface.mtStr("type") ?: "-"} · ${iface.mtStr("macAddress") ?: "-"}", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = GREY)
                                }
                                MtBadge(if (running) "Activa" else "Caída", if (running) IspGreen else IspRed)
                            }
                            Row { MtDatum("RX", mtFormatBytes(iface.mtNum("rxBytes")), Modifier.weight(1f)); MtDatum("TX", mtFormatBytes(iface.mtNum("txBytes")), Modifier.weight(1f)) }
                        }
                    }
                }
            }
            "sessions" -> {
                item {
                    MtCard {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text("${pppoe.size + hotspot.size}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = IspGreen); Spacer(Modifier.width(8.dp)); Text("sesiones activas") }
                        Text("PPPoE y Hotspot", style = MaterialTheme.typography.bodySmall, color = GREY)
                    }
                }
                if (pppoe.isEmpty() && hotspot.isEmpty()) item { EmptyState("Sin sesiones PPPoE o Hotspot") }
                items(pppoe) { session -> MtSimpleRow(Icons.Outlined.Wifi, session.mtStr("name") ?: "-", "${session.mtStr("address") ?: "-"} · ${session.mtStr("uptime") ?: "-"}") }
                items(hotspot) { session -> MtSimpleRow(Icons.Outlined.CellTower, session.mtStr("user") ?: "-", "${session.mtStr("address") ?: "-"} · ${session.mtStr("uptime") ?: "-"}") }
            }
            else -> {
                val rows = pages[sectionPath]?.body?.optJSONArray("items").objects()
                val needle = filter.trim().lowercase()
                val visible = if (needle.isEmpty()) rows else rows.filter { row -> listOf("address", "mac-address", "host-name", "interface", "comment", "network").any { row.mtStr(it).orEmpty().lowercase().contains(needle) } }
                item { MtSearchField(filter, "IP, MAC, equipo o interfaz") { filter = it } }
                item { Text("${visible.size} de ${rows.size} registros", style = MaterialTheme.typography.labelSmall, color = GREY) }
                if (visible.isEmpty() && pages[sectionPath]?.loading != true) item { EmptyState("Sin registros") }
                items(visible.take(300)) { row ->
                    val flags = listOfNotNull(
                        if (row.mtStr("disabled") == "true") "Deshabilitada" else null,
                        if (row.mtStr("dynamic") == "true") "Dinámica" else null,
                        if (row.mtStr("invalid") == "true") "Inválida" else null,
                    )
                    when (section) {
                        "addresses" -> MtSimpleRow(Icons.Outlined.Lan, row.mtStr("address") ?: "-", "Red ${row.mtStr("network") ?: "-"} · ${row.mtStr("interface") ?: "-"}${row.mtStr("comment")?.let { " · $it" } ?: ""}", flags)
                        "arp" -> MtSimpleRow(Icons.Outlined.SettingsEthernet, row.mtStr("address") ?: "-", "${row.mtStr("mac-address") ?: "Sin MAC"} · ${row.mtStr("interface") ?: "-"}${row.mtStr("comment")?.let { " · $it" } ?: ""}", flags + listOfNotNull(if (row.mtStr("complete") == "true") "Completa" else null))
                        else -> MtSimpleRow(Icons.Outlined.Dns, row.mtStr("address") ?: "-",
                            "${row.mtStr("mac-address") ?: "-"} · ${row.mtStr("host-name") ?: "Sin nombre"}\n${row.mtStr("server") ?: "-"} · ${row.mtStr("status") ?: "-"}${row.mtStr("expires-after")?.let { " · vence en $it" } ?: ""}",
                            flags.map { if (it == "Dinámica") "Dinámica" else it } + listOfNotNull(if (row.mtStr("dynamic") != "true") "Fija" else null))
                    }
                }
                if (visible.size > 300) item { Text("Se muestran 300 de ${visible.size}. Escriba para afinar.", style = MaterialTheme.typography.labelSmall) }
            }
        }
    }
    monitor?.let { name -> MtInterfaceMonitorDialog(vm, pages, name) { monitor = null } }
}

@Composable
private fun MtSimpleRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, subtitle: String, flags: List<String> = emptyList()) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        ListItem(
            headlineContent = { Text(title, fontWeight = FontWeight.SemiBold, fontFamily = FontFamily.Monospace) },
            supportingContent = { Text(subtitle, style = MaterialTheme.typography.bodySmall) },
            leadingContent = { Icon(icon, null, tint = IspGreen) },
            trailingContent = { Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) { flags.forEach { MtBadge(it, if (it == "Inválida" || it == "Deshabilitada") IspRed else IspBlue) } } },
        )
    }
}

@Composable
private fun MtInterfaceMonitorDialog(vm: MainViewModel, pages: Map<String, PageState>, name: String, onClose: () -> Unit) {
    val path = "web:/mikrotik/monitor/${Uri.encode(name)}"
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    // Lectura en vivo cada 5 s solo mientras el dialogo esta abierto y la app visible.
    LaunchedEffect(path, lifecycle) { lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { while (true) { vm.load(path, true); delay(5_000) } } }
    val state = pages[path]
    val body = state?.body
    AlertDialog(onDismissRequest = onClose, title = { Text("Tráfico en vivo · $name") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (body == null && state?.error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
            state?.error?.let { Notice(it, true) }
            if (body != null) {
                Row { MtDatum("Descarga (RX)", mtFormatBps(body.mtNum("rx-bits-per-second")), Modifier.weight(1f), IspBlue); MtDatum("Subida (TX)", mtFormatBps(body.mtNum("tx-bits-per-second")), Modifier.weight(1f), IspGreen) }
                Row { MtDatum("Paquetes RX", "${mtInt(body.mtNum("rx-packets-per-second"))}/s", Modifier.weight(1f)); MtDatum("Paquetes TX", "${mtInt(body.mtNum("tx-packets-per-second"))}/s", Modifier.weight(1f)) }
                Text("Se actualiza cada 5 segundos mientras esta ventana está abierta.", style = MaterialTheme.typography.labelSmall, color = GREY)
            }
        }
    }, confirmButton = { TextButton(onClick = onClose, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cerrar") } })
}

// --- Firewall ---
private val FIREWALL_TABLES = listOf("filter" to "Filtros", "nat" to "NAT", "mangle" to "Mangle", "address-list" to "Listas de direcciones")

@Composable
internal fun MtFirewallTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, canManage: Boolean, now: Long) {
    val state = pages[MT_FIREWALL]
    val tables = state?.body?.optJSONObject("tables")
    val rules = tables?.optJSONArray(ui.firewallTable).objects()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Firewall RouterOS", "Reglas del router. Cada cambio crea un respaldo automático antes de aplicarse.${mtParseTime(state?.body.mtStr("timestamp"))?.let { " Leído ${mtRelative(it, now)}." } ?: ""}") {
                ExportButton(rules, "mikrotik-firewall-${ui.firewallTable}") { rules.map { mtFirewallCsv(it) } }
                IconButton(onClick = { vm.load(MT_FIREWALL, true) }, enabled = state?.loading != true, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Actualizar") }
            }
        }
        mtReadStatus(state) { vm.load(MT_FIREWALL, true) }
        item { MtChipRail { FIREWALL_TABLES.forEach { (key, label) -> MtFilterChip(label, tables?.optJSONArray(key)?.length() ?: 0, ui.firewallTable == key) { ui.firewallTable = key } } } }
        if (rules.isEmpty() && state?.loading != true) item { EmptyState("No hay reglas en esta tabla") }
        items(rules) { rule ->
            val disabled = rule.mtBool("disabled"); val dynamic = rule.mtBool("dynamic"); val invalid = rule.mtBool("invalid")
            val label = if (dynamic) "Dinámica" else if (invalid) "Inválida" else if (disabled) "Deshabilitada" else "Activa"
            OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = if (invalid) Color(0xFFFFFBF3) else MaterialTheme.colorScheme.surface)) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(rule.mtStr("comment") ?: rule.mtStr("list") ?: "Sin comentario", fontWeight = FontWeight.SemiBold)
                            Text(rule.mtStr("id") ?: "-", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = GREY)
                        }
                        MtBadge(label, if (!disabled && !invalid) IspGreen else IspRed)
                    }
                    Row {
                        MtDatum("Cadena / acción", "${rule.mtStr("chain") ?: rule.mtStr("list") ?: "-"} · ${rule.mtStr("action") ?: rule.mtStr("address") ?: "-"}", Modifier.weight(1f))
                        MtDatum("Tráfico", "${mtFormatBytes(rule.mtNum("bytes"))} · ${mtInt(rule.mtNum("packets"))} paquetes", Modifier.weight(1f))
                    }
                    Text("${rule.mtStr("srcAddress") ?: "*"} → ${rule.mtStr("dstAddress") ?: rule.mtStr("address") ?: "*"}", fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    Text(listOf(rule.mtStr("protocol") ?: "todos", rule.mtStr("dstPort").orEmpty(), rule.mtStr("inInterface") ?: rule.mtStr("outInterface").orEmpty()).filter { it.isNotEmpty() }.joinToString(" "), style = MaterialTheme.typography.labelSmall, color = GREY)
                    if (canManage && !dynamic) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = {
                                actions.confirm(if (disabled) "Habilitar regla" else "Deshabilitar regla",
                                    "¿${if (disabled) "Habilitar" else "Deshabilitar"} esta regla del firewall? Puede afectar el tráfico de los clientes. Antes se creará un respaldo automático.",
                                    if (disabled) "Habilitar" else "Deshabilitar") {
                                    actions.run("PATCH", "/mikrotik/firewall/${rule.optString("table", ui.firewallTable)}/${Uri.encode(rule.optString("id"))}",
                                        JSONObject().put("disabled", !disabled).put("confirmation", "APLICAR"), listOf("/mikrotik/firewall"),
                                        "Regla ${if (disabled) "habilitada" else "deshabilitada"}", "No se pudo cambiar la regla")
                                }
                            }, enabled = !ui.saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                                Icon(if (disabled) Icons.Outlined.CheckCircle else Icons.Outlined.Block, null); Spacer(Modifier.width(6.dp)); Text(if (disabled) "Habilitar" else "Deshabilitar")
                            }
                            OutlinedButton(onClick = {
                                actions.confirm("Eliminar regla", "¿Eliminar permanentemente esta regla del firewall? Puede afectar el tráfico de los clientes. Antes se creará un respaldo automático.", "Eliminar", danger = true) {
                                    actions.run("DELETE", "/mikrotik/firewall/${rule.optString("table", ui.firewallTable)}/${Uri.encode(rule.optString("id"))}",
                                        JSONObject().put("confirmation", "ELIMINAR"), listOf("/mikrotik/firewall"), "Regla eliminada", "No se pudo eliminar la regla")
                                }
                            }, enabled = !ui.saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = IspRed)) {
                                Icon(Icons.Outlined.Delete, null); Spacer(Modifier.width(6.dp)); Text("Eliminar")
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun mtFirewallCsv(rule: JSONObject) = mtCsvRow(
    "ID" to rule.mtStr("id"), "Comentario" to rule.mtStr("comment"), "Cadena" to (rule.mtStr("chain") ?: rule.mtStr("list")),
    "Acción" to (rule.mtStr("action") ?: rule.mtStr("address")), "Origen" to rule.mtStr("srcAddress"), "Destino" to (rule.mtStr("dstAddress") ?: rule.mtStr("address")),
    "Protocolo" to rule.mtStr("protocol"), "Puerto destino" to rule.mtStr("dstPort"), "Interfaz" to (rule.mtStr("inInterface") ?: rule.mtStr("outInterface")),
    "Bytes" to rule.optLong("bytes"), "Paquetes" to rule.optLong("packets"),
    "Estado" to (if (rule.mtBool("dynamic")) "Dinámica" else if (rule.mtBool("invalid")) "Inválida" else if (rule.mtBool("disabled")) "Deshabilitada" else "Activa"),
)

// --- IPs libres (IPAM) ---
private val IPAM_FILTERS = listOf("all" to "Todas", "available" to "Disponibles", "client" to "Con cliente", "occupied" to "Sin cliente", "conflict" to "Conflictos")

@Composable
internal fun MtIpamTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, canManage: Boolean, now: Long) {
    val state = pages[MT_IPAM]
    val ipam = state?.body
    val rows = remember(ipam) { ipam?.optJSONArray("rows").objects() }
    val stats = ipam?.optJSONObject("stats")
    val conflicts = (stats?.optInt("ipConflicts") ?: 0) + (stats?.optInt("macMoves") ?: 0)
    val query = ui.ipamQuery.trim().lowercase(); val filter = ui.ipamFilter; val network = ui.ipamNetwork
    val filtered = remember(rows, query, filter, network) {
        rows.filter { row ->
            val client = row.optJSONObject("client")
            val matchesQuery = query.isEmpty() || listOf(row.mtStr("ip"), row.mtStr("macAddress"), row.mtStr("hostName"), row.mtStr("queueName"), row.mtStr("poolName"), client.mtStr("name"), client.mtStr("username")).any { it.orEmpty().lowercase().contains(query) }
            val matchesNetwork = network == null || row.mtStr("cidr") == network
            val classification = row.mtStr("classification")
            val matchesFilter = when (filter) {
                "available" -> row.mtBool("available")
                "client" -> classification == "client"
                "occupied" -> !row.mtBool("available") && classification != "client" && classification != "router"
                "conflict" -> row.mtBool("conflict")
                else -> true
            }
            matchesQuery && matchesNetwork && matchesFilter
        }
    }
    val pageCount = mtPageCount(filtered.size)
    val page = minOf(ui.ipamPage, pageCount)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("IPs libres y ocupadas", "Rangos del router comparados con WispHub, colas, DHCP y ARP. Use «Copiar» para tomar una IP libre.${mtParseTime(ipam.mtStr("timestamp"))?.let { " Inventario ${mtRelative(it, now)}." } ?: ""}") {
                ExportButton(filtered, "mikrotik-ips") { filtered.map { mtIpamCsv(it) } }
                IconButton(onClick = { vm.load(MT_IPAM, true); ui.ipamPage = 1 }, enabled = state?.loading != true, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Actualizar inventario IP") }
            }
        }
        mtReadStatus(state) { vm.load(MT_IPAM, true) }
        if (ipam.mtBool("stale")) item { Notice("MikroTik no respondió. Se muestra el último inventario guardado.") }
        item { MtSearchField(ui.ipamQuery, "IP, MAC, cola, equipo o cliente") { ui.ipamQuery = it; ui.ipamPage = 1 } }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtMiniKpi("Libres para usar", stats?.optInt("available") ?: 0, IspGreen, Modifier.weight(1f))
                    MtMiniKpi("Clientes WispHub", stats?.optInt("matchedClients") ?: 0, MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
                    MtMiniKpi("Ocupadas sin cliente", stats?.optInt("occupiedWithoutClient") ?: 0, IspAmber, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtMiniKpi("IPs inventariadas", stats?.optInt("total") ?: 0, MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
                    MtMiniKpi("Conflictos IP / MAC", conflicts, IspRed, Modifier.weight(1f))
                }
            }
        }
        val networks = ipam?.optJSONArray("networks").objects()
        if (networks.isNotEmpty()) item {
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                networks.forEach { net ->
                    val cidr = net.mtStr("cidr").orEmpty()
                    val active = network == cidr
                    val utilization = net.mtNum("utilization")
                    val recommended = net.optJSONArray("recommended")?.let { array -> (0 until array.length()).map { array.optString(it) } }.orEmpty()
                    OutlinedCard(onClick = { ui.ipamNetwork = if (active) null else cidr; ui.ipamPage = 1 }, modifier = Modifier.width(220.dp),
                        colors = CardDefaults.outlinedCardColors(containerColor = if (active) Color(0xFFEEF6F1) else MaterialTheme.colorScheme.surface),
                        border = if (active) CardDefaults.outlinedCardBorder().copy(width = 2.dp) else CardDefaults.outlinedCardBorder()) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(cidr, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                            Text("${net.optInt("used")} / ${net.optInt("capacity")} · ${mtCompact(utilization)}%", style = MaterialTheme.typography.labelSmall)
                            LinearProgressIndicator(progress = { (minOf(utilization, 100.0) / 100).toFloat() }, modifier = Modifier.fillMaxWidth(), color = if (utilization >= 90) IspRed else IspGreen)
                            Text("${net.optInt("available")} disponibles", style = MaterialTheme.typography.labelSmall)
                            if (recommended.isNotEmpty()) Text("Sugeridas: ${recommended.joinToString(", ")}", style = MaterialTheme.typography.labelSmall, color = IspGreen, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
        }
        item { MtIpGrid(ipam, network, actions) { ip -> ui.setIpamFilterValue("all"); ui.ipamQuery = ip; ui.ipamPage = 1; actions.toast("Mostrando $ip en la tabla") } }
        item {
            MtChipRail {
                val counts = mapOf("all" to (stats?.optInt("total") ?: 0), "available" to (stats?.optInt("available") ?: 0), "client" to (stats?.optInt("matchedClients") ?: 0), "occupied" to (stats?.optInt("occupiedWithoutClient") ?: 0), "conflict" to conflicts)
                IPAM_FILTERS.forEach { (key, label) -> MtFilterChip(label, counts[key], filter == key) { ui.setIpamFilterValue(key) } }
                if (network != null) AssistChip(onClick = { ui.ipamNetwork = null; ui.ipamPage = 1 }, label = { Text("Quitar rango $network") }, leadingIcon = { Icon(Icons.Outlined.Close, null, Modifier.size(16.dp)) })
            }
        }
        val paged = mtPaged(filtered, page)
        if (paged.isEmpty() && state?.loading != true) item { EmptyState("No hay direcciones para este filtro") }
        items(paged) { row -> MtIpamRow(row, ui, actions, canManage) }
        item { MtPager(filtered.size, page, pageCount) { ui.ipamPage = (page + it).coerceIn(1, pageCount) } }
    }
}

private fun mtIpamCsv(row: JSONObject) = mtCsvRow(
    "IP" to row.mtStr("ip"), "Rango" to row.mtStr("cidr"), "MAC" to row.mtStr("macAddress"), "Equipo" to row.mtStr("hostName"),
    "Cliente" to row.optJSONObject("client").mtStr("name"), "Usuario" to row.optJSONObject("client").mtStr("username"), "Cola" to row.mtStr("queueName"),
    "Pool" to row.mtStr("poolName"), "Origen" to mtIpSourceLabel(row.optJSONArray("sources")), "Estado" to mtIpamClassificationLabel(row),
    "Sugerida" to (if (row.mtBool("recommended")) "Sí" else ""),
)

@Composable
private fun MtMiniKpi(label: String, value: Int, color: Color, modifier: Modifier) {
    OutlinedCard(modifier) { Column(Modifier.padding(10.dp)) { Text(label, style = MaterialTheme.typography.labelSmall, color = GREY, maxLines = 2); Text("$value", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color) } }
}

@Composable
private fun MtIpamRow(row: JSONObject, ui: MtUiState, actions: MtActions, canManage: Boolean) {
    val available = row.mtBool("available"); val conflict = row.mtBool("conflict")
    val client = row.optJSONObject("client")
    val ip = row.mtStr("ip").orEmpty()
    val stateColor = if (row.mtBool("disabled") || conflict) IspRed else if (available || row.mtStr("status") == "bound") IspGreen else GREY
    OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = if (conflict) Color(0xFFFFF5F4) else if (available) Color(0xFFF3FBF7) else MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (!available) MtIpChip(ip, actions) else Text(ip, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(8.dp))
                Text(row.mtStr("cidr") ?: "Fuera de rangos", style = MaterialTheme.typography.labelSmall, color = GREY, modifier = Modifier.weight(1f))
                MtBadge(mtIpamClassificationLabel(row), stateColor)
            }
            Row {
                MtDatum("MAC / host", "${row.mtStr("macAddress") ?: if (available) "Sin uso detectado" else "-"}\n${row.mtStr("hostName") ?: row.mtStr("interface") ?: row.mtStr("poolName") ?: "-"}", Modifier.weight(1f))
                MtDatum("Asignación", "${client.mtStr("name") ?: row.mtStr("queueName") ?: if (available) "Lista para nuevo equipo" else "Sin cliente WispHub"}\n${client.mtStr("username") ?: row.mtStr("server") ?: "-"}", Modifier.weight(1f))
            }
            MtBadge(mtIpSourceLabel(row.optJSONArray("sources")), if (!available && row.mtStr("classification") != "client") IspAmber else IspBlue)
            if (available) {
                Button(onClick = { actions.copy(ip) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Outlined.ContentCopy, null); Spacer(Modifier.width(8.dp)); Text("Copiar") }
            } else if (canManage && row.mtBool("dynamic") && row.mtStr("leaseId") != null) {
                OutlinedButton(onClick = {
                    actions.confirm("Fijar concesión DHCP", "¿Fijar la IP $ip para ${row.mtStr("macAddress") ?: "esta MAC"}? Antes se creará un respaldo automático.", "Fijar") {
                        actions.run("POST", "/mikrotik/ipam/leases/${Uri.encode(row.optString("leaseId"))}/make-static", JSONObject().put("confirmation", "FIJAR"),
                            listOf("/mikrotik/ipam", "/mikrotik/dhcp-leases"), "Concesión DHCP convertida a fija", "No se pudo fijar la concesión") { ui.ipamPage = 1 }
                    }
                }, enabled = !ui.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text("Fijar (convertir DHCP en fija)") }
            }
        }
    }
}

private fun gridColor(state: String): Color = when (state) {
    "recommended" -> Color(0xFF0F7A53); "free" -> Color(0xFFC7ECD9); "client" -> Color(0xFF5B9BEA); "occupied" -> Color(0xFFE5A33C)
    "pool" -> Color(0xFFC3CCD6); "router" -> Color(0xFF2D3B34); "conflict" -> Color(0xFFB42318); "edge" -> Color(0xFFE0E6E1)
    "nodata" -> Color.White; else -> Color.Transparent
}

@Composable
private fun MtIpGrid(ipam: JSONObject?, network: String?, actions: MtActions, onPick: (String) -> Unit) {
    var visible by rememberSaveableBoolean(true)
    var selected by remember { mutableStateOf<String?>(null) }
    var touched by remember { mutableStateOf<MtGridCell?>(null) }
    val blocks = remember(ipam, network) { mtGridBlocks(ipam, network) }
    val active = blocks.firstOrNull { it.id == selected } ?: blocks.firstOrNull()
    MtCard {
        MtSectionTitle("Mapa de ocupación", "Cada cuadro es una IP. Toque una libre para copiarla; una ocupada para verla en la tabla.", Icons.Outlined.GridOn) {
            TextButton(onClick = { visible = !visible }, modifier = Modifier.heightIn(min = 48.dp)) {
                Icon(if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, null); Spacer(Modifier.width(4.dp)); Text(if (visible) "Ocultar" else "Mostrar")
            }
        }
        if (!visible) return@MtCard
        if (blocks.isEmpty()) { Text(if (ipam != null) "No hay rangos de IP configurados para dibujar." else "Cargando inventario IP…", style = MaterialTheme.typography.bodySmall, color = GREY); return@MtCard }
        if (ipam.mtBool("truncated")) Notice("Los rangos son muy grandes: solo se dibujan las IPs con uso detectado. Las casillas sin datos no garantizan que la IP esté libre.")
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            blocks.forEach { block ->
                val isActive = active?.id == block.id
                val ratio = if (block.hosts > 0) block.used.toFloat() / block.hosts else 0f
                OutlinedCard(onClick = { selected = block.id; touched = null }, modifier = Modifier.width(150.dp),
                    colors = CardDefaults.outlinedCardColors(containerColor = if (isActive) Color(0xFFEEF6F1) else MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(block.label, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelLarge)
                        LinearProgressIndicator(progress = { ratio }, modifier = Modifier.fillMaxWidth(), color = if (ratio >= .9f) IspRed else IspGreen)
                        Text("${block.counts.getValue("free") + block.counts.getValue("recommended")} libres de ${block.hosts}", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        active?.let { block ->
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                for (start in 0 until 256 step 16) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text(".$start", modifier = Modifier.width(30.dp), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = GREY)
                        block.cells.subList(start, start + 16).forEach { cell ->
                            val color = gridColor(cell.state)
                            Box(Modifier.weight(1f).aspectRatio(1f)
                                .background(color, RoundedCornerShape(3.dp))
                                .then(if (cell.state == "nodata" || cell.state == "outside" || touched?.ip == cell.ip) Modifier.border(1.dp, if (touched?.ip == cell.ip) Color(0xFF15211C) else Color(0xFFCFD8D2), RoundedCornerShape(3.dp)) else Modifier)
                                .then(if (cell.state == "outside") Modifier else Modifier.clickable {
                                    touched = cell
                                    when (cell.state) {
                                        "edge" -> Unit
                                        "free", "recommended" -> actions.copy(cell.ip)
                                        else -> onPick(cell.ip)
                                    }
                                }))
                        }
                    }
                }
            }
            Text(touched?.title ?: "Toque un cuadro para ver quién usa esa IP.", style = MaterialTheme.typography.bodySmall)
            Button(onClick = { block.firstFree?.let { actions.copy(it) } }, enabled = block.firstFree != null, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.ContentCopy, null); Spacer(Modifier.width(8.dp))
                Text(block.firstFree?.let { "Copiar primera libre $it" } ?: "Sin IPs libres en este bloque")
            }
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                (MT_GRID_LEGEND + if (block.counts.getValue("nodata") > 0) listOf("nodata" to "Sin datos") else emptyList()).forEach { (state, label) ->
                    val count = block.counts[state] ?: 0
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(14.dp).background(gridColor(state), RoundedCornerShape(3.dp)).border(1.dp, Color(0xFFCFD8D2), RoundedCornerShape(3.dp)))
                        Spacer(Modifier.width(8.dp))
                        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = if (count == 0) Color(0xFF8A95A6) else Color.Unspecified)
                        Text("$count", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Text("${block.used} de ${block.hosts} usadas · ${if (block.hosts > 0) "%.0f".format(block.used * 100.0 / block.hosts) else "0"}% del bloque ${block.cidr}", style = MaterialTheme.typography.labelSmall, color = GREY)
        }
    }
}

@Composable private fun rememberSaveableBoolean(initial: Boolean): MutableState<Boolean> = androidx.compose.runtime.saveable.rememberSaveable { mutableStateOf(initial) }

// --- Monitoreo (Netwatch) ---
@Composable
internal fun MtNetwatchTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, canManage: Boolean) {
    val state = pages[MT_NETWATCH]
    val items = state?.body?.optJSONArray("items").objects()
    var host by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("icmp") }
    var interval by remember { mutableStateOf("1m") }
    var port by remember { mutableStateOf("") }
    var comment by remember { mutableStateOf("") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Monitoreo de enlaces (Netwatch)", "El router comprueba estos destinos cada cierto tiempo y marca si responden") {
                IconButton(onClick = { vm.load(MT_NETWATCH, true) }, enabled = state?.loading != true, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Actualizar") }
            }
        }
        mtReadStatus(state) { vm.load(MT_NETWATCH, true) }
        if (canManage) item {
            MtCard {
                Text("Nueva sonda", fontWeight = FontWeight.SemiBold)
                OutlinedTextField(host, { host = it.take(253) }, label = { Text("Destino") }, placeholder = { Text("1.1.1.1 o dominio") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtSelect("Tipo", MT_NETWATCH_TYPES, type, Modifier.weight(1f)) { type = it }
                    OutlinedTextField(interval, { interval = it.take(6) }, label = { Text("Cada") }, placeholder = { Text("1m = 1 minuto") }, supportingText = { Text("Ej.: 30s, 1m, 5m") }, singleLine = true, modifier = Modifier.weight(1f))
                }
                OutlinedTextField(port, { port = it.filter(Char::isDigit).take(5) }, label = { Text("Puerto") }, placeholder = { Text("Solo TCP o web") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                OutlinedTextField(comment, { comment = it.take(120) }, label = { Text("Comentario") }, placeholder = { Text("Enlace principal, DNS...") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Button(onClick = {
                    if (host.isBlank() || ui.saving) return@Button
                    val body = JSONObject().put("host", host.trim()).put("type", type).put("interval", interval).put("confirmation", "CREAR")
                    if (type in listOf("tcp-conn", "http-get", "https-get")) port.toIntOrNull()?.takeIf { it != 0 }?.let { body.put("port", it) }
                    comment.trim().takeIf { it.isNotEmpty() }?.let { body.put("comment", it) }
                    actions.run("POST", "/mikrotik/netwatch", body, listOf("/mikrotik/netwatch"), "Sonda de monitoreo creada", "No se pudo crear la sonda") { host = ""; comment = "" }
                }, enabled = !ui.saving && host.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (host.isNotBlank()) "Crear sonda" else "Escriba el destino que desea vigilar")
                }
            }
        }
        if (items.isEmpty() && state?.loading != true) item { EmptyState("No hay sondas configuradas") }
        items(items) { item ->
            val disabled = item.mtBool("disabled")
            val status = item.mtStr("status")
            val color = if (status == "up" && !disabled) IspGreen else if (disabled || status == "down") IspRed else GREY
            val hostName = item.mtStr("host") ?: "-"
            OutlinedCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(hostName, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                            Text(item.mtStr("id") ?: "-", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = GREY)
                        }
                        MtBadge(mtNetwatchStatusLabel(item), color)
                    }
                    Row {
                        MtDatum("Prueba", mtNetwatchTypeLabel(item.mtStr("type")) + (item.optInt("port").takeIf { it > 0 }?.let { " · Puerto $it" } ?: ""), Modifier.weight(1f))
                        MtDatum("Cada", item.mtStr("interval") ?: "-", Modifier.weight(1f))
                    }
                    Row {
                        MtDatum("Desde", item.mtStr("since") ?: "-", Modifier.weight(1f))
                        MtDatum("Comentario", item.mtStr("comment") ?: "-", Modifier.weight(1f))
                    }
                    if (canManage) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            actions.confirm(if (disabled) "Habilitar sonda" else "Deshabilitar sonda", "¿${if (disabled) "Habilitar" else "Deshabilitar"} la sonda $hostName?", if (disabled) "Habilitar" else "Deshabilitar") {
                                actions.run("PATCH", "/mikrotik/netwatch/${Uri.encode(item.optString("id"))}", JSONObject().put("disabled", !disabled).put("confirmation", "APLICAR"),
                                    listOf("/mikrotik/netwatch"), "Sonda actualizada", "No se pudo actualizar la sonda")
                            }
                        }, enabled = !ui.saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) {
                            Icon(if (disabled) Icons.Outlined.CheckCircle else Icons.Outlined.Block, null); Spacer(Modifier.width(6.dp)); Text(if (disabled) "Habilitar" else "Deshabilitar")
                        }
                        OutlinedButton(onClick = {
                            actions.confirm("Eliminar sonda", "¿Eliminar la sonda $hostName? Antes se creará un respaldo automático.", "Eliminar", danger = true) {
                                actions.run("DELETE", "/mikrotik/netwatch/${Uri.encode(item.optString("id"))}", JSONObject().put("confirmation", "ELIMINAR"),
                                    listOf("/mikrotik/netwatch"), "Sonda eliminada", "No se pudo eliminar la sonda")
                            }
                        }, enabled = !ui.saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = IspRed)) {
                            Icon(Icons.Outlined.Delete, null); Spacer(Modifier.width(6.dp)); Text("Eliminar")
                        }
                    }
                }
            }
        }
    }
}

// --- Respaldos ---
@Composable
internal fun MtBackupsTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, canManage: Boolean) {
    val state = pages[MT_BACKUPS]
    val backups = state?.body?.optJSONArray("items").objects()
    var name by remember { mutableStateOf("ispmax-manual-${LocalDate.now(ZoneOffset.UTC)}") }
    var type by remember { mutableStateOf("backup") }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Respaldos del router", "Copias de la configuración guardadas dentro del router") {
                IconButton(onClick = { vm.load(MT_BACKUPS, true) }, enabled = state?.loading != true, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Actualizar") }
            }
        }
        mtReadStatus(state) { vm.load(MT_BACKUPS, true) }
        if (canManage) item {
            MtCard {
                OutlinedTextField(name, { name = it.take(48) }, label = { Text("Nombre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                MtSelect("Formato", listOf("backup" to "Copia completa (binaria)", "export" to "Exportación de texto (.rsc)"), type) { type = it }
                Button(onClick = {
                    if (name.isBlank() || ui.saving) return@Button
                    actions.run("POST", "/mikrotik/backups", JSONObject().put("name", name.trim()).put("type", type).put("confirmation", "CREAR"),
                        listOf("/mikrotik/backups"), "Respaldo creado en el MikroTik", "No se pudo crear el respaldo")
                }, enabled = !ui.saving && name.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Backup, null); Spacer(Modifier.width(8.dp)); Text(if (name.isNotBlank()) "Crear respaldo" else "Escriba un nombre para el respaldo")
                }
            }
        }
        if (backups.isEmpty() && state?.loading != true) item { EmptyState("No hay archivos de respaldo") }
        items(backups) { item ->
            OutlinedCard(Modifier.fillMaxWidth()) {
                Row(Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(item.mtStr("name") ?: "-", fontWeight = FontWeight.SemiBold)
                        Text(item.mtStr("id") ?: "-", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = GREY)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            MtBadge(if (item.mtStr("type") == "backup") "Copia completa" else "Exportación .rsc", IspBlue)
                            Text(mtFormatBytes(item.mtNum("size")), style = MaterialTheme.typography.labelSmall)
                        }
                        Text("Creado: ${item.mtStr("creationTime") ?: "-"}", style = MaterialTheme.typography.labelSmall, color = GREY)
                    }
                    if (canManage) IconButton(onClick = {
                        actions.confirm("Eliminar respaldo", "¿Eliminar el respaldo ${item.optString("name")} del MikroTik? Esta acción no se puede deshacer.", "Eliminar", danger = true) {
                            actions.run("DELETE", "/mikrotik/backups/${Uri.encode(item.optString("id"))}", JSONObject().put("confirmation", "ELIMINAR"),
                                listOf("/mikrotik/backups"), "Respaldo eliminado", "No se pudo eliminar el respaldo")
                        }
                    }, enabled = !ui.saving, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Delete, "Eliminar respaldo", tint = IspRed) }
                }
            }
        }
    }
}

// --- Seguridad y diagnostico ---
@Composable
internal fun MtSecurityTab(vm: MainViewModel, pages: Map<String, PageState>, actions: MtActions, now: Long) {
    val state = pages[MT_SECURITY]
    val audit = state?.body
    val findings = audit?.optJSONArray("findings").objects()
    val admins = audit?.optJSONArray("activeAdministrators").objects()
    val score = audit?.takeIf { it.has("score") && !it.isNull("score") }?.optInt("score")
    var target by remember { mutableStateOf("") }
    var pinging by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val scope = rememberCoroutineScope()
    fun runPing() {
        val address = target.trim()
        if (address.isEmpty() || pinging) return
        pinging = true; result = emptyList()
        scope.launch {
            try { result = vm.web("POST", "/mikrotik/ping", JSONObject().put("address", address).put("count", 4)).optJSONArray("items").objects() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { actions.toast(error.message?.takeIf { it.isNotBlank() } ?: "El ping falló") }
            finally { pinging = false }
        }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Seguridad y diagnóstico", "Auditoría de configuración y acceso administrativo${mtParseTime(audit.mtStr("timestamp"))?.let { " · auditado ${mtRelative(it, now)}" } ?: ""}") {
                TextButton(onClick = { vm.load(MT_SECURITY, true) }, enabled = state?.loading != true, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(4.dp)); Text("Auditar") }
            }
        }
        mtReadStatus(state) { vm.load(MT_SECURITY, true) }
        item {
            val good = (score ?: 0) >= 80
            MtCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Shield, null, tint = if (good) IspGreen else IspAmber, modifier = Modifier.size(34.dp))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(score?.toString() ?: "-", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = if (good) IspGreen else IspAmber)
                        Text("Puntuación de seguridad", style = MaterialTheme.typography.bodySmall)
                    }
                    Text("RouterOS ${audit.mtStr("version") ?: "-"}", style = MaterialTheme.typography.labelSmall, color = GREY)
                }
            }
        }
        item {
            MtCard {
                MtSectionTitle("Hallazgos", "${findings.size} puntos por revisar", Icons.Outlined.WarningAmber)
                if (findings.isEmpty()) Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen); Spacer(Modifier.width(8.dp)); Text("Sin hallazgos críticos", color = IspGreen) }
                findings.forEach { finding ->
                    val color = when (finding.mtStr("severity")) { "critical" -> IspRed; "high" -> IspRed; "medium" -> IspAmber; else -> IspBlue }
                    Row(Modifier.fillMaxWidth().background(color.copy(alpha = .06f), RoundedCornerShape(9.dp)).padding(10.dp)) {
                        Icon(Icons.Outlined.ErrorOutline, null, tint = color, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(finding.mtStr("title") ?: "-", fontWeight = FontWeight.SemiBold)
                            Text(finding.mtStr("detail").orEmpty(), style = MaterialTheme.typography.bodySmall)
                        }
                        MtBadge(mtSeverityLabel(finding.mtStr("severity")), color)
                    }
                }
            }
        }
        item {
            MtCard {
                MtSectionTitle("Administradores activos", "${admins.size} sesiones", Icons.Outlined.People)
                admins.forEach { user ->
                    val userName = user.mtStr("name") ?: "-"
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(32.dp).background(IspGreen.copy(alpha = .12f), CircleShape), contentAlignment = Alignment.Center) { Text(userName.take(1).uppercase(), fontWeight = FontWeight.Bold, color = IspGreen) }
                        Spacer(Modifier.width(10.dp))
                        Column { Text(userName, fontWeight = FontWeight.SemiBold); Text("${user.mtStr("address") ?: "-"} · ${user.mtStr("via") ?: "-"}", style = MaterialTheme.typography.labelSmall, color = GREY) }
                    }
                }
            }
        }
        item {
            MtCard {
                MtSectionTitle("Diagnóstico", "Ping desde el router", Icons.Outlined.Terminal)
                OutlinedTextField(target, { target = it.take(253) }, label = { Text("IP o dominio") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Go), keyboardActions = KeyboardActions(onGo = { runPing() }))
                Button(onClick = { runPing() }, enabled = !pinging && target.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    if (pinging) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.NetworkPing, null)
                    Spacer(Modifier.width(8.dp)); Text(if (pinging) "Probando..." else "Hacer ping")
                }
                if (result.isNotEmpty()) {
                    Column(Modifier.fillMaxWidth().background(Color(0xFF15211C), RoundedCornerShape(8.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        result.forEach { row ->
                            val host = row.mtStr("host") ?: target
                            val line = if (row.has("received")) "$host · ${row.mtStr("time") ?: "-"} · TTL ${row.mtStr("ttl") ?: "-"}" else "$host · ${row.mtStr("status") ?: "Sin respuesta"}"
                            Text(line, color = Color(0xFFBFE6D3), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}
