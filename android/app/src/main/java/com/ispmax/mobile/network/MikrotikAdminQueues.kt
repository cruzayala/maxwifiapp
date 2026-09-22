package com.ispmax.mobile

import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

private val SYNC_FILTERS = listOf("all" to "Todos", "differences" to "Con diferencias", "online" to "En línea", "offline" to "Sin conexión", "disabled" to "Deshabilitados (sin límite)") +
    MT_ISSUE_ORDER.filter { it != "paused" }.map { it to MT_ISSUE_INFO.getValue(it).title }
private val CLIENT_SORTS = listOf("default" to "Como en el router", "traffic" to "Mayor consumo ahora", "total" to "Mayor consumo acumulado", "usage" to "% del plan en uso", "ip" to "Por IP", "name" to "Por nombre")
private val ROW_ISSUE_KINDS = listOf("dup-ip", "dup-mac", "paused", "no-limit", "saturated")
private val CORE_REFRESH = listOf("/mikrotik/status", "/mikrotik/system", "/mikrotik/wan-traffic", "/mikrotik/clients-live")

private fun numberInput(value: String) = value.replace(',', '.').filter { it.isDigit() || it == '.' }.take(8)
private fun mbpsText(value: Double) = mtCompact(value)

internal fun mtOpenClientQueue(ui: MtUiState, row: JSONObject) {
    val ip = row.mtStr("ip") ?: return
    val client = row.optJSONObject("client")
    val up = mtBpsToMbps(row.mtNum("maxUploadBps")).takeIf { it > 0 } ?: 1.0
    val down = mtBpsToMbps(row.mtNum("maxDownloadBps")).takeIf { it > 0 } ?: 1.0
    ui.queueEditor = MtQueueDraft(
        row.mtStr("queueId"), ip, row.mtStr("queueName") ?: client.mtStr("name") ?: "Cliente - $ip",
        mbpsText(up), mbpsText(down), row.mtBool("isDisabled"),
        if (client != null) "Cliente WispHub #${client.optInt("id")}" else "IP sin cliente en WispHub ERP",
    )
}

internal fun mtOpenUnknownQueue(ui: MtUiState, device: JSONObject) {
    val ip = device.mtStr("ip") ?: return
    val (up, down) = mtLimitValues(device.mtStr("maxLimit"))
    ui.queueEditor = MtQueueDraft(
        device.mtStr("queueId"), ip, device.mtStr("queueName") ?: "DESCONOCIDO - $ip",
        mbpsText(if (up > 0) up else 1.0), mbpsText(if (down > 0) down else 1.0), device.mtBool("disabled"),
        "IP sin cliente en WispHub ERP - limitado desde ISP max",
    )
}

// --- Clientes y colas ---
@Composable
internal fun MtClientsTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, clients: List<JSONObject>, canManage: Boolean) {
    val stats = pages[MT_LIVE]?.body?.optJSONObject("stats")
    val issues = remember(clients) { mtDetectIssues(clients) }
    val issueSets = remember(issues) { issues.mapValues { (_, rows) -> rows.toHashSet() } }
    val query = ui.clientQuery.trim().lowercase()
    val filter = ui.syncFilter
    val sort = ui.clientSort
    val filtered = remember(clients, issueSets, query, filter, sort) {
        val macQuery = mtNormalizeMac(query)
        val rows = clients.filter { row ->
            val client = row.optJSONObject("client")
            val matchesQuery = query.isEmpty() || listOf(client.mtStr("name"), client.mtStr("username"), row.mtStr("ip"), row.mtStr("queueName"), client.mtStr("zone"), row.mtStr("macAddress"))
                .any { it.orEmpty().lowercase().contains(query) } ||
                (macQuery.length >= 4 && !Regex("^[\\d.]+$").matches(query) && mtNormalizeMac(row.mtStr("macAddress")).contains(macQuery))
            val matchesFilter = when (filter) {
                "all" -> true
                "differences" -> row.mtStr("syncState") != "synced"
                "online" -> row.mtBool("isOnline")
                "offline" -> !row.mtBool("isOnline")
                "disabled" -> row.mtBool("isDisabled")
                else -> issueSets[filter]?.contains(row) == true
            }
            matchesQuery && matchesFilter
        }
        fun name(row: JSONObject) = row.optJSONObject("client").mtStr("name") ?: row.mtStr("queueName").orEmpty()
        when (sort) {
            "traffic" -> rows.sortedByDescending { it.mtNum("uploadBps") + it.mtNum("downloadBps") }
            "total" -> rows.sortedByDescending { it.mtNum("totalBytes") }
            "usage" -> rows.sortedByDescending { mtUsage(it) }
            "ip" -> rows.sortedWith { a, b -> mtCompareIp(a.mtStr("ip"), b.mtStr("ip")) }
            "name" -> rows.sortedWith(compareBy(java.text.Collator.getInstance(java.util.Locale("es"))) { name(it) })
            else -> rows
        }
    }
    val pageCount = mtPageCount(filtered.size)
    val page = minOf(ui.clientPage, pageCount)
    val paged = mtPaged(filtered, page)
    val chips = MT_ISSUE_ORDER.filter { issues[it].orEmpty().isNotEmpty() }
    fun rowIssues(row: JSONObject) = ROW_ISSUE_KINDS.filter { issueSets[it]?.contains(row) == true }.map { MT_ISSUE_INFO.getValue(it).short }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Clientes y colas", "${stats?.optInt("mikrotikQueues") ?: 0} colas · ${stats?.optInt("differences") ?: 0} diferencias operativas") {
                ExportButton(filtered, "mikrotik-colas") { filtered.map { mtClientCsv(it, rowIssues(it)) } }
            }
        }
        mtReadStatus(pages[MT_LIVE]) { vm.load(MT_LIVE, true) }
        item { MtSearchField(ui.clientQuery, "Cliente, usuario, IP o MAC") { ui.clientQuery = it; ui.clientPage = 1 } }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                MtSelect("Filtrar", SYNC_FILTERS, filter, Modifier.weight(1f)) { ui.setClientFilter(it) }
                MtSelect("Orden", CLIENT_SORTS, sort, Modifier.weight(1f)) { ui.clientSort = it; ui.clientPage = 1 }
            }
        }
        if (chips.isNotEmpty()) item {
            MtChipRail {
                MtFilterChip("Todos", clients.size, filter == "all") { ui.setClientFilter("all") }
                chips.forEach { kind ->
                    val chipFilter = if (kind == "paused") "disabled" else kind
                    val info = MT_ISSUE_INFO.getValue(kind)
                    MtFilterChip(info.short, issues.getValue(kind).size, filter == chipFilter, mtIssueColor(info.level)) { ui.setClientFilter(if (filter == chipFilter) "all" else chipFilter) }
                }
            }
        }
        if (canManage) item { MtSpeedControlBar(vm, pages, ui, actions, paged) }
        if (paged.isEmpty()) item { EmptyState("No hay resultados para estos filtros") }
        items(paged) { row -> MtClientRow(ui, actions, row, canManage, rowIssues(row)) }
        item { MtPager(filtered.size, page, pageCount) { ui.clientPage = (page + it).coerceIn(1, pageCount) } }
    }
}

private fun mtClientCsv(row: JSONObject, alerts: List<String>): JSONObject {
    val client = row.optJSONObject("client")
    return mtCsvRow(
        "Cliente" to (client.mtStr("name") ?: row.mtStr("queueName")), "Usuario" to client.mtStr("username"),
        "ID cliente" to client?.optInt("id")?.takeIf { it > 0 }, "Zona" to client.mtStr("zone"), "IP" to row.mtStr("ip"),
        "MAC" to row.mtStr("macAddress"), "Cola" to row.mtStr("queueName"), "Sincronización" to mtSyncLabel(row.mtStr("syncState")),
        "Límite subida (Mbps)" to mtMbps2(row.mtNum("maxUploadBps")), "Límite descarga (Mbps)" to mtMbps2(row.mtNum("maxDownloadBps")),
        "Subida actual (Mbps)" to mtMbps2(row.mtNum("uploadBps")), "Descarga actual (Mbps)" to mtMbps2(row.mtNum("downloadBps")),
        "Consumo acumulado (GB)" to mtMbps2(row.mtNum("totalBytes") / 1000), "Estado" to mtClientStateLabel(row), "Alertas" to alerts.joinToString(" / "),
    )
}

@Composable
private fun MtClientRow(ui: MtUiState, actions: MtActions, row: JSONObject, canManage: Boolean, rowIssues: List<String>) {
    val client = row.optJSONObject("client")
    val queueId = row.mtStr("queueId")
    val online = row.mtBool("isOnline")
    val disabled = row.mtBool("isDisabled")
    val name = client.mtStr("name") ?: row.mtStr("queueName") ?: "-"
    val synced = row.mtStr("syncState") == "synced"
    OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = if (!synced) Color(0xFFFFFBF3) else MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (canManage) {
                    Checkbox(checked = queueId != null && queueId in ui.selectedQueueIds, enabled = queueId != null,
                        onCheckedChange = { checked -> if (queueId != null) { if (checked) { if (queueId !in ui.selectedQueueIds) ui.selectedQueueIds += queueId } else ui.selectedQueueIds.remove(queueId) } })
                }
                Box(Modifier.size(34.dp).background((if (online) IspGreen else Color(0xFF8A95A6)).copy(alpha = .14f), CircleShape), contentAlignment = Alignment.Center) {
                    Text(name.take(1).uppercase(), fontWeight = FontWeight.Bold, color = if (online) IspGreen else Color(0xFF52646B))
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(name, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(client.mtStr("username") ?: "Sin cliente asociado", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                MtBadge(mtClientStateLabel(row), if (disabled) IspAmber else if (online) IspGreen else IspRed)
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                val ip = row.mtStr("ip")
                if (ip != null) MtIpChip(ip, actions) else Text("Sin IP", color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                Spacer(Modifier.width(8.dp))
                Text(row.mtStr("macAddress") ?: "—", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                MtBadge(mtSyncLabel(row.mtStr("syncState")), if (synced) IspGreen else IspAmber)
                rowIssues.forEach { MtBadge(it, IspRed) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                MtDatum("Límite subida / bajada", "${mtCompact(mtBpsToMbps(row.mtNum("maxUploadBps")))} / ${mtCompact(mtBpsToMbps(row.mtNum("maxDownloadBps")))} Mbps", Modifier.weight(1f))
                MtDatum("Tráfico actual", "${mtFormatBps(row.mtNum("downloadBps"))} · ↑ ${mtFormatBps(row.mtNum("uploadBps"))}", Modifier.weight(1f), IspBlue)
            }
            if (canManage && row.mtStr("ip") != null) {
                OutlinedButton(onClick = { mtOpenClientQueue(ui, row) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text("Editar velocidad (cola)")
                }
            }
        }
    }
}

@Composable
private fun MtSpeedControlBar(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, visible: List<JSONObject>) {
    val templates = pages[MT_TEMPLATES]?.body?.optJSONArray("items").objects()
    LaunchedEffect(templates) { if (ui.selectedTemplateId.isEmpty() && templates.isNotEmpty()) ui.selectedTemplateId = templates.first().optString("id") }
    var showNew by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var upload by remember { mutableStateOf("10") }
    var download by remember { mutableStateOf("10") }
    val selected = ui.selectedQueueIds.size
    val visibleIds = visible.mapNotNull { it.mtStr("queueId") }
    MtCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$selected", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = IspGreen)
            Spacer(Modifier.width(8.dp))
            Text("colas seleccionadas", Modifier.weight(1f))
            val allVisible = visibleIds.isNotEmpty() && visibleIds.all { it in ui.selectedQueueIds }
            TextButton(onClick = {
                if (allVisible) ui.selectedQueueIds.removeAll(visibleIds.toSet()) else visibleIds.forEach { if (it !in ui.selectedQueueIds) ui.selectedQueueIds += it }
            }, enabled = visibleIds.isNotEmpty(), modifier = Modifier.heightIn(min = 48.dp)) { Text(if (allVisible) "Quitar visibles" else "Marcar visibles") }
        }
        pages[MT_TEMPLATES]?.error?.let { Notice(it.ifBlank { "No se pudieron cargar las plantillas" }, true) }
        MtSelect("Plantilla de velocidad",
            if (templates.isEmpty()) listOf("" to "Sin plantillas guardadas") else templates.map { it.optString("id") to "${it.optString("name")} (${mtCompact(it.mtNum("uploadMbps"))} / ${mtCompact(it.mtNum("downloadMbps"))} Mbps)" },
            ui.selectedTemplateId) { ui.selectedTemplateId = it }
        Button(onClick = {
            val template = templates.firstOrNull { it.optString("id") == ui.selectedTemplateId }
            val queueIds = ui.selectedQueueIds.toList()
            if (template == null || queueIds.isEmpty()) { actions.toast("Selecciona una plantilla y al menos una cola"); return@Button }
            actions.confirm("Aplicar plantilla", "¿Aplicar la plantilla ${template.optString("name")} a ${queueIds.size} colas? Cambiará la velocidad de esos clientes. Antes se creará un respaldo automático.", "Aplicar") {
                actions.run("POST", "/mikrotik/speed-templates/apply",
                    JSONObject().put("templateId", template.optString("id")).put("queueIds", JSONArray(queueIds)).put("confirmation", "APLICAR"),
                    CORE_REFRESH, "Plantilla aplicada a ${queueIds.size} colas", "No se pudo aplicar la plantilla") { ui.selectedQueueIds.clear() }
            }
        }, enabled = selected > 0 && !ui.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Icon(Icons.Outlined.Tune, null); Spacer(Modifier.width(8.dp)); Text(if (selected > 0) "Aplicar a las colas marcadas" else "Marque al menos una cola")
        }
        TextButton(onClick = { showNew = !showNew }, modifier = Modifier.heightIn(min = 48.dp)) {
            Icon(if (showNew) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null); Spacer(Modifier.width(6.dp)); Text("Nueva plantilla y plantillas guardadas")
        }
        if (showNew) {
            OutlinedTextField(name, { name = it.take(50) }, label = { Text("Nombre de la plantilla") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(upload, { upload = numberInput(it) }, label = { Text("Subida Mbps") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                OutlinedTextField(download, { download = numberInput(it) }, label = { Text("Descarga Mbps") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            }
            OutlinedButton(onClick = {
                if (name.isBlank() || ui.saving) return@OutlinedButton
                // Igual que la web: Number() del campo; el servidor valida 0.1 a 10000 Mbps.
                val body = JSONObject().put("name", name.trim()).put("uploadMbps", upload.toDoubleOrNull() ?: 0.0).put("downloadMbps", download.toDoubleOrNull() ?: 0.0)
                actions.run("POST", "/mikrotik/speed-templates", body, listOf("/mikrotik/speed-templates"), "Plantilla guardada", "No se pudo guardar la plantilla") { name = "" }
            }, enabled = name.isNotBlank() && !ui.saving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (name.isNotBlank()) "Guardar plantilla" else "Escriba un nombre para la plantilla")
            }
            templates.forEach { template ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(template.optString("name"), fontWeight = FontWeight.SemiBold)
                        Text("${mtCompact(template.mtNum("uploadMbps"))} / ${mtCompact(template.mtNum("downloadMbps"))} Mbps", style = MaterialTheme.typography.labelSmall)
                    }
                    IconButton(onClick = {
                        actions.confirm("Eliminar plantilla", "¿Eliminar la plantilla ${template.optString("name")}?", "Eliminar", danger = true) {
                            actions.run("DELETE", "/mikrotik/speed-templates/${Uri.encode(template.optString("id"))}", JSONObject().put("confirmation", "ELIMINAR"),
                                listOf("/mikrotik/speed-templates"), "Plantilla eliminada", "No se pudo eliminar la plantilla", guarded = false) {
                                if (ui.selectedTemplateId == template.optString("id")) ui.selectedTemplateId = ""
                            }
                        }
                    }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Delete, "Eliminar plantilla", tint = IspRed) }
                }
            }
        }
    }
}

// --- Desconocidos ---
private val UNKNOWN_FILTERS = listOf("all" to "Todos", "high" to "Riesgo alto", "unmanaged" to "Sin control", "infrastructure" to "Posible infraestructura")

@Composable
internal fun MtUnknownTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, canManage: Boolean, now: Long) {
    val state = pages[MT_UNKNOWN]
    val body = state?.body
    val devices = remember(body) { body?.optJSONArray("devices").objects() }
    val stats = body?.optJSONObject("stats")
    val query = ui.unknownQuery.trim().lowercase()
    val filter = ui.unknownFilter
    val filtered = remember(devices, query, filter) {
        devices.filter { device ->
            val matchesQuery = query.isEmpty() || listOf("ip", "macAddress", "identity", "platform", "queueName").any { device.mtStr(it).orEmpty().lowercase().contains(query) }
            val matchesFilter = when (filter) {
                "high" -> device.mtStr("risk") == "high"
                "unmanaged" -> device.mtStr("classification") == "unmanaged_device"
                "infrastructure" -> device.mtStr("classification") == "infrastructure_candidate"
                else -> true
            }
            matchesQuery && matchesFilter
        }
    }
    val pageCount = mtPageCount(filtered.size)
    val page = minOf(ui.unknownPage, pageCount)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            MtSectionTitle("Dispositivos desconocidos", "Equipos con tráfico en el router que no coinciden con ningún cliente de WispHub${mtParseTime(body.mtStr("timestamp"))?.let { " · análisis ${mtRelative(it, now)}" } ?: ""}") {
                ExportButton(filtered, "mikrotik-desconocidos") { filtered.map { mtUnknownCsv(it) } }
                IconButton(onClick = { vm.load(MT_UNKNOWN, true) }, enabled = state?.loading != true, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Actualizar análisis") }
            }
        }
        mtReadStatus(state) { vm.load(MT_UNKNOWN, true) }
        item { MtSearchField(ui.unknownQuery, "IP, MAC o identidad") { ui.unknownQuery = it; ui.unknownPage = 1 } }
        item {
            MtChipRail {
                val counts = mapOf("all" to stats?.optInt("total"), "high" to stats?.optInt("highRisk"), "unmanaged" to stats?.optInt("unmanaged"), "infrastructure" to stats?.optInt("infrastructureCandidates"))
                UNKNOWN_FILTERS.forEach { (key, label) -> MtFilterChip(label, counts[key] ?: 0, filter == key) { ui.unknownFilter = key; ui.unknownPage = 1 } }
            }
        }
        val paged = mtPaged(filtered, page)
        if (paged.isEmpty() && state?.loading != true) item { EmptyState("No hay dispositivos en esta categoría") }
        items(paged) { device -> MtUnknownRow(ui, actions, device, canManage) }
        item { MtPager(filtered.size, page, pageCount) { ui.unknownPage = (page + it).coerceIn(1, pageCount) } }
    }
}

private fun mtUnknownCsv(device: JSONObject) = mtCsvRow(
    "IP" to device.mtStr("ip"), "MAC" to device.mtStr("macAddress"), "Identidad" to device.mtStr("identity"), "Plataforma" to device.mtStr("platform"),
    "Puerto físico" to (device.mtStr("bridgePort") ?: device.mtStr("interface")), "Conexiones" to device.optInt("connectionCount"),
    "Descarga (Mbps)" to mtMbps2(device.mtNum("downloadBps")), "Subida (Mbps)" to mtMbps2(device.mtNum("uploadBps")), "Cola" to device.mtStr("queueName"),
    "Límite" to (if (device.mtStr("queueId") != null) mtFormatLimit(device.mtStr("maxLimit")) else "Sin cola"),
    "Clasificación" to mtClassificationLabel(device.mtStr("classification")), "Riesgo" to mtSeverityLabel(device.mtStr("risk")),
)

@Composable
private fun MtUnknownRow(ui: MtUiState, actions: MtActions, device: JSONObject, canManage: Boolean) {
    val risk = device.mtStr("risk")
    val riskColor = when (risk) { "high" -> IspRed; "medium" -> IspAmber; else -> IspBlue }
    val hasQueue = device.mtStr("queueId") != null
    OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = if (risk == "high") Color(0xFFFFF5F4) else MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                device.mtStr("ip")?.let { MtIpChip(it, actions) }
                Spacer(Modifier.weight(1f))
                MtBadge("Riesgo ${when (risk) { "high" -> "Alto"; "medium" -> "Medio"; else -> "Bajo" }}", riskColor)
            }
            Text(device.mtStr("identity") ?: device.mtStr("platform") ?: "Sin nombre detectado", fontWeight = FontWeight.SemiBold)
            Row {
                MtDatum("MAC", device.mtStr("macAddress") ?: "-", Modifier.weight(1f))
                MtDatum("Puerto físico", device.mtStr("bridgePort") ?: device.mtStr("interface") ?: "-", Modifier.weight(1f))
            }
            Text(device.mtStr("platform") ?: "Equipo no identificado", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row {
                MtDatum("Actividad", "${device.optInt("connectionCount")} conexiones", Modifier.weight(1f))
                MtDatum("Tráfico", "${mtFormatBps(device.mtNum("downloadBps"))} ↓ · ${mtFormatBps(device.mtNum("uploadBps"))} ↑", Modifier.weight(1f), IspBlue)
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                MtBadge(if (hasQueue) mtFormatLimit(device.mtStr("maxLimit")) else "Sin cola", if (hasQueue) IspGreen else IspAmber)
                Text(mtClassificationLabel(device.mtStr("classification")), style = MaterialTheme.typography.labelSmall)
            }
            if (canManage) {
                OutlinedButton(onClick = { mtOpenUnknownQueue(ui, device) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text(if (hasQueue) "Editar" else "Limitar")
                }
            }
        }
    }
}

// --- Editor de cola (mismo formulario y validacion que la web) ---
@Composable
internal fun MtQueueEditorDialog(vm: MainViewModel, draft: MtQueueDraft, actions: MtActions, onClose: () -> Unit) {
    var name by remember(draft) { mutableStateOf(draft.name) }
    var upload by remember(draft) { mutableStateOf(draft.upload) }
    var download by remember(draft) { mutableStateOf(draft.download) }
    var disabled by remember(draft) { mutableStateOf(draft.disabled) }
    var comment by remember(draft) { mutableStateOf(draft.comment) }
    var saving by remember(draft) { mutableStateOf(false) }
    var error by remember(draft) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!saving) onClose() }, dismissOnClickOutside = false) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 12.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Tune, null, tint = IspGreen)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (draft.id != null) "Editar velocidad del equipo" else "Limitar velocidad del equipo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                        Text(draft.ip, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    }
                    IconButton(onClick = onClose, enabled = !saving, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Close, "Cerrar") }
                }
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedTextField(name, { name = it.take(80) }, label = { Text("Nombre de la cola") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(upload, { upload = numberInput(it) }, label = { Text("Subida máxima") }, suffix = { Text("Mbps") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        OutlinedTextField(download, { download = numberInput(it) }, label = { Text("Descarga máxima") }, suffix = { Text("Mbps") }, singleLine = true, modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    }
                    OutlinedTextField(comment, { comment = it.take(200) }, label = { Text("Comentario operativo") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Pausar este límite", fontWeight = FontWeight.SemiBold)
                            Text("Conserva la configuración, pero el equipo navega sin límite de velocidad.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(disabled, { disabled = it })
                    }
                    Notice("Los cambios se aplican de inmediato en el router y afectan la velocidad del cliente.")
                    error?.let { Notice(it, true) }
                }
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedButton(onClick = onClose, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) { Text("Cancelar") }
                    Button(onClick = {
                        if (saving) return@Button
                        val up = upload.toDoubleOrNull(); val down = download.toDoubleOrNull()
                        if (name.isBlank() || up == null || down == null || up < 0.1 || down < 0.1) { error = "Completa un nombre y límites válidos"; return@Button }
                        error = null; saving = true
                        val body = JSONObject().put("name", name.trim()).put("uploadMbps", up).put("downloadMbps", down).put("disabled", disabled).put("comment", comment.trim())
                        scope.launch {
                            try {
                                val refresh = arrayOf("/mikrotik/clients-live", "/mikrotik/unknown-devices")
                                if (draft.id != null) vm.web("PATCH", "/mikrotik/queues/${Uri.encode(draft.id)}", body, *refresh)
                                else vm.web("POST", "/mikrotik/queues", body.put("targetIp", draft.ip), *refresh)
                                actions.toast(if (draft.id != null) "Cola actualizada" else "Cola creada")
                                onClose()
                            } catch (failure: CancellationException) {
                                throw failure
                            } catch (failure: Exception) {
                                error = failure.message?.takeIf { it.isNotBlank() } ?: "No se pudo guardar la cola"
                            } finally { saving = false }
                        }
                    }, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 52.dp)) {
                        if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White) else Icon(Icons.Outlined.Save, null)
                        Spacer(Modifier.width(8.dp)); Text(if (saving) "Guardando..." else "Guardar cambios")
                    }
                }
            }
        }
    }
}
