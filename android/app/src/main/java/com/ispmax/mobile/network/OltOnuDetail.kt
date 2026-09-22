package com.ispmax.mobile

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
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
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Espacio de trabajo de una ONU (equivale a onu-workbench de la web): lectura en vivo, diagnostico
 * de servicio, historial optico, asociacion de cliente y operaciones protegidas de la OLT.
 */
@Composable
internal fun OltOnuDetail(ctx: OltCtx, initial: JSONObject, startReboot: Boolean, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val route = oltOnuRoute(initial)
    var onu by remember(initial.optInt("id")) { mutableStateOf(initial) }
    var detailLoading by remember { mutableStateOf(false) }
    var history by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var diagnostic by remember { mutableStateOf<JSONObject?>(null) }
    var diagnosticLoading by remember { mutableStateOf(false) }
    var renameName by remember { mutableStateOf(oltSafeName(initial.oltStr("name") ?: initial.optJSONObject("client")?.oltStr("nombre") ?: "ONU")) }
    var operation by remember { mutableStateOf<JSONObject?>(null) }
    var operationSaving by remember { mutableStateOf(false) }
    var typed by remember { mutableStateOf("") }
    var clientQuery by remember { mutableStateOf("") }
    var clientResults by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var clientSearching by remember { mutableStateOf(false) }
    var mappingSaving by remember { mutableStateOf(false) }
    var confirmLink by remember { mutableStateOf<JSONObject?>(null) }
    var confirmUnlink by remember { mutableStateOf(false) }

    fun loadDiagnostic() {
        if (diagnosticLoading) return
        diagnosticLoading = true
        scope.launch {
            try { diagnostic = ctx.read("$route/service-diagnostics") }
            catch (error: Exception) { ctx.notify(error.message ?: "No se pudo verificar el servicio completo") }
            finally { diagnosticLoading = false }
        }
    }
    fun loadHistory() { scope.launch { runCatching { history = ctx.read("$route/optical-history?limit=30").optJSONArray("items").objects() } } }
    suspend fun readDetail(): JSONObject {
        val detail = ctx.read("$route/detail")
        if (detail.optJSONObject("client") == null && onu.optJSONObject("client") != null) detail.put("client", onu.optJSONObject("client"))
        onu = detail
        return detail
    }
    fun refreshOptical() {
        if (detailLoading) return
        detailLoading = true
        scope.launch {
            try {
                val detail = readDetail()
                ctx.notify("Lectura óptica actualizada: ${detail.oltNum("rxPowerDbm")?.let(::oltNumText) ?: "--"} dBm")
                ctx.vm.load(OltPaths.MAP, true)
                loadHistory()
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo actualizar la lectura óptica") } finally { detailLoading = false }
        }
    }
    fun prepare(action: String, fallback: String) {
        val name = if (action == "rename") oltSafeName(renameName).also { renameName = it } else null
        scope.launch {
            try {
                val query = "action=$action" + (name?.let { "&name=${oltEnc(it)}" } ?: "")
                operation = ctx.read("$route/operations/preview?$query"); typed = ""
            } catch (error: Exception) { ctx.notify(error.message ?: fallback) }
        }
    }

    LaunchedEffect(initial.optInt("id")) {
        if (startReboot) prepare("reboot", "No se pudo validar la operación")
        detailLoading = true
        try {
            val detail = readDetail()
            renameName = oltSafeName(detail.oltStr("name") ?: detail.optJSONObject("client")?.oltStr("nombre") ?: "ONU")
            detailLoading = false
            loadHistory()
            loadDiagnostic()
        } catch (error: Exception) {
            detailLoading = false
            ctx.notify(error.message ?: "No se pudo consultar la potencia óptica")
        }
    }
    LaunchedEffect(clientQuery) {
        if (clientQuery.trim().length < 2) { clientResults = emptyList(); return@LaunchedEffect }
        delay(250)
        clientSearching = true
        clientResults = try { ctx.read("/olt-api/clients/search?q=${oltEnc(clientQuery.trim())}").optJSONArray("items").objects() } catch (_: Exception) { emptyList() }
        clientSearching = false
    }

    fun assignClient(client: JSONObject?) {
        if (mappingSaving) return
        mappingSaving = true
        scope.launch {
            try {
                val result = ctx.write("PATCH", "$route/client", JSONObject().put("idServicio", client?.optInt("idServicio") ?: JSONObject.NULL))
                if (result.optBoolean("ok")) {
                    val updated = JSONObject(onu.toString())
                    updated.put("clientIdServicio", client?.optInt("idServicio") ?: JSONObject.NULL).put("client", result.optJSONObject("client") ?: client ?: JSONObject.NULL)
                        .put("mappingSource", if (client != null) "manual" else JSONObject.NULL)
                    onu = updated
                    clientQuery = ""; clientResults = emptyList()
                    ctx.notify(if (client != null) "ONU asociada a ${client.text("nombre", "")}" else "Asociación eliminada")
                } else ctx.notify("El servidor no confirmó la asociación")
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo guardar la asociación") } finally { mappingSaving = false }
        }
    }

    val client = onu.optJSONObject("client")
    val clientId = onu.oltInt("clientIdServicio")
    val health = onuHealth(onu)
    val rx = onu.oltNum("rxPowerDbm")
    val online = onu.optBoolean("online")
    val serial = onu.oltStr("serial")
    val traffic = onu.optJSONObject("traffic")

    OltFullDialog(title = client?.oltStr("nombre") ?: onu.oltStr("name") ?: "ONU sin asociar", eyebrow = oltOnuStatusLabel(onu),
        subtitle = "${onu.text("onuIndex", "")} · ${serial ?: "sin serial"}", onClose = close) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            clientId?.let { id -> OutlinedButton(onClick = { ctx.onClient(id) }, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.OpenInNew, null); Spacer(Modifier.width(6.dp)); Text("Expediente") } }
            OutlinedButton(onClick = ::refreshOptical, enabled = !detailLoading, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Actualizar") }
            OutlinedButton(onClick = ::loadDiagnostic, enabled = !diagnosticLoading, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.MonitorHeart, null); Spacer(Modifier.width(6.dp)); Text("Diagnóstico") }
            if (ctx.admin) OutlinedButton(onClick = { prepare("reboot", "No se pudo validar la operación") }, enabled = online, modifier = Modifier.heightIn(min = 44.dp)) {
                Icon(Icons.Outlined.PowerSettingsNew, null, tint = if (online) IspRed else OltGray); Spacer(Modifier.width(6.dp)); Text("Reiniciar")
            }
        }
        if (ctx.admin && serial != null) Button(onClick = { ctx.onTr069(serial) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Icon(Icons.Outlined.SettingsRemote, null); Spacer(Modifier.width(8.dp)); Text("Administrar por TR-069")
        }
        if (detailLoading) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Consultando la OLT...", style = MaterialTheme.typography.bodySmall) }

        OltCard(accent = health.color()) {
            Row {
                OltField("Señal óptica (RX)", oltDbm(rx), Modifier.weight(1f), oltSignalColor(rx))
                OltField("Potencia TX", onu.oltNum("txPowerDbm")?.let { "${oltNumText(it)} dBm" } ?: "--", Modifier.weight(1f))
            }
            Text("${oltSignalLabel(rx)} · normal de -8 a -27", style = MaterialTheme.typography.bodySmall, color = oltSignalColor(rx))
            Row {
                OltField("Distancia", onu.oltNum("distanceM")?.let { "${oltNumText(it)} m" } ?: "--", Modifier.weight(1f))
                OltField("Ubicación", "PON ${onu.optInt("pon")} · ONU ${onu.optInt("onuId")}", Modifier.weight(1f))
            }
            Row {
                OltField("Subida actual", oltTraffic(traffic?.oltNum("upstreamBps")), Modifier.weight(1f))
                OltField("Bajada actual", oltTraffic(traffic?.oltNum("downstreamBps")), Modifier.weight(1f))
            }
            Text("Pico subida ${oltTraffic(traffic?.oltNum("peakUpstreamBps"))} · pico bajada ${oltTraffic(traffic?.oltNum("peakDownstreamBps"))}", style = MaterialTheme.typography.bodySmall)
            OltField("Servicio", diagnostic?.let { "${it.optInt("score")}% · ${if (it.optBoolean("ready")) "Listo para entrega" else "Requiere atención"}" } ?: "-- · Pulse «Diagnóstico»")
        }

        // Diagnostico extremo a extremo
        OltCard {
            OltSectionTitle("Diagnóstico extremo a extremo", "OLT, WispHub y MikroTik en una sola prueba.") {
                IconButton(onClick = ::loadDiagnostic, enabled = !diagnosticLoading) { if (diagnosticLoading) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Refresh, "Repetir diagnóstico") }
            }
            val diag = diagnostic
            if (diag == null && diagnosticLoading) Text("Verificando servicio...", style = MaterialTheme.typography.bodySmall)
            if (diag != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("${diag.optInt("score")}%", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = if (diag.optBoolean("ready")) IspGreen else IspAmber)
                    Text(if (diag.optBoolean("ready")) "Servicio verificado" else "Requiere atención")
                }
                diag.optJSONArray("checks").objects().forEach { check ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(if (check.optBoolean("ok")) Icons.Outlined.CheckCircle else Icons.Outlined.WarningAmber, null, tint = if (check.optBoolean("ok")) IspGreen else IspAmber, modifier = Modifier.size(18.dp))
                        Column { Text(check.text("label", ""), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall); Text(check.text("detail", ""), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    }
                }
            }
        }
        diagnostic?.let { diag -> OltDownstream(ctx, diag) }

        // Datos OLT
        OltCard {
            OltSectionTitle("Datos OLT", "Inventario y asociación actual.")
            Row { OltField("Modelo", onu.oltStr("model") ?: "--", Modifier.weight(1f)); OltField("Cliente", client?.oltStr("nombre") ?: onu.oltStr("name") ?: "Sin nombre", Modifier.weight(1f)) }
            Row {
                OltField("IP", client?.oltStr("ip") ?: onu.optJSONObject("agentInventory")?.optJSONObject("summary")?.oltStr("wanIp") ?: "--", Modifier.weight(1f), mono = true)
                OltField("Tiempo en línea", onu.oltStr("onlineDuration") ?: "--", Modifier.weight(1f))
            }
            Row {
                OltField("Asociación", when (onu.oltStr("mappingSource")) { "manual" -> "Manual"; "serial" -> "Serial WispHub"; else -> if (onu.oltStr("name") != null) "Nombre registrado en OLT" else "--" }, Modifier.weight(1f))
                OltField("Última lectura", oltDate(onu.oltStr("lastDetailAt")), Modifier.weight(1f))
            }
        }

        if (ctx.admin) {
            OltCard {
                OltSectionTitle("Operaciones de OLT", "Acciones directas con vista previa.")
                OutlinedTextField(renameName, { renameName = it.take(32) }, singleLine = true, label = { Text("Nombre en la OLT") },
                    supportingText = { Text("Solo letras, números, punto, guion y guion bajo.") }, modifier = Modifier.fillMaxWidth())
                Button(onClick = { prepare("rename", "No se pudo validar el nuevo nombre") }, enabled = renameName.isNotBlank() && renameName != onu.oltStr("name"),
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (renameName == onu.oltStr("name")) "Es el mismo nombre actual" else "Cambiar") }
                OutlinedButton(onClick = { prepare("retire-stale", "No se pudo analizar el cambio de puerto") }, enabled = serial != null, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Revisar cambio de puerto") }
                OutlinedButton(onClick = { prepare("reboot", "No se pudo validar la operación") }, enabled = online, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (online) "Reiniciar ONU" else "Reiniciar ONU (sin conexión)") }
                OutlinedButton(onClick = { prepare("retire-full", "No se pudo preparar la eliminación completa") }, enabled = serial != null, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = IspRed)) { Icon(Icons.Outlined.Delete, null); Spacer(Modifier.width(6.dp)); Text("Eliminar de la OLT") }
                Text("Cada acción muestra primero su impacto y pide confirmación.", style = MaterialTheme.typography.bodySmall)
            }
            OltCard {
                OltSectionTitle("Asociación de cliente", client?.oltStr("nombre")?.let { "Asociada a $it" } ?: "Vincula esta ONU con su cliente de WispHub.") {
                    if (clientId != null) TextButton(onClick = { confirmUnlink = true }, enabled = !mappingSaving) { Text("Desvincular", color = IspRed) }
                }
                OutlinedTextField(clientQuery, { clientQuery = it }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                    label = { Text("Buscar por nombre, usuario, teléfono o ID") }, modifier = Modifier.fillMaxWidth())
                if (clientSearching) Text("Buscando clientes...", style = MaterialTheme.typography.bodySmall)
                else if (clientQuery.trim().length >= 2 && clientResults.isEmpty()) Text("No se encontraron clientes con esa búsqueda.", style = MaterialTheme.typography.bodySmall)
                clientResults.forEach { result ->
                    OutlinedCard(onClick = {
                        if (clientId != null && clientId != result.optInt("idServicio")) confirmLink = result else assignClient(result)
                    }, enabled = !mappingSaving, modifier = Modifier.fillMaxWidth()) {
                        ListItem(headlineContent = { Text(result.text("nombre", ""), fontWeight = FontWeight.SemiBold) },
                            supportingContent = { Text("${result.oltStr("usuario") ?: "Sin usuario"} · ${result.oltStr("telefono") ?: "Sin teléfono"}") },
                            trailingContent = { Text("#${result.optInt("idServicio")}", fontWeight = FontWeight.Bold) })
                    }
                }
            }
        }

        OltCard {
            OltSectionTitle("Historial óptico", "Tendencia de las últimas ${history.size} mediciones.")
            OltOpticalTrend(history)
        }
    }

    operation?.let { preview ->
        val action = preview.optString("action")
        val required = preview.oltStr("requiredConfirmation")
        OltFullDialog(title = oltOperationTitle(action), eyebrow = "Operación en la OLT",
            subtitle = "${onu.text("onuIndex", "")} · ${client?.oltStr("nombre") ?: onu.oltStr("name") ?: "ONU sin nombre"}",
            closeEnabled = !operationSaving, onClose = { operation = null }, footer = {
                OutlinedButton(onClick = { operation = null }, enabled = !operationSaving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
                Button(onClick = {
                    if (operationSaving || !preview.optBoolean("allowed")) return@Button
                    operationSaving = true
                    scope.launch {
                        try {
                            val body = JSONObject().put("action", action).put("confirmation", typed.trim())
                            preview.oltStr("newName")?.let { body.put("name", it) }
                            val result = ctx.write("POST", "$route/operations", body)
                            if (!result.optBoolean("ok")) { ctx.notify(result.oltStr("message") ?: "El servidor no confirmó la operación"); return@launch }
                            operation = null
                            if (action == "rename") result.oltStr("newName")?.let { newName -> renameName = newName; onu = JSONObject(onu.toString()).put("name", newName) }
                            ctx.notify(result.oltStr("message") ?: "Operación completada")
                            if (action == "retire-stale" || action == "retire-full") close()
                        } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo completar la operación") } finally { operationSaving = false }
                    }
                }, enabled = preview.optBoolean("allowed") && !operationSaving && oltConfirmed(required, typed), modifier = Modifier.heightIn(min = 48.dp),
                    colors = if (action != "rename") ButtonDefaults.buttonColors(containerColor = IspRed) else ButtonDefaults.buttonColors()) {
                    Text(if (operationSaving) "Aplicando..." else oltOperationConfirmLabel(action))
                }
            }) {
            Text(preview.text("impact", ""))
            preview.oltStr("reason")?.let { Notice(it, true) }
            val stale = preview.optJSONArray("staleLocations").objects()
            if (stale.isNotEmpty()) Row {
                OltField("Anterior", stale.first().text("onuIndex", "") + if (stale.size > 1) " +${stale.size - 1}" else "", Modifier.weight(1f), mono = true)
                OltField("Activa", preview.optJSONObject("activeLocation")?.text("onuIndex", "--") ?: "--", Modifier.weight(1f), mono = true)
            }
            if (!preview.optBoolean("allowed")) Notice("No se puede ejecutar ahora.", true)
            else if (required != null) OltTypedConfirmation(required, typed, { typed = it }, enabled = !operationSaving)
        }
    }

    confirmLink?.let { target ->
        OltConfirmDialog("Esta ONU está asociada a ${client?.oltStr("nombre") ?: "cliente #$clientId"}. ¿Cambiarla a ${target.text("nombre", "")}?", "Cambiar",
            onDismiss = { confirmLink = null }) { confirmLink = null; assignClient(target) }
    }
    if (confirmUnlink) OltConfirmDialog("¿Desvincular esta ONU de ${client?.oltStr("nombre") ?: "cliente #$clientId"}? El servicio no se corta; solo se quita la asociación en ISP Max.", "Desvincular",
        onDismiss = { confirmUnlink = false }) { confirmUnlink = false; assignClient(null) }
}

/** Clientes detras de la ONU: OLT MAC → MikroTik ARP → WispHub. */
@Composable
private fun OltDownstream(ctx: OltCtx, diag: JSONObject) {
    val access = diag.optJSONObject("access") ?: JSONObject()
    val downstream = diag.optJSONObject("downstream") ?: JSONObject()
    val mode = access.oltStr("mode")
    OltCard {
        OltSectionTitle("Clientes detrás de la ONU", "OLT MAC → MikroTik ARP → WispHub.") {
            OltPill(when (mode) { "bridge" -> "Bridge"; "router" -> "Router"; else -> "Modo sin identificar" }, IspBlue)
        }
        Row {
            OltField("Clientes", downstream.optInt("identifiedClients").toString(), Modifier.weight(1f))
            OltField("MAC activas", downstream.optInt("totalMacs").toString(), Modifier.weight(1f))
            OltField("Sin identificar", downstream.optInt("unknownDevices").toString(), Modifier.weight(1f), if (downstream.optInt("unknownDevices") > 0) IspAmber else Color.Unspecified)
        }
        access.optJSONArray("evidence").oltStrings().forEach { evidence ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen, modifier = Modifier.size(14.dp)); Text(evidence, style = MaterialTheme.typography.bodySmall) }
        }
        val clients = downstream.optJSONArray("clients").objects()
        if (clients.isEmpty()) Text(if (mode == "router") "Asocia el cliente o activa TR-069 para ver dispositivos LAN/WiFi." else "La OLT todavía no ha aprendido MAC detrás de esta ONU.", style = MaterialTheme.typography.bodySmall)
        clients.forEach { item ->
            val linked = item.optJSONObject("client")
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OltDot(if (linked != null) IspGreen else IspAmber, 8)
                Column(Modifier.weight(1f)) {
                    Text(linked?.oltStr("nombre") ?: "Equipo sin asociar", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(linked?.oltStr("planInternetName") ?: item.optJSONObject("queue")?.oltStr("name") ?: "Sin plan identificado", style = MaterialTheme.typography.bodySmall)
                    OltMono("${item.oltStr("ip") ?: linked?.oltStr("ip") ?: "Sin IP"} · ${item.oltStr("macAddress") ?: "—"}")
                }
                linked?.oltInt("idServicio")?.let { id -> TextButton(onClick = { ctx.onClient(id) }) { Text("Abrir") } }
            }
        }
        downstream.oltStr("limitation")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}

/** Tendencia de senal RX (equivale a app-optical-trend). */
@Composable
internal fun OltOpticalTrend(readings: List<JSONObject>) {
    val sorted = readings.sortedBy { oltInstant(it.oltStr("capturedAt"))?.toEpochMilli() ?: 0L }
    if (sorted.isEmpty()) { Text("La primera medición se guardará al consultar esta ONU. Pulse «Actualizar» para leerla ahora.", style = MaterialTheme.typography.bodySmall); return }
    val measured = sorted.filter { it.optBoolean("online") && it.oltNum("rxPowerDbm") != null }
    val values = measured.map { it.oltNum("rxPowerDbm")!! }
    val offline = sorted.count { !it.optBoolean("online") }
    val current = values.lastOrNull()
    val min = values.minOrNull(); val max = values.maxOrNull()
    val avg = if (values.isEmpty()) null else (values.average() * 10).roundToInt() / 10.0
    val delta = if (values.size > 1) ((values.last() - values.first()) * 10).roundToInt() / 10.0 else null
    val swing = if (min != null && max != null) ((max - min) * 10).roundToInt() / 10.0 else 0.0
    val verdict = when {
        current == null -> "empty"; oltIsCritical(current) -> "critical"; delta != null && delta <= -1.5 -> "worse"
        swing >= 3 || offline >= 2 -> "unstable"; delta != null && delta >= 1.5 -> "better"; else -> "stable"
    }
    val since = oltAgo(sorted.first().oltStr("capturedAt"))
    val title = when (verdict) {
        "empty" -> "Sin lecturas de señal en línea"; "critical" -> "Señal crítica ahora"; "worse" -> "Empeoró ${oltNumText(abs(delta ?: 0.0))} dB en el período"
        "unstable" -> if (swing >= 3) "Inestable: varía ${oltNumText(swing)} dB" else "Con desconexiones: $offline lecturas sin conexión"
        "better" -> "Mejoró ${oltNumText(delta)} dB en el período"; else -> "Señal estable"
    }
    val detail = when (verdict) {
        "empty" -> "Las ${sorted.size} lecturas guardadas fueron con la ONU sin conexión."
        "critical" -> "Por debajo de -30 dBm el servicio puede cortarse. Revise acometida, conectores y empalmes."
        "worse" -> "La potencia viene bajando: limpie conectores y revise curvaturas o golpes en la fibra."
        "unstable" -> "Cambios bruscos suelen indicar conector flojo, fibra doblada o problemas de energía en casa del cliente."
        "better" -> "Comparado con la primera lectura ($since)."
        else -> "${sorted.size} lecturas desde $since; sin cambios importantes."
    }
    val tone = when (verdict) { "critical", "worse" -> IspRed; "unstable" -> IspAmber; "empty" -> OltGray; else -> IspGreen }
    fun signed(value: Double?) = if (value == null) "--" else "${if (value > 0) "+" else ""}${oltNumText(value)} dB"

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(when (verdict) { "worse", "critical" -> Icons.Outlined.TrendingDown; "better" -> Icons.Outlined.TrendingUp; else -> Icons.Outlined.Remove }, null, tint = tone)
        Column { Text(title, fontWeight = FontWeight.Bold, color = tone); Text(detail, style = MaterialTheme.typography.bodySmall) }
    }
    Row { OltField("Actual", oltDbm(current), Modifier.weight(1f), oltSignalColor(current)); OltField("Mínimo", oltDbm(min), Modifier.weight(1f), oltSignalColor(min)); OltField("Máximo", oltDbm(max), Modifier.weight(1f)) }
    Row { OltField("Promedio", oltDbm(avg), Modifier.weight(1f)); OltField("Variación", signed(delta), Modifier.weight(1f)); OltField("Sin conexión", "$offline de ${sorted.size}", Modifier.weight(1f), if (offline > 0) IspRed else Color.Unspecified) }

    val top = maxOf(values.maxOrNull() ?: OLT_RX_WEAK + 4, OLT_RX_WEAK + 4) + 1
    val bottom = minOf(values.minOrNull() ?: OLT_RX_CRITICAL - 1, OLT_RX_CRITICAL - 1) - 1
    Canvas(Modifier.fillMaxWidth().height(140.dp)) {
        val padX = 12.dp.toPx(); val padY = 10.dp.toPx()
        fun x(index: Int) = if (sorted.size == 1) size.width / 2 else padX + index.toFloat() / (sorted.size - 1) * (size.width - padX * 2)
        fun y(value: Double) = (padY + (top - value) / (top - bottom) * (size.height - padY * 2)).toFloat()
        val weakY = y(OLT_RX_WEAK); val criticalY = y(OLT_RX_CRITICAL)
        drawRect(Color(0xFFFFF6E8), Offset(0f, weakY), Size(size.width, criticalY - weakY))
        drawRect(Color(0xFFFFF0EF), Offset(0f, criticalY), Size(size.width, size.height - criticalY))
        drawLine(IspAmber, Offset(0f, weakY), Offset(size.width, weakY), 1.dp.toPx())
        drawLine(IspRed, Offset(0f, criticalY), Offset(size.width, criticalY), 1.dp.toPx())
        val points = sorted.mapIndexedNotNull { index, reading -> if (reading.optBoolean("online") && reading.oltNum("rxPowerDbm") != null) Offset(x(index), y(reading.oltNum("rxPowerDbm")!!)) to reading.oltNum("rxPowerDbm")!! else null }
        if (points.size > 1) {
            val path = Path(); points.forEachIndexed { i, (p, _) -> if (i == 0) path.moveTo(p.x, p.y) else path.lineTo(p.x, p.y) }
            drawPath(path, IspBlue, style = Stroke(2.dp.toPx()))
        }
        points.forEachIndexed { i, (p, value) -> drawCircle(oltSignalColor(value), radius = (if (i == points.size - 1) 4f else 2.5f).dp.toPx(), center = p) }
        sorted.forEachIndexed { index, reading -> if (!reading.optBoolean("online")) drawRect(IspRed, Offset(x(index) - 1.5.dp.toPx(), size.height - 7.dp.toPx()), Size(3.dp.toPx(), 7.dp.toPx())) }
    }
    Row(Modifier.fillMaxWidth()) {
        Text(oltDate(sorted.first().oltStr("capturedAt")), style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
        Text(oltDate(sorted.last().oltStr("capturedAt")), style = MaterialTheme.typography.labelSmall)
    }
    Text("Débil ≤ -27 dBm · Crítica ≤ -30 dBm" + if (offline > 0) " · rojo abajo: sin conexión" else "", style = MaterialTheme.typography.labelSmall)
    val recent = sorted.mapIndexed { index, reading ->
        val previous = sorted.subList(0, index).lastOrNull { it.optBoolean("online") && it.oltNum("rxPowerDbm") != null }
        val measuredNow = reading.optBoolean("online") && reading.oltNum("rxPowerDbm") != null
        reading to if (measuredNow && previous != null) ((reading.oltNum("rxPowerDbm")!! - previous.oltNum("rxPowerDbm")!!) * 10).roundToInt() / 10.0 else null
    }.reversed().take(8)
    recent.forEach { (reading, change) ->
        val value = reading.oltNum("rxPowerDbm")
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(oltAgo(reading.oltStr("capturedAt")), style = MaterialTheme.typography.bodySmall, modifier = Modifier.width(110.dp))
            if (reading.optBoolean("online") && value != null) Text("${oltDbm(value)} · ${oltSignalLabel(value)}", Modifier.weight(1f), color = oltSignalColor(value), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
            else Text("Sin conexión", Modifier.weight(1f), color = IspRed, style = MaterialTheme.typography.bodySmall)
            Text(if (change == null) "" else signed(change), style = MaterialTheme.typography.labelSmall, color = when { (change ?: 0.0) <= -0.5 -> IspRed; (change ?: 0.0) >= 0.5 -> IspGreen; else -> Color.Unspecified })
        }
    }
}
