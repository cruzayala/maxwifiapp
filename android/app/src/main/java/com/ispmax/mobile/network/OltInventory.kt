package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val ONU_VIEWS = listOf("list" to "Lista", "cards" to "Tarjetas", "grid" to "Mosaico", "pon" to "Por PON", "signal" to "Por señal")

@Composable
internal fun OltInventoryTab(ctx: OltCtx, inv: OltInventoryState, syncing: Boolean, onSync: () -> Unit, onInspect: (JSONObject) -> Unit) {
    val scope = rememberCoroutineScope()
    val path = inv.path()
    // La web siempre vuelve a pedir la pagina al cambiar filtros o pagina.
    LaunchedEffect(path) { ctx.vm.load(path, true) }
    LaunchedEffect(inv.searchInput) {
        delay(300)
        if (inv.search != inv.searchInput) { inv.search = inv.searchInput; inv.page = 1 }
    }
    val state = ctx.page(path)
    val body = state.body
    val totals = ctx.page(OltPaths.STATUS).body?.optJSONObject("totals") ?: JSONObject()
    val mapOnus = ctx.items(OltPaths.MAP)
    val pons = ctx.items(OltPaths.PONS)
    val onlineMap = mapOnus.filter { it.optBoolean("online") }
    val weakCount = onlineMap.count { oltIsWeak(it.oltNum("rxPowerDbm")) && !oltIsCritical(it.oltNum("rxPowerDbm")) }
    val criticalCount = onlineMap.count { oltIsCritical(it.oltNum("rxPowerDbm")) }
    val localRows = inv.localSignal?.let { filter ->
        onlineMap.filter { if (filter == "critical") oltIsCritical(it.oltNum("rxPowerDbm")) else oltIsWeak(it.oltNum("rxPowerDbm")) && !oltIsCritical(it.oltNum("rxPowerDbm")) }
            .filter { inv.pon == null || it.optInt("pon") == inv.pon }
            .filter { oltMatchesOnu(it, inv.search) }
            .sortedBy { it.oltNum("rxPowerDbm") }
    }
    val rows = localRows ?: body?.optJSONArray("items").objects()
    val pageNumber = body?.optInt("page", 1) ?: 1
    val pagesCount = body?.optInt("pages", 1) ?: 1
    val emptyText = inv.localSignal?.let { "Ninguna ONU en línea tiene señal ${if (it == "critical") "crítica" else "débil"} con estos filtros. Buena noticia." }
        ?: "No hay ONUs para estos filtros. Cambie la búsqueda o elija «Todas»."

    var associationLoading by remember { mutableStateOf(false) }
    var association by remember { mutableStateOf<JSONObject?>(null) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OltChips(listOf(
                Triple("all", "Todas", totals.optInt("totalOnus")), Triple("offline", "Caídas", totals.optInt("offlineOnus")),
                Triple("critical", "Señal crítica", criticalCount), Triple("weak", "Señal débil", weakCount),
                Triple("unlinked", "Sin cliente asociado", totals.optInt("unlinkedOnus")),
            ), inv.activeQuick()) { inv.setQuick(it) }
        }
        item {
            OutlinedTextField(inv.searchInput, { inv.searchInput = it }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                label = { Text("Buscar cliente, ONU, serial o modelo") }, modifier = Modifier.fillMaxWidth())
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("all" to "Todas", "online" to "En línea", "offline" to "Sin conexión").forEach { (key, label) ->
                    FilterChip(selected = inv.localSignal == null && inv.status == key, onClick = { inv.localSignal = null; inv.status = key; inv.page = 1 }, label = { Text(label) }, modifier = Modifier.heightIn(min = 44.dp))
                }
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OltSelect("Asociación", inv.mapping, listOf("all" to "Todas las asociaciones", "linked" to "Con cliente", "unlinked" to "Sin cliente"), Modifier.weight(1f)) {
                    inv.localSignal = null; inv.mapping = it; inv.page = 1
                }
                OltSelect("PON", inv.pon?.toString() ?: "", listOf("" to "Todas las PON") + pons.map { it.optInt("pon").toString() to "PON ${it.optInt("pon")}" }, Modifier.weight(1f)) {
                    inv.pon = it.toIntOrNull(); inv.page = 1
                }
            }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (ctx.admin) {
                    OutlinedButton(onClick = {
                        if (associationLoading) return@OutlinedButton
                        associationLoading = true
                        scope.launch {
                            try { association = ctx.read("/olt-api/reconciliation/associations/preview") }
                            catch (error: Exception) { ctx.notify(error.message ?: "No se pudo preparar la asociación masiva") }
                            finally { associationLoading = false }
                        }
                    }, enabled = !associationLoading, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.Link, null); Spacer(Modifier.width(6.dp)); Text(if (associationLoading) "Analizando..." else "Asociar todos") }
                    OutlinedButton(onClick = onSync, enabled = !syncing, modifier = Modifier.heightIn(min = 44.dp)) { Text(if (syncing) "Leyendo OLT..." else "Actualizar seriales") }
                }
                Text("Exportar CSV", style = MaterialTheme.typography.labelMedium)
                ExportButton(oltOnuCsvRows(rows), "onus" + (inv.localSignal ?: inv.status.takeIf { it != "all" } ?: inv.mapping.takeIf { it != "all" })?.let { "_$it" }.orEmpty())
            }
        }
        inv.localSignal?.let { filter ->
            item { Notice("Mostrando ONUs en línea con señal ${if (filter == "critical") "crítica (-30 dBm o menos)" else "débil (entre -27 y -30 dBm)"}, de peor a mejor, calculadas con las ${mapOnus.size} ONUs de la última lectura.") }
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Ver como", style = MaterialTheme.typography.labelMedium)
                ONU_VIEWS.forEach { (key, label) -> FilterChip(selected = inv.view == key, onClick = { inv.view = key }, label = { Text(label) }) }
            }
        }
        if (inv.localSignal == null) item { ReadStatus(state) { ctx.vm.load(path, true) } }
        if (inv.view != "list" && inv.localSignal == null && pagesCount > 1) item {
            Text("Se muestran las ${rows.size} ONUs de esta página ($pageNumber de $pagesCount). Use los filtros o la búsqueda para ver otras.", style = MaterialTheme.typography.bodySmall)
        }
        if (rows.isEmpty() && (inv.localSignal != null || !state.loading)) item { EmptyState(emptyText) }
        when (inv.view) {
            "cards" -> items(rows, key = { "c" + it.optInt("id") }) { OnuCardView(ctx, it, onInspect) }
            "grid" -> items(rows.chunked(2), key = { "g" + it.first().optInt("id") }) { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { onu ->
                        val health = onuHealth(onu)
                        Column(Modifier.weight(1f).heightIn(min = 56.dp).background(health.color().copy(alpha = 0.10f), MaterialTheme.shapes.medium).clickable { onInspect(onu) }.padding(10.dp)) {
                            Text(oltOnuName(onu), fontWeight = FontWeight.Bold, color = health.color(), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                            OltMono("PON ${onu.optInt("pon")}" + (onu.oltNum("rxPowerDbm")?.let { " · ${oltDbm(it)}" } ?: ""))
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
            "pon", "signal" -> {
                val groups = if (inv.view == "signal") signalGroups(rows) else ponGroups(rows)
                items(groups, key = { "grp-" + it.key }) { group ->
                    OltCard(accent = group.color) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) { Text(group.title, fontWeight = FontWeight.Bold); Text(group.subtitle, style = MaterialTheme.typography.bodySmall) }
                            Text(group.onus.size.toString(), fontWeight = FontWeight.Bold)
                        }
                        group.onus.forEach { onu -> OnuRow(onu) { onInspect(onu) } }
                    }
                }
            }
            else -> items(rows, key = { "l" + it.optInt("id") }) { onu ->
                OltCard(onClick = { onInspect(onu) }) { OnuListContent(ctx, onu) }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("${if (inv.localSignal != null) rows.size else body?.optInt("total") ?: 0} ONUs encontradas", Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                if (inv.localSignal == null) {
                    IconButton(onClick = { inv.page = pageNumber - 1 }, enabled = pageNumber > 1, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ChevronLeft, "Página anterior") }
                    Text("$pageNumber / $pagesCount", fontWeight = FontWeight.Bold)
                    IconButton(onClick = { inv.page = pageNumber + 1 }, enabled = pageNumber < pagesCount, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ChevronRight, "Página siguiente") }
                }
            }
        }
    }

    association?.let { preview -> OltAssociationDialog(ctx, preview, onPreview = { association = it }, close = { association = null }) }
}

@Composable
private fun OnuListContent(ctx: OltCtx, onu: JSONObject) {
    val health = onuHealth(onu)
    val rx = onu.oltNum("rxPowerDbm")
    val client = onu.optJSONObject("client")
    val clientId = onu.oltInt("clientIdServicio")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        OltDot(health.color(), 12)
        Column(Modifier.weight(1f)) {
            Text(if (clientId != null) client?.oltStr("nombre") ?: onu.oltStr("name") ?: "Cliente #$clientId" else onu.oltStr("name") ?: "Sin asociar",
                fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(if (clientId == null) "Sin cliente asociado" else listOfNotNull(client?.oltStr("usuario"), client?.oltStr("ip") ?: "Sin IP").joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        OltPill(oltOnuStatusLabel(onu), health.color())
    }
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OltMono(onu.text("onuIndex", ""), weight = FontWeight.Bold)
        Text(onu.oltStr("model") ?: "--", style = MaterialTheme.typography.bodySmall)
        OltMono(onu.oltStr("serial") ?: "--", Modifier.weight(1f))
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(oltSignalLabel(rx) + (rx?.let { " · ${oltDbm(it)}" } ?: ""), color = oltSignalColor(rx), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        Text(oltDate(onu.oltStr("lastDetailAt") ?: onu.oltStr("lastSeenAt")), style = MaterialTheme.typography.labelSmall)
    }
    if (clientId != null) TextButton(onClick = { ctx.onClient(clientId) }, contentPadding = PaddingValues(0.dp)) { Text("Expediente del cliente") }
}

@Composable
private fun OnuCardView(ctx: OltCtx, onu: JSONObject, onInspect: (JSONObject) -> Unit) {
    val health = onuHealth(onu)
    val rx = onu.oltNum("rxPowerDbm")
    val clientId = onu.oltInt("clientIdServicio")
    OltCard(accent = health.color()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (clientId != null) oltOnuName(onu) else onu.oltStr("name") ?: "Sin asociar", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("PON ${onu.optInt("pon")} · ${onu.text("onuIndex", "")}", style = MaterialTheme.typography.bodySmall)
            }
            Text(oltOnuStatusLabel(onu), style = MaterialTheme.typography.labelSmall, color = health.color())
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val percent = rx?.let { max(4.0, min(100.0, ((it + 30) / 12) * 100)) } ?: 0.0
            LinearProgressIndicator(progress = { (percent / 100).toFloat() }, modifier = Modifier.weight(1f), color = oltSignalColor(rx))
            OltMono(if (rx != null) oltDbm(rx) else "Sin lectura", weight = FontWeight.Bold)
        }
        Row { OltField("Modelo", onu.oltStr("model") ?: "—", Modifier.weight(1f)); OltField("Serial", onu.oltStr("serial") ?: "—", Modifier.weight(1f), mono = true) }
        Row {
            onu.optJSONObject("client")?.oltStr("ip")?.let { OltField("IP", it, Modifier.weight(1f), mono = true) }
            OltField("Última lectura", oltAgo(onu.oltStr("lastDetailAt") ?: onu.oltStr("lastSeenAt")), Modifier.weight(1f))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (clientId != null) TextButton(onClick = { ctx.onClient(clientId) }) { Icon(Icons.Outlined.Person, null); Spacer(Modifier.width(4.dp)); Text("Expediente") }
            else Text("Sin cliente asociado", color = IspAmber, style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.weight(1f))
            OutlinedButton(onClick = { onInspect(onu) }, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.Visibility, null); Spacer(Modifier.width(4.dp)); Text("Abrir") }
        }
    }
}

@Composable
internal fun OnuRow(onu: JSONObject, onClick: () -> Unit) {
    val health = onuHealth(onu)
    val rx = onu.oltNum("rxPowerDbm")
    Row(Modifier.fillMaxWidth().heightIn(min = 44.dp).clickable(onClick = onClick), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OltDot(health.color(), 8)
        Text(oltOnuName(onu), Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
        OltMono(onu.text("onuIndex", ""))
        OltMono(if (rx != null) oltDbm(rx) else "—", color = oltSignalColor(rx), weight = FontWeight.Bold)
    }
}

private class OnuGroupView(val key: String, val title: String, val subtitle: String, val color: androidx.compose.ui.graphics.Color, val onus: List<JSONObject>)

private fun ponGroups(rows: List<JSONObject>): List<OnuGroupView> = rows.groupBy { it.optInt("pon") }.toSortedMap().map { (pon, onus) ->
    val offline = onus.count { !it.optBoolean("online") }
    val bad = onus.count { it.optBoolean("online") && oltIsWeak(it.oltNum("rxPowerDbm")) }
    OnuGroupView("pon-$pon", "PON $pon", "${onus.size - offline} en línea" + (if (offline > 0) " · $offline sin conexión" else "") + (if (bad > 0) " · $bad con señal baja" else ""),
        if (offline > 0) IspRed else if (bad > 0) IspAmber else IspGreen,
        onus.sortedWith(compareBy<JSONObject> { if (it.optBoolean("online")) 1 else 0 }.thenBy { it.oltNum("rxPowerDbm") ?: 0.0 }))
}

private fun signalGroups(rows: List<JSONObject>): List<OnuGroupView> {
    val definitions = listOf(
        listOf("offline", "Sin conexión", "No responden a la OLT") to { o: JSONObject -> !o.optBoolean("online") },
        listOf("critical", "Señal crítica", "-30 dBm o peor: atender primero") to { o: JSONObject -> o.optBoolean("online") && oltIsCritical(o.oltNum("rxPowerDbm")) },
        listOf("weak", "Señal débil", "Entre -27 y -30 dBm") to { o: JSONObject -> o.optBoolean("online") && oltIsWeak(o.oltNum("rxPowerDbm")) && !oltIsCritical(o.oltNum("rxPowerDbm")) },
        listOf("good", "Señal buena", "Mejor que -27 dBm") to { o: JSONObject -> o.optBoolean("online") && o.oltNum("rxPowerDbm") != null && !oltIsWeak(o.oltNum("rxPowerDbm")) },
        listOf("unknown", "Sin lectura", "En línea pero sin medición óptica") to { o: JSONObject -> o.optBoolean("online") && o.oltNum("rxPowerDbm") == null },
    )
    val colors = mapOf("offline" to OltGray, "critical" to IspRed, "weak" to IspAmber, "good" to IspGreen, "unknown" to OltGray)
    return definitions.map { (meta, test) ->
        OnuGroupView(meta[0], meta[1], meta[2], colors[meta[0]]!!, rows.filter(test).sortedBy { it.oltNum("rxPowerDbm") ?: 99.0 })
    }.filter { it.onus.isNotEmpty() }
}

/** Asociacion masiva de ONUs con clientes verificados (vista previa + aplicar). */
@Composable
private fun OltAssociationDialog(ctx: OltCtx, preview: JSONObject, onPreview: (JSONObject) -> Unit, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    val summary = preview.optJSONObject("summary") ?: JSONObject()
    val matches = preview.optJSONArray("matches").objects()
    val conflicts = preview.optJSONArray("conflicts").objects()
    OltFullDialog(title = "Asociar clientes a las ONUs", eyebrow = "Diagnóstico óptico", closeEnabled = !saving, onClose = close, footer = {
        OutlinedButton(onClick = close, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        Button(onClick = {
            if (saving || matches.isEmpty()) return@Button
            saving = true
            scope.launch {
                try {
                    val result = ctx.write("POST", "/olt-api/reconciliation/associations/apply", JSONObject().put("confirmation", preview.optString("requiredConfirmation")))
                    if (result.optBoolean("ok")) { ctx.notify("${result.optInt("applied")} ONU asociadas con clientes verificados"); close() }
                    else { result.optJSONObject("preview")?.let(onPreview); ctx.notify("El servidor no confirmó las asociaciones") }
                } catch (error: Exception) {
                    ctx.notify(error.message ?: "No se pudieron guardar las asociaciones")
                    runCatching { onPreview(ctx.read("/olt-api/reconciliation/associations/preview")) }
                } finally { saving = false }
            }
        }, enabled = matches.isNotEmpty() && !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (saving) "Asociando..." else "Asociar ${matches.size} ONUs") }
    }) {
        Text("Vincula cada ONU con su cliente para mostrarlo dentro del diagnóstico óptico. Las asociaciones actuales no se modifican.", style = MaterialTheme.typography.bodySmall)
        Row {
            OltField("Ya asociadas", summary.optInt("alreadyLinked").toString(), Modifier.weight(1f))
            OltField("Listas para asociar", summary.optInt("safeMatches").toString(), Modifier.weight(1f), IspGreen)
        }
        Row {
            OltField("Con conflicto", summary.optInt("conflicts").toString(), Modifier.weight(1f), IspAmber)
            OltField("Sin coincidencia", summary.optInt("unmatched").toString(), Modifier.weight(1f))
        }
        if (matches.isNotEmpty()) {
            OltSectionTitle("Coincidencias verificadas", "${summary.optInt("exactSerial")} por serial · ${summary.optInt("exactName")} por nombre o usuario")
            matches.forEach { match ->
                val client = match.optJSONObject("client") ?: JSONObject()
                OltCard {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { OltMono(match.text("onuIndex", ""), weight = FontWeight.Bold); Text(match.oltStr("onuName") ?: match.oltStr("serial") ?: "ONU sin nombre", style = MaterialTheme.typography.bodySmall) }
                        OltPill(if (match.oltStr("method") == "serial") "Serial" else "Identidad", IspBlue)
                    }
                    Text("→ ${client.text("nombre", "")}", fontWeight = FontWeight.SemiBold)
                    Text(client.oltStr("usuario") ?: client.oltStr("ip") ?: "Cliente #${client.optInt("idServicio")}", style = MaterialTheme.typography.bodySmall)
                }
            }
        } else Notice("No hay asociaciones seguras pendientes. Las ONUs restantes necesitan un serial o una selección manual desde su diagnóstico óptico.")
        if (conflicts.isNotEmpty()) {
            OltSectionTitle("Requieren revisión manual (${conflicts.size})", "No se modificarán en esta operación.")
            conflicts.take(12).forEach { conflict ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OltMono(conflict.text("onuIndex", ""))
                    Column(Modifier.weight(1f)) {
                        Text(conflict.oltStr("onuName") ?: conflict.oltStr("serial") ?: "ONU sin nombre", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
                        Text(oltConflictLabel(conflict.oltStr("reason")), style = MaterialTheme.typography.labelSmall, color = IspAmber)
                    }
                }
            }
        }
    }
}
