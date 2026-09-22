package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

// ---------------- Mapa PON ----------------

private class MapPort(val key: String, val number: Int, val state: String, val onu: JSONObject?, val label: String)
private class MapGroup(val key: String, val name: String, val meta: String, val ports: List<MapPort>)

private fun portState(onu: JSONObject?): String = if (onu == null) "empty" else when (onuHealth(onu)) {
    OnuHealth.OFFLINE -> "offline"; OnuHealth.CRITICAL -> "critical"; OnuHealth.WARNING -> "warning"; OnuHealth.ONLINE -> "online"
}
private fun portColor(state: String): Color = when (state) {
    "online" -> IspGreen; "warning" -> IspAmber; "critical", "damaged" -> IspRed; "offline" -> OltGray; else -> Color(0xFFC3CCD3)
}

/** Misma construccion de grupos que buildPonMapGroups() de la web: NAP fisicas o grupos logicos de 8. */
private fun buildGroups(activePon: JSONObject, rows: List<JSONObject>, topology: List<JSONObject>): List<MapGroup> {
    val ponNumber = activePon.optInt("pon")
    val byIndex = rows.associateBy { it.text("onuIndex", "") }
    val splitters = topology.filter { it.text("ponIndex", "").split("/").lastOrNull()?.toIntOrNull() == ponNumber }
    val physical = splitters.flatMap { splitter ->
        splitter.optJSONArray("naps").objects().map { nap ->
            val ports = nap.optJSONArray("ports").objects()
            val readings = ports.mapNotNull { byIndex[it.oltStr("onuIndex") ?: ""] }.filter { it.oltNum("rxPowerDbm") != null }
            val average = if (readings.isEmpty()) null else readings.sumOf { it.oltNum("rxPowerDbm")!! } / readings.size
            val napName = nap.oltStr("name") ?: nap.text("code", "NAP")
            MapGroup("nap:${nap.optInt("id")}", napName,
                "${nap.optInt("usedPorts")}/${nap.optInt("capacity")} usados" + (average?.let { " · RX promedio ${"%.1f".format(java.util.Locale.US, it)} dBm" } ?: ""),
                ports.map { port ->
                    val onu = byIndex[port.oltStr("onuIndex") ?: ""]
                    MapPort("nap-port:${port.optInt("id")}", port.optInt("portNumber"), if (port.oltStr("status") == "damaged") "damaged" else portState(onu), onu,
                        if (onu != null) "${oltOnuName(onu)}: ${oltOnuStatusLabel(onu)}" else "$napName puerto ${port.optInt("portNumber")}: ${oltNapPortStatus(port.oltStr("status"))}")
                })
        }
    }
    if (physical.isNotEmpty()) return physical
    val lastAssigned = rows.lastOrNull()?.optInt("onuId") ?: 0
    val capacity = max(activePon.optInt("capacity").takeIf { it > 0 } ?: 32, lastAssigned)
    val visible = min(capacity, max(8, ceil(lastAssigned / 8.0).toInt() * 8 + if (lastAssigned < capacity) 8 else 0))
    val groupCount = max(1, ceil(visible / 8.0).toInt())
    return (0 until groupCount).map { groupIndex ->
        val first = groupIndex * 8 + 1
        val ports = (0 until min(8, capacity - groupIndex * 8)).map { offset ->
            val number = first + offset
            val onu = rows.firstOrNull { it.optInt("onuId") == number }
            MapPort("onu:$ponNumber:$number", number, portState(onu), onu, if (onu != null) "${oltOnuName(onu)}: ${oltOnuStatusLabel(onu)}" else "Posición $number disponible")
        }
        val populated = ports.mapNotNull { it.onu }
        val readings = populated.mapNotNull { it.oltNum("rxPowerDbm") }
        val average = if (readings.isEmpty()) null else readings.average()
        MapGroup("logical:$groupIndex", "Grupo ${first.toString().padStart(2, '0')}-${(first + ports.size - 1).toString().padStart(2, '0')}",
            "${populated.size}/${ports.size} ONUs" + (average?.let { " · RX promedio ${"%.1f".format(java.util.Locale.US, it)} dBm" } ?: ""), ports)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OltMapTab(ctx: OltCtx, selectedPon: Int?, onSelectPon: (Int) -> Unit, onInspect: (JSONObject) -> Unit, onInventory: (Int?) -> Unit, onQuickReboot: (JSONObject) -> Unit) {
    val ponsState = ctx.page(OltPaths.PONS)
    val pons = ctx.items(OltPaths.PONS)
    val mapOnus = ctx.items(OltPaths.MAP)
    val topology = ctx.items(OltPaths.TOPOLOGY)
    val status = ctx.page(OltPaths.STATUS).body
    var ponSearch by remember { mutableStateOf("") }
    var contextId by remember { mutableStateOf<Int?>(null) }
    val filteredPons = pons.filter { ponSearch.isBlank() || "pon ${it.optInt("pon")} ${it.text("ponIndex", "")}".lowercase().contains(ponSearch.trim().lowercase()) }
    val activePon = pons.firstOrNull { it.optInt("pon") == selectedPon } ?: pons.firstOrNull()
    val ponOnus = mapOnus.filter { it.optInt("pon") == activePon?.optInt("pon") }.sortedBy { it.optInt("onuId") }
    val groups = remember(activePon, ponOnus, topology) { if (activePon == null) emptyList() else buildGroups(activePon, ponOnus, topology) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { ReadStatus(ponsState) { ctx.vm.load(OltPaths.PONS, true) } }
        item {
            OutlinedTextField(ponSearch, { ponSearch = it }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                label = { Text("Filtrar puertos (${pons.size} activos)") }, modifier = Modifier.fillMaxWidth())
        }
        item {
            if (filteredPons.isEmpty()) Text("No hay coincidencias.", style = MaterialTheme.typography.bodySmall)
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(filteredPons, key = { it.text("ponIndex", it.optInt("pon").toString()) }) { pon ->
                    val tone = when (pon.oltStr("health")) { "critical" -> IspRed; "warning" -> IspAmber; else -> IspGreen }
                    FilterChip(selected = activePon?.optInt("pon") == pon.optInt("pon"), onClick = { onSelectPon(pon.optInt("pon")); contextId = null },
                        leadingIcon = { OltDot(tone) }, modifier = Modifier.heightIn(min = 44.dp),
                        label = { Text("PON ${pon.optInt("pon")} · ${pon.optInt("total")}/${pon.optInt("capacity")}") })
                }
            }
        }
        if (activePon != null) item {
            OltCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("PON ${activePon.optInt("pon")}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        Text("Capacidad ${activePon.optInt("total")} de ${activePon.optInt("capacity")}", style = MaterialTheme.typography.bodySmall)
                    }
                    OutlinedButton(onClick = { onInventory(activePon.optInt("pon")) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Ver inventario") }
                }
                val usage = activePon.optDouble("utilizationPercent", 0.0)
                Text("Capacidad usada ${oltNumText(usage)}%", style = MaterialTheme.typography.labelMedium)
                LinearProgressIndicator(progress = { (usage / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
                Text("${activePon.optInt("online")} en línea · ${activePon.optInt("offline")} sin conexión", style = MaterialTheme.typography.bodySmall)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Dns, null, tint = IspBlue)
                    Column {
                        Text(status?.optJSONObject("latest")?.oltStr("systemName") ?: "OLT ZTE C320", fontWeight = FontWeight.SemiBold)
                        Text("${status?.optJSONObject("latest")?.oltStr("model") ?: "C320"} · ${if (status?.optBoolean("connected") == true) "En línea" else "Sin conexión"}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        if (groups.isEmpty() && !ponsState.loading) item { EmptyState("Este PON aún no tiene inventario. Sincroniza la OLT para mostrar sus ONUs.") }
        items(groups, key = { it.key }) { group ->
            OltCard {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.AccountTree, null, tint = IspBlue, modifier = Modifier.size(18.dp))
                    Text(group.name, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                }
                Text(group.meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val free = group.ports.filter { it.onu == null && it.state == "empty" }
                group.ports.filter { it.onu != null || it.state != "empty" }.forEach { port ->
                    val onu = port.onu
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(enabled = onu != null) { contextId = onu?.optInt("id") }.padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Box(Modifier.size(30.dp).background(portColor(port.state).copy(alpha = 0.16f), MaterialTheme.shapes.small), contentAlignment = Alignment.Center) {
                            Text(port.number.toString(), color = portColor(port.state), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                        }
                        Column(Modifier.weight(1f)) {
                            Text(if (onu != null) oltOnuName(onu) else port.label, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(if (onu != null) oltOnuStatusLabel(onu) else if (port.state == "damaged") "Averiado" else "", style = MaterialTheme.typography.bodySmall, color = portColor(port.state))
                        }
                        onu?.oltNum("rxPowerDbm")?.let { OltMono(oltDbm(it), color = oltSignalColor(it), weight = FontWeight.Bold) }
                    }
                }
                if (free.isNotEmpty()) Text("Libres: ${free.joinToString(", ") { it.number.toString() }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("Buena" to IspGreen, "Débil" to IspAmber, "Crítica" to IspRed, "Sin conexión" to OltGray).forEach { (label, color) ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) { OltDot(color, 8); Text(label, style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }

    val contextOnu = contextId?.let { id -> mapOnus.firstOrNull { it.optInt("id") == id } }
    if (contextOnu != null) OltOnuContextSheet(ctx, contextOnu, close = { contextId = null }, onInspect = { contextId = null; onInspect(it) },
        onQuickReboot = { contextId = null; onQuickReboot(it) })
}

/** Resumen de la ONU seleccionada en el mapa (panel lateral de la web). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OltOnuContextSheet(ctx: OltCtx, onu: JSONObject, close: () -> Unit, onInspect: (JSONObject) -> Unit, onQuickReboot: (JSONObject) -> Unit) {
    val scope = rememberCoroutineScope()
    var reading by remember { mutableStateOf(false) }
    val health = onuHealth(onu)
    val rx = onu.oltNum("rxPowerDbm")
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                OltPill(oltOnuStatusLabel(onu), health.color())
                Text(if (onu.optBoolean("online")) "En línea" else "Sin conexión", style = MaterialTheme.typography.bodySmall)
            }
            Text(onu.optJSONObject("client")?.oltStr("nombre") ?: onu.oltStr("name") ?: "ONU sin asociar", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("PON ${onu.optInt("pon")} · ONU ${onu.optInt("onuId")}", style = MaterialTheme.typography.bodySmall)
            Row { OltField("Señal óptica (RX)", oltSignalLabel(rx) + (rx?.let { " · ${oltDbm(it)}" } ?: ""), Modifier.weight(1f), oltSignalColor(rx)); OltField("Modelo", onu.oltStr("model") ?: "--", Modifier.weight(1f)) }
            Row { OltField("Serial", onu.oltStr("serial") ?: "--", Modifier.weight(1f), mono = true); OltField("IP de gestión", oltOnuIp(onu).ifBlank { "--" }, Modifier.weight(1f), mono = true) }
            Row { if (oltOnuMac(onu).isNotBlank()) OltField("MAC", oltOnuMac(onu), Modifier.weight(1f), mono = true); OltField("Distancia", onu.oltNum("distanceM")?.let { "${oltNumText(it)} m" } ?: "--", Modifier.weight(1f)); OltField("Tiempo en línea", onu.oltStr("onlineDuration") ?: "--", Modifier.weight(1f)) }
            Button(onClick = { onInspect(onu) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Outlined.Visibility, null); Spacer(Modifier.width(8.dp)); Text("Abrir ONU") }
            OutlinedButton(onClick = {
                if (reading) return@OutlinedButton
                reading = true
                scope.launch {
                    try {
                        val detail = ctx.read("${oltOnuRoute(onu)}/detail")
                        ctx.notify("Lectura óptica actualizada: ${detail.oltNum("rxPowerDbm")?.let(::oltNumText) ?: "--"} dBm")
                        ctx.vm.load(OltPaths.MAP, true)
                    } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo actualizar la lectura óptica") } finally { reading = false }
                }
            }, enabled = !reading, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Outlined.Speed, null); Spacer(Modifier.width(8.dp)); Text(if (reading) "Leyendo..." else "Leer óptica") }
            onu.oltInt("clientIdServicio")?.let { id -> OutlinedButton(onClick = { close(); ctx.onClient(id) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Icon(Icons.Outlined.OpenInNew, null); Spacer(Modifier.width(8.dp)); Text("Expediente del cliente") } }
            Text("Acciones rápidas", fontWeight = FontWeight.Bold)
            ListItem(modifier = Modifier.clickable { onInspect(onu) }, leadingContent = { Icon(Icons.Outlined.MonitorHeart, null) },
                headlineContent = { Text("Diagnóstico completo") }, supportingContent = { Text("OLT, WispHub y MikroTik") })
            if (ctx.admin) ListItem(modifier = Modifier.clickable(enabled = onu.optBoolean("online")) { onQuickReboot(onu) },
                leadingContent = { Icon(Icons.Outlined.PowerSettingsNew, null, tint = if (onu.optBoolean("online")) IspRed else OltGray) },
                headlineContent = { Text("Reiniciar ONU") }, supportingContent = { Text(if (onu.optBoolean("online")) "Pide confirmación antes de reiniciar" else "No disponible: ONU sin conexión") })
            Text("Última lectura: ${oltDate(onu.oltStr("lastDetailAt") ?: onu.oltStr("lastSeenAt"))}", style = MaterialTheme.typography.bodySmall)
            Text(onu.oltStr("lastOfflineCause")?.let { "Última desconexión: $it" } ?: "Sin fallos recientes reportados por la OLT.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

// ---------------- Salud de la red optica ----------------

private class PonHealthRow(val pon: JSONObject, val tone: String, val toneLabel: String, val reason: String, val los: Int, val power: Int, val otherDown: Int, val worst: JSONObject?)
private class Insight(val key: String, val tone: String, val title: String, val detail: String, val pon: Int? = null, val filter: String? = null)
private class AlertGroup(val onuIndex: String, val onu: JSONObject?, var detections: Int, var alerts: Int, var critical: Boolean, var lastSeenAt: String, var message: String)
private fun toneRank(tone: String) = when (tone) { "critical" -> 0; "warning" -> 1; "info" -> 2; else -> 3 }
private fun toneColor(tone: String) = when (tone) { "critical" -> IspRed; "warning" -> IspAmber; "info" -> IspBlue; else -> IspGreen }

@Composable
internal fun OltHealthTab(ctx: OltCtx, onInspect: (JSONObject) -> Unit, onPon: (Int) -> Unit, onInventory: (String) -> Unit) {
    val onus = ctx.items(OltPaths.MAP)
    val pons = ctx.items(OltPaths.PONS)
    val alarms = ctx.items(OltPaths.ALARMS)
    val signalAlerts = ctx.items(OltPaths.SIGNAL)
    val totalOnus = ctx.page(OltPaths.STATUS).body?.optJSONObject("totals")?.optInt("totalOnus") ?: 0
    val byIndex = onus.associateBy { it.text("onuIndex", "") }

    val online = onus.filter { it.optBoolean("online") }
    val offline = onus.filter { !it.optBoolean("online") }
    val readings = online.mapNotNull { it.oltNum("rxPowerDbm") }
    val kCritical = online.count { oltIsCritical(it.oltNum("rxPowerDbm")) }
    val kWeak = online.count { oltIsWeak(it.oltNum("rxPowerDbm")) && !oltIsCritical(it.oltNum("rxPowerDbm")) }
    val kUnlinked = onus.count { it.oltInt("clientIdServicio") == null || it.oltInt("clientIdServicio") == 0 }
    val avgRx = if (readings.isEmpty()) null else (readings.average() * 10).roundToInt() / 10.0
    val onlinePercent = if (onus.isEmpty()) 0 else (online.size * 100.0 / onus.size).roundToInt()

    val ponRows = pons.map { pon ->
        val rows = onus.filter { it.optInt("pon") == pon.optInt("pon") }
        val down = rows.filter { !it.optBoolean("online") }
        val los = down.count { oltOfflineCause(it) == "los" }
        val power = down.count { oltOfflineCause(it) == "power" }
        val worst = rows.filter { it.optBoolean("online") && it.oltNum("rxPowerDbm") != null }.minByOrNull { it.oltNum("rxPowerDbm")!! }
        val total = pon.optInt("total"); val off = pon.optInt("offline"); val avg = pon.oltNum("avgRxPowerDbm")
        val (tone, reason) = when {
            total > 0 && off >= total -> "critical" to "Todo el PON sin conexión"
            los >= 3 -> "critical" to "$los ONUs sin señal óptica a la vez"
            pon.oltStr("health") == "critical" || pon.optInt("critical") > 0 -> "critical" to (if (pon.optInt("critical") > 0) "${pon.optInt("critical")} con señal crítica" else "Estado crítico reportado")
            off > 0 -> "warning" to "$off sin conexión"
            pon.optInt("weak") > 0 -> "warning" to "${pon.optInt("weak")} con señal débil"
            avg != null && avg <= -25 -> "warning" to "RX promedio bajo"
            pon.oltStr("health") == "warning" -> "warning" to "Requiere atención"
            pon.optDouble("utilizationPercent", 0.0) >= 90 -> "info" to "Casi lleno"
            else -> "healthy" to "Sin problemas detectados"
        }
        val label = mapOf("critical" to "Crítico", "warning" to "Atención", "info" to "Aviso", "healthy" to "Bien")[tone]!!
        PonHealthRow(pon, tone, label, reason, los, power, max(0, off - los - power), worst)
    }.sortedWith(compareBy<PonHealthRow> { toneRank(it.tone) }.thenByDescending { it.pon.optInt("offline") }
        .thenByDescending { it.pon.optDouble("utilizationPercent", 0.0) }.thenBy { it.pon.optInt("pon") })

    val insights = buildList {
        for (row in ponRows) {
            val pon = row.pon; val n = pon.optInt("pon"); val total = pon.optInt("total")
            if (total > 0 && pon.optInt("offline") >= total) {
                add(Insight("all-$n", "critical", "PON $n: todas sus $total ONUs sin conexión", "Revise el puerto PON, el patch cord en la OLT o la fibra troncal de esa salida.", pon = n)); continue
            }
            if (row.los >= 3) add(Insight("los-$n", "critical", "PON $n: ${row.los} ONUs sin señal óptica (LOS)", "Varias caídas LOS en el mismo PON suelen indicar corte de fibra, splitter o NAP dañada.", pon = n))
            if (row.power >= 3) add(Insight("power-$n", "warning", "PON $n: ${row.power} ONUs sin energía", "Probable apagón eléctrico en la zona. Confirme antes de enviar un técnico de fibra.", pon = n))
            val avg = pon.oltNum("avgRxPowerDbm")
            if (avg != null && avg <= -25 && pon.optInt("online") > 1) add(Insight("avg-$n", "warning", "PON $n: RX promedio ${oltNumText(avg)} dBm", "Toda la rama está baja: revise empalmes troncales, el splitter principal y los conectores de la OLT.", pon = n))
            if (pon.optDouble("utilizationPercent", 0.0) >= 90) add(Insight("full-$n", "info", "PON $n casi lleno: $total de ${pon.optInt("capacity")}", "Planifique otra salida PON o splitter antes de nuevas instalaciones en esa zona.", pon = n))
        }
        if (kCritical > 0) add(Insight("critical", "critical", "$kCritical ${if (kCritical == 1) "ONU" else "ONUs"} con señal crítica (≤ -30 dBm)", "Pueden cortarse en cualquier momento. Priorice la visita técnica.", filter = "critical"))
        if (kWeak > 0) add(Insight("weak", "warning", "$kWeak ${if (kWeak == 1) "ONU" else "ONUs"} con señal débil", "Entre -27 y -30 dBm: limpie conectores y revise la acometida en la próxima visita.", filter = "weak"))
        if (kUnlinked > 0) add(Insight("unlinked", "info", "$kUnlinked ${if (kUnlinked == 1) "ONU" else "ONUs"} sin cliente asociado", "Asócielas para ver el nombre del cliente en el mapa, en las alertas y en el diagnóstico.", filter = "unlinked"))
    }.sortedBy { toneRank(it.tone) }.take(7)

    val worstSignal = online.filter { it.oltNum("rxPowerDbm") != null }.sortedBy { it.oltNum("rxPowerDbm") }.take(10)
    val causeRank = mapOf("los" to 0, "power" to 1, "other" to 2)
    val downNow = offline.sortedWith(compareBy<JSONObject> { causeRank[oltOfflineCause(it)] }.thenBy { it.optInt("pon") }.thenBy { it.optInt("onuId") }).take(10)
    val alertRanking = run {
        val groups = linkedMapOf<String, AlertGroup>()
        for (alert in signalAlerts) {
            val index = alert.text("onuIndex", "")
            val isCritical = alert.oltStr("severity")?.lowercase() == "critical"
            val current = groups[index]
            if (current == null) {
                groups[index] = AlertGroup(index, byIndex[index], alert.optInt("occurrenceCount").coerceAtLeast(1), 1, isCritical, alert.text("lastSeenAt", ""), alert.text("message", ""))
            } else {
                current.detections += alert.optInt("occurrenceCount").coerceAtLeast(1); current.alerts += 1; current.critical = current.critical || isCritical
                if ((oltInstant(alert.oltStr("lastSeenAt")) ?: java.time.Instant.EPOCH) > (oltInstant(current.lastSeenAt) ?: java.time.Instant.EPOCH)) { current.lastSeenAt = alert.text("lastSeenAt", ""); current.message = alert.text("message", "") }
            }
        }
        groups.values.sortedWith(compareByDescending<AlertGroup> { it.critical }.thenByDescending { it.detections }).take(10)
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Lo peor primero: ${onus.size} ONUs analizadas · se recalcula con cada lectura de la OLT.", style = MaterialTheme.typography.bodySmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("ONUs", style = MaterialTheme.typography.labelMedium); ExportButton(oltOnuCsvRows(onus), "onus_olt")
                Spacer(Modifier.width(8.dp))
                Text("Resumen PON", style = MaterialTheme.typography.labelMedium); ExportButton(ponRows.map { row ->
                    JSONObject().put("PON", row.pon.optInt("pon")).put("Índice", row.pon.text("ponIndex", "")).put("Semáforo", row.toneLabel).put("Motivo", row.reason)
                        .put("ONUs", row.pon.optInt("total")).put("Capacidad", row.pon.optInt("capacity")).put("Ocupación %", oltNumText(row.pon.oltNum("utilizationPercent")))
                        .put("En línea", row.pon.optInt("online")).put("Sin conexión", row.pon.optInt("offline")).put("Sin señal óptica (LOS)", row.los).put("Sin energía", row.power)
                        .put("Señal débil", row.pon.optInt("weak")).put("Señal crítica", row.pon.optInt("critical")).put("RX promedio (dBm)", row.pon.oltNum("avgRxPowerDbm")?.let(::oltNumText) ?: "")
                        .put("Peor ONU", row.worst?.let { "${oltOnuName(it)} (${it.text("onuIndex", "")})" } ?: "").put("Peor RX (dBm)", row.worst?.oltNum("rxPowerDbm")?.let(::oltNumText) ?: "")
                }, "resumen_pon")
                Spacer(Modifier.width(8.dp))
                Text("Alarmas", style = MaterialTheme.typography.labelMedium); ExportButton(oltAlarmCsvRows(signalAlerts, alarms, byIndex), "alarmas_olt")
            }
        }
        if (totalOnus > onus.size) item { Notice("Se analizan ${onus.size} de $totalOnus ONUs (las cargadas en el mapa). Los totales por PON sí incluyen todas.") }
        item {
            val kpis = listOf(
                Triple("En línea", "$onlinePercent%", "${online.size} de ${onus.size} ONUs") to null,
                Triple("Caídas", offline.size.toString(), "${offline.count { oltOfflineCause(it) == "los" }} sin fibra (LOS) · ${offline.count { oltOfflineCause(it) == "power" }} sin energía") to "offline",
                Triple("Señal crítica", kCritical.toString(), "≤ -30 dBm") to "critical",
                Triple("Señal débil", kWeak.toString(), "-27 a -30 dBm") to "weak",
                Triple("Sin cliente", kUnlinked.toString(), "Sin asociar en ISP Max") to "unlinked",
                Triple("RX promedio", avgRx?.let { "${oltNumText(it)} dBm" } ?: "--", "${online.count { it.oltNum("rxPowerDbm") == null }} en línea sin lectura") to null,
            )
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                kpis.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { (kpi, filter) ->
                            val color = when (filter) { "offline", "critical" -> if (kpi.second != "0") IspRed else null; "weak" -> if (kpi.second != "0") IspAmber else null; "unlinked" -> if (kpi.second != "0") IspBlue else null; else -> null }
                            OltCard(Modifier.weight(1f), onClick = filter?.let { key -> { onInventory(key) } }) {
                                Text(kpi.first, style = MaterialTheme.typography.labelSmall)
                                Text(kpi.second, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color ?: MaterialTheme.colorScheme.onSurface)
                                Text(kpi.third, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                            }
                        }
                    }
                }
            }
        }
        item { OltSectionTitle("Qué revisar primero", "Conclusiones automáticas a partir del estado actual") }
        if (insights.isEmpty()) item { Notice("Sin problemas detectados. Ninguna ONU caída ni con señal fuera de rango en este momento.") }
        items(insights, key = { it.key }) { insight ->
            OltCard(accent = toneColor(insight.tone)) {
                Text(insight.title, fontWeight = FontWeight.Bold, color = toneColor(insight.tone))
                Text(insight.detail, style = MaterialTheme.typography.bodySmall)
                if (insight.pon != null) TextButton(onClick = { onPon(insight.pon) }) { Text("Ver PON ${insight.pon}") }
                else if (insight.filter != null) TextButton(onClick = { onInventory(insight.filter) }) { Text("Ver lista") }
            }
        }
        item { OltSectionTitle("Resumen por PON", "Ordenado de peor a mejor · toque para abrir su mapa") }
        if (ponRows.isEmpty()) item { EmptyState("No hay puertos PON en el último inventario. Sincronice la OLT.") }
        items(ponRows, key = { "pon-" + it.pon.text("ponIndex", it.pon.optInt("pon").toString()) }) { row ->
            OltCard(onClick = { onPon(row.pon.optInt("pon")) }, accent = toneColor(row.tone)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("PON ${row.pon.optInt("pon")}", fontWeight = FontWeight.Bold)
                        OltMono(row.pon.text("ponIndex", ""))
                    }
                    Column(horizontalAlignment = Alignment.End) { OltPill(row.toneLabel, toneColor(row.tone)); Text(row.reason, style = MaterialTheme.typography.labelSmall) }
                }
                val usage = row.pon.optDouble("utilizationPercent", 0.0)
                LinearProgressIndicator(progress = { (usage / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth(), color = if (usage >= 90) IspAmber else MaterialTheme.colorScheme.primary)
                Text("${row.pon.optInt("total")}/${row.pon.optInt("capacity")} · ${oltNumText(usage)}% · ${row.pon.optInt("online")} en línea", style = MaterialTheme.typography.bodySmall)
                if (row.pon.optInt("offline") > 0) Text("${row.pon.optInt("offline")} caídas: ${row.los} LOS · ${row.power} energía" + (if (row.otherDown > 0) " · ${row.otherDown} otras" else ""), style = MaterialTheme.typography.bodySmall, color = IspRed)
                Text("Débil ${row.pon.optInt("weak")} / crítica ${row.pon.optInt("critical")} · RX promedio ${oltDbm(row.pon.oltNum("avgRxPowerDbm"))}", style = MaterialTheme.typography.bodySmall)
                row.worst?.let { worst -> TextButton(onClick = { onInspect(worst) }) { Text("Peor ONU: ${oltOnuName(worst)} (${oltDbm(worst.oltNum("rxPowerDbm"))})", maxLines = 1, overflow = TextOverflow.Ellipsis) } }
            }
        }
        item { OltSectionTitle("Peor señal RX", "Las 10 ONUs en línea con menos potencia") }
        if (worstSignal.isEmpty()) item { Text("Aún no hay lecturas ópticas de ONUs en línea.", style = MaterialTheme.typography.bodySmall) }
        itemsIndexed(worstSignal, key = { _, it -> "worst-" + it.optInt("id") }) { index, onu ->
            val rx = onu.oltNum("rxPowerDbm")
            val meter = rx?.let { max(4.0, min(100.0, ((it + 32) / 24.0) * 100)) } ?: 0.0
            OltCard(onClick = { onInspect(onu) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${index + 1}", fontWeight = FontWeight.Bold)
                    Column(Modifier.weight(1f)) {
                        Text(oltOnuName(onu), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("PON ${onu.optInt("pon")} · ONU ${onu.optInt("onuId")} · ${onu.oltStr("serial") ?: "--"}", style = MaterialTheme.typography.bodySmall)
                    }
                    OltMono(oltDbm(rx), color = onuHealth(onu).color(), weight = FontWeight.Bold)
                }
                LinearProgressIndicator(progress = { (meter / 100).toFloat() }, modifier = Modifier.fillMaxWidth(), color = onuHealth(onu).color())
            }
        }
        item { OltSectionTitle("Caídas ahora", "Primero sin fibra (LOS), luego sin energía") }
        if (downNow.isEmpty()) item { Text("Todas las ONUs están en línea.", color = IspGreen, style = MaterialTheme.typography.bodySmall) }
        items(downNow, key = { "down-" + it.optInt("id") }) { onu ->
            OltCard(onClick = { onInspect(onu) }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Icon(if (oltOfflineCause(onu) == "power") Icons.Outlined.PowerOff else Icons.Outlined.LinkOff, oltPhaseLabel(onu.oltStr("phaseState")), tint = if (oltOfflineCause(onu) == "los") IspRed else IspAmber)
                    Column(Modifier.weight(1f)) {
                        Text(oltOnuName(onu), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text("PON ${onu.optInt("pon")} · ONU ${onu.optInt("onuId")} · ${oltPhaseLabel(onu.oltStr("phaseState"))}", style = MaterialTheme.typography.bodySmall)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        onu.oltInt("clientIdServicio")?.let { id -> TextButton(onClick = { ctx.onClient(id) }) { Text("Cliente") } }
                        Text(oltAgo(onu.oltStr("lastSeenAt")), style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
        if (offline.size > downNow.size) item { TextButton(onClick = { onInventory("offline") }) { Text("Ver las ${offline.size} caídas") } }
        item { OltSectionTitle("Más alertas de señal", "ONUs con más detecciones de degradación") }
        if (alertRanking.isEmpty()) item { Text("Sin alertas de degradación activas.", color = IspGreen, style = MaterialTheme.typography.bodySmall) }
        items(alertRanking, key = { "alert-" + it.onuIndex }) { group ->
            OltCard(onClick = group.onu?.let { { onInspect(it) } }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(group.detections.toString(), fontWeight = FontWeight.Bold, color = if (group.critical) IspRed else IspAmber)
                    Column(Modifier.weight(1f)) {
                        Text(group.onu?.let(::oltOnuName) ?: group.onuIndex, fontWeight = FontWeight.SemiBold)
                        Text(group.message, style = MaterialTheme.typography.bodySmall)
                    }
                    Text(oltAgo(group.lastSeenAt), style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

internal fun oltAlarmCsvRows(signalAlerts: List<JSONObject>, alarms: List<JSONObject>, byIndex: Map<String, JSONObject>): List<JSONObject> =
    signalAlerts.map { alert ->
        JSONObject().put("Tipo", "Señal óptica").put("Nivel", oltAlarmLevel(alert.oltStr("severity"))).put("Descripción", alert.text("message", ""))
            .put("ONU", alert.text("onuIndex", "")).put("Cliente", byIndex[alert.text("onuIndex", "")]?.optJSONObject("client")?.oltStr("nombre") ?: "")
            .put("Detecciones", alert.optInt("occurrenceCount").toString()).put("Desde", oltDate(alert.oltStr("firstSeenAt"))).put("Última vez", oltDate(alert.oltStr("lastSeenAt")))
    } + alarms.map { alarm ->
        JSONObject().put("Tipo", "Chasis OLT").put("Nivel", oltAlarmLevel(alarm.oltStr("level"))).put("Descripción", alarm.text("description", ""))
            .put("ONU", "").put("Cliente", "").put("Detecciones", "").put("Desde", alarm.oltStr("alarmTime") ?: "").put("Última vez", oltDate(alarm.oltStr("lastSeenAt")))
    }
