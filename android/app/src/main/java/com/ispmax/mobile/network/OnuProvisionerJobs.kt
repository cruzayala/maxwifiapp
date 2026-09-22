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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Expedientes de instalación (/provisioning/jobs): lista, detalle, cancelación con vista previa y retiro de la ONU anterior. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun OnuJobsTab(vm: MainViewModel, pages: Map<String, PageState>, canManage: Boolean) {
    var showAll by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf<String?>(null) }
    val state = pages[ONU_JOBS_PATH] ?: PageState(loading = true)
    LaunchedEffect(Unit) { vm.load(ONU_JOBS_PATH) }
    val all = state.body?.optJSONArray("items").objects()
    val rows = all.filter { showAll || it.optString("status") !in listOf("cancelled", "complete") }.filter { job ->
        val q = query.trim().lowercase()
        q.isEmpty() || listOf("id", "clientName", "ip", "serial", "model", "onuIndex", "createdBy").any { job.optString(it).lowercase().contains(q) }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Expedientes de instalación", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text("Cliente, IP y ONU protegidos por cada operación.", style = MaterialTheme.typography.bodySmall) }
        item {
            OutlinedTextField(query, { query = it }, label = { Text("Cliente, IP, serial o ID") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !showAll, onClick = { showAll = false }, label = { Text("En curso") })
                FilterChip(selected = showAll, onClick = { showAll = true }, label = { Text("Todos") })
                TextButton(onClick = { vm.load(ONU_JOBS_PATH, true) }) { Icon(Icons.Outlined.Refresh, null); Text("Actualizar") }
            }
            ReadStatus(state) { vm.load(ONU_JOBS_PATH, true) }
        }
        if (rows.isEmpty() && !state.loading) item { EmptyState("No hay expedientes para esta vista.") }
        items(rows, key = { "job-" + it.optString("id") }) { job ->
            OutlinedCard(onClick = { detail = job.optString("id") }, modifier = Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(job.trText("clientName") ?: job.trText("serial") ?: job.trText("ip") ?: "Solicitud sin nombre", fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("${onuOperationLabel(job.optString("mode"))} · ${onuJobStageLabel(job.optString("stage"))}\n${job.trText("ip") ?: "Sin IP"} · ${job.trText("serial") ?: "Sin serial"} · ${tr069Date(job.trText("updatedAt"))}") },
                    trailingContent = { StatusBadge(onuJobStatusLabel(job)) },
                )
            }
        }
    }
    detail?.let { id -> OnuJobDetail(vm, pages, id, all.firstOrNull { it.optString("id") == id }, canManage) { detail = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun OnuJobDetail(vm: MainViewModel, pages: Map<String, PageState>, id: String, fallback: JSONObject?, canManage: Boolean, close: () -> Unit) {
    val path = "web:/provisioning/jobs/${tr069Encode(id)}"
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val job = state.body ?: fallback
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var cancelPreview by remember { mutableStateOf<JSONObject?>(null) }
    var retirePreview by remember { mutableStateOf<JSONObject?>(null) }
    val canClose = canManage && job != null && job.optString("status") != "cancelled" && job.trText("onuIndex") == null
    val canRetire = canManage && job?.optString("mode") == "replace_onu"

    fun loadPreview(kind: String) {
        busy = true
        scope.launch {
            try {
                val result = vm.web("GET", "/provisioning/jobs/${tr069Encode(id)}/${if (kind == "cancel") "cancellation-preview" else "retire-preview"}")
                if (kind == "cancel") cancelPreview = result else retirePreview = result
            } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) {
                message = (error.message ?: if (kind == "cancel") "No se pudo preparar la cancelación" else "No se pudo preparar el retiro") to true
            }
            busy = false
        }
    }

    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!busy) close() }) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Column { Text("Expediente", fontWeight = FontWeight.Bold); Text(id.take(12), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace) } }, navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } }) }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (busy || state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
                    message?.let { (text, error) -> Tr069Banner(text, error) { message = null } }
                    if (state.error != null && job == null) Notice(state.error, true)
                    if (job != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text(job.trText("clientName") ?: job.trText("serial") ?: job.trText("ip") ?: "Solicitud sin nombre", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); StatusBadge(onuJobStatusLabel(job)) }
                        Row { Tr069Fact("Operación", onuOperationLabel(job.optString("mode")), Modifier.weight(1f)); Tr069Fact("Perfil", if (job.optString("serviceMode") == "bridge") "Bridge" else "Router", Modifier.weight(1f)) }
                        Row { Tr069Fact("Etapa", onuJobStageLabel(job.optString("stage")), Modifier.weight(1f)); Tr069Fact("Origen", if (job.optString("source") == "onu_studio") "ONU Studio" else "Manual", Modifier.weight(1f)) }
                        Row { Tr069Fact("Cliente WispHub", job.trText("clientIdServicio")?.let { "#$it" } ?: "--", Modifier.weight(1f)); Tr069Fact("IP", job.trText("ip") ?: "--", Modifier.weight(1f), mono = true) }
                        Row { Tr069Fact("Serial", job.trText("serial") ?: "--", Modifier.weight(1f), mono = true); Tr069Fact("Modelo", job.trText("model") ?: "--", Modifier.weight(1f)) }
                        Row { Tr069Fact("VLAN", job.trText("vlan") ?: "--", Modifier.weight(1f)); Tr069Fact("Ubicación OLT", job.trText("onuIndex") ?: "--", Modifier.weight(1f), mono = true) }
                        if (job.trText("previousSerial") != null || job.trText("previousOnuIndex") != null) Row { Tr069Fact("ONU anterior", job.trText("previousSerial") ?: "--", Modifier.weight(1f), mono = true); Tr069Fact("Ubicación anterior", job.trText("previousOnuIndex") ?: "--", Modifier.weight(1f), mono = true) }
                        job.trText("targetPonIndex")?.let { Tr069Fact("PON de destino", it) }
                        job.trText("operationReason")?.let { Tr069Fact("Motivo técnico", it) }
                        job.trText("cutoverStatus")?.let { Tr069Fact("Cambio de equipo", it.replace('_', ' ')) }
                        Row { Tr069Fact("Creado por", job.trText("createdBy") ?: "--", Modifier.weight(1f)); Tr069Fact("Actualizado", tr069Date(job.trText("updatedAt")), Modifier.weight(1f)) }
                        job.trText("errorMessage")?.let { Notice(it, true) }
                        job.optJSONObject("configurationManifest")?.let { manifest ->
                            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
                                Text("Manifiesto de configuración", fontWeight = FontWeight.Bold)
                                Text("VLAN ${manifest.optString("vlan")} · WAN ${manifest.trPathText("wan.mode")} ${manifest.trPathText("wan.ip", "")} · WiFi ${manifest.trPathText("wifi.ssid", "No aplica")}", style = MaterialTheme.typography.bodySmall)
                                Text(if (manifest.optBoolean("verified")) "Verificado ${tr069Date(manifest.trText("verifiedAt"))}" else "Sin verificar", style = MaterialTheme.typography.bodySmall, color = if (manifest.optBoolean("verified")) IspGreen else IspAmber)
                            } }
                        }
                        Text("Historial", fontWeight = FontWeight.Bold)
                        val steps = job.optJSONArray("steps").objects()
                        if (steps.isEmpty()) Text("Sin pasos registrados.", style = MaterialTheme.typography.bodySmall)
                        steps.reversed().forEach { step ->
                            val status = step.optString("status")
                            Row(verticalAlignment = Alignment.Top) {
                                Icon(if (status == "error" || status == "failed") Icons.Outlined.ErrorOutline else Icons.Outlined.CheckCircle, null, Modifier.size(18.dp), tint = if (status == "error" || status == "failed") IspRed else IspGreen)
                                Spacer(Modifier.width(8.dp))
                                Column { Text(step.trText("message") ?: onuJobStageLabel(step.optString("stage")), style = MaterialTheme.typography.bodyMedium); Text("${onuJobStageLabel(step.optString("stage"))} · ${tr069Date(step.trText("at"))}${step.trText("source")?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.labelSmall) }
                            }
                        }
                        if (canClose || canRetire) HorizontalDivider()
                        if (canClose) OutlinedButton(onClick = { loadPreview("cancel") }, enabled = !busy, modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                            Icon(Icons.Outlined.Block, null); Spacer(Modifier.width(6.dp)); Text(if (job.optString("status") == "complete") "Cerrar expediente" else "Cancelar instalación")
                        }
                        if (canRetire) OutlinedButton(onClick = { loadPreview("retire") }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                            Icon(Icons.Outlined.DeleteSweep, null); Spacer(Modifier.width(6.dp)); Text("Retirar ONU anterior")
                        }
                    }
                }
            }
            cancelPreview?.let { preview ->
                OnuCancellationDialog(preview, busy, onDismiss = { if (!busy) cancelPreview = null }) {
                    busy = true
                    scope.launch {
                        try {
                            val result = vm.web("POST", "/provisioning/jobs/${tr069Encode(id)}/cancel", JSONObject().put("confirmation", preview.optString("requiredConfirmation")), ONU_JOBS_PATH, "/provisioning/jobs/")
                            if (!result.optBoolean("ok") || result.optJSONObject("job")?.optString("status") != "cancelled") throw IllegalStateException("El servidor no confirmó la cancelación")
                            message = (if (preview.optString("operation") == "close") "Expediente cerrado" else "Instalación cancelada") to false
                            cancelPreview = null
                        } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { message = (error.message ?: "No se pudo cancelar la instalación") to true }
                        busy = false
                    }
                }
            }
            retirePreview?.let { preview ->
                OnuRetireDialog(preview, busy, onDismiss = { if (!busy) retirePreview = null }) { typed ->
                    busy = true
                    scope.launch {
                        try {
                            val result = vm.web("POST", "/provisioning/jobs/${tr069Encode(id)}/retire-previous-onu", JSONObject().put("confirmation", typed), ONU_JOBS_PATH, "/provisioning/jobs/")
                            if (!result.optBoolean("ok")) throw IllegalStateException("El servidor no confirmó el retiro")
                            message = (result.trText("message") ?: "ONU anterior retirada") to false
                            retirePreview = null
                        } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { message = (error.message ?: "No se pudo retirar la ONU anterior") to true }
                        busy = false
                    }
                }
            }
        }
    }
}

@Composable private fun OnuCancellationDialog(preview: JSONObject, busy: Boolean, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val job = preview.optJSONObject("job") ?: JSONObject()
    val allowed = preview.optBoolean("allowed")
    val close = preview.optString("operation") == "close"
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text(if (close) "Cerrar expediente" else "Cancelar instalación") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(job.trText("clientName") ?: job.trText("serial") ?: job.trText("ip") ?: "Solicitud sin nombre", style = MaterialTheme.typography.bodySmall)
                if (allowed) {
                    Text(if (close) "El expediente quedará cerrado" else "La instalación dejará de estar pendiente", fontWeight = FontWeight.Bold)
                    Text("El historial se conserva para auditoría y puede consultarse después.", style = MaterialTheme.typography.bodySmall)
                    Tr069Fact("WispHub y MikroTik", if (preview.optBoolean("servicePreserved")) "Se conservan sin cambios" else "No hay servicio creado")
                    Tr069Fact("Dirección IP", when (preview.optString("reservationAction")) { "release" -> "La reserva se liberará"; "keep_committed" -> "Se conserva asignada"; else -> "Sin reserva activa" })
                    Tr069Fact("ONU en la OLT", if (preview.optBoolean("hasOltChanges")) "Tiene cambios aplicados" else "No se modificará")
                    Tr069Fact("Historial", "Se conserva completo")
                    preview.optJSONArray("warnings").trStrings().forEach { Text("• $it", style = MaterialTheme.typography.bodySmall, color = IspAmber) }
                } else {
                    Text("Esta solicitud no se puede cancelar directamente", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    Text(if (preview.optBoolean("alreadyCancelled")) "Ya fue cancelada." else "La ONU ya recibió cambios en la OLT. Use la opción «Eliminar de la OLT» de la ONU para darla de baja sin dejar el servicio a medias.", style = MaterialTheme.typography.bodySmall)
                }
            }
        },
        confirmButton = { if (allowed) Button(onClick = onConfirm, enabled = !busy, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text(if (busy) "Procesando..." else if (close) "Cerrar expediente" else "Cancelar instalación") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Volver") } })
}

/** Retiro de la ONU anterior tras un cambio de equipo: operación en la OLT, se exige escribir la confirmación exacta. */
@Composable private fun OnuRetireDialog(preview: JSONObject, busy: Boolean, onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    val allowed = preview.optBoolean("allowed")
    val required = preview.optString("requiredConfirmation")
    var typed by remember { mutableStateOf("") }
    AlertDialog(onDismissRequest = onDismiss,
        title = { Text("Retirar ONU anterior") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                preview.optJSONObject("previousOnu")?.let { Tr069Fact("ONU anterior", "${it.optString("onuIndex")} · ${it.optString("serial")} · ${if (it.optBoolean("online")) "En línea" else "Sin línea"}", mono = true) }
                preview.optJSONObject("newOnu")?.let { Tr069Fact("ONU nueva", "${it.optString("onuIndex")} · ${it.optString("serial")} · ${if (it.optBoolean("online")) "En línea" else "Sin línea"}", mono = true) }
                val preserved = preview.optJSONArray("preserved").trStrings()
                if (preserved.isNotEmpty()) Text("Se conserva: ${preserved.joinToString(", ")}", style = MaterialTheme.typography.bodySmall, color = IspGreen)
                if (!allowed) {
                    Text("No se puede retirar todavía", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    preview.optJSONArray("reasons").trStrings().forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
                } else {
                    Text("La ONU anterior se eliminará de la OLT. Esta acción no se puede deshacer.", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    Text("Escriba $required para confirmar", style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(typed, { typed = it }, singleLine = true, placeholder = { Text(required) }, modifier = Modifier.fillMaxWidth())
                }
            }
        },
        confirmButton = { if (allowed) Button(onClick = { onConfirm(typed.trim()) }, enabled = !busy && required.isNotBlank() && typed.trim().uppercase() == required.uppercase(), colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text(if (busy) "Procesando..." else "Retirar de la OLT") } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Volver") } })
}

/** Reservas de IP (/provisioning/ip-catalog y /provisioning/reservations): listar, reservar y liberar. */
@Composable
internal fun OnuReservationsTab(vm: MainViewModel, pages: Map<String, PageState>, canManage: Boolean, username: String?) {
    var search by remember { mutableStateOf("") }
    var searchInput by remember { mutableStateOf("") }
    val path = if (search.isBlank()) ONU_IP_CATALOG_PATH else "$ONU_IP_CATALOG_PATH?q=${tr069Encode(search.trim())}"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    val reservations = body?.optJSONArray("reservations").objects()
    val rows = body?.optJSONArray("rows").objects()
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var reserveIp by remember { mutableStateOf<String?>(null) }
    var releasing by remember { mutableStateOf<JSONObject?>(null) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Text("Reservas de IP", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("Las IP reservadas quedan apartadas para una instalación y vencen solas si no se usan.", style = MaterialTheme.typography.bodySmall)
            message?.let { (text, error) -> Tr069Banner(text, error) { message = null } }
            ReadStatus(state) { vm.load(path, true) }
            if (body?.optBoolean("stale") == true) Notice("Datos en caché: no se pudo leer el inventario en vivo.")
        }
        item { Row(verticalAlignment = Alignment.CenterVertically) { Text("Activas (${reservations.size})", Modifier.weight(1f), fontWeight = FontWeight.Bold); TextButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, null); Text("Actualizar") } } }
        if (reservations.isEmpty() && !state.loading) item { EmptyState("No hay reservas activas.") }
        items(reservations, key = { "res-" + it.optString("token") + it.optString("ip") }) { reservation ->
            val mine = username != null && reservation.optString("createdBy") == username
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(reservation.optString("ip"), fontFamily = FontFamily.Monospace, fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("${reservation.trText("clientName") ?: "Sin cliente"} · ${reservation.trText("serial") ?: "Sin serial"}\n${reservation.trText("createdBy") ?: "--"} · vence ${tr069Date(reservation.trText("expiresAt"))}") },
                    trailingContent = { if ((mine || canManage) && reservation.trText("token") != null) TextButton(onClick = { releasing = reservation }, enabled = !busy) { Text("Liberar") } },
                )
            }
        }
        item {
            Text("Disponibles", fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(searchInput, { searchInput = it.trim() }, label = { Text("Buscar IP") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(6.dp)); Button(onClick = { search = searchInput }) { Text("Buscar") }
            }
        }
        val available = rows.filter { it.optBoolean("available") && it.optJSONObject("reservation") == null }.take(60)
        if (available.isEmpty() && !state.loading) item { EmptyState("No hay direcciones libres para esta búsqueda.") }
        items(available, key = { "ip-" + it.optString("ip") }) { row ->
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(row.optString("ip"), fontFamily = FontFamily.Monospace) },
                    supportingContent = { Text("${row.optString("cidr")}${if (row.optString("availabilityConfidence") == "probe_required") " · requiere sondeo" else ""}") },
                    trailingContent = { TextButton(onClick = { reserveIp = row.optString("ip") }, enabled = !busy) { Text("Reservar") } },
                )
            }
        }
    }

    reserveIp?.let { ip ->
        var clientName by remember(ip) { mutableStateOf("") }
        var serial by remember(ip) { mutableStateOf("") }
        AlertDialog(onDismissRequest = { if (!busy) reserveIp = null }, title = { Text("Reservar $ip") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("La reserva dura 60 minutos. Se valida en vivo contra WispHub, MikroTik, ARP y otras reservas.", style = MaterialTheme.typography.bodySmall)
                OutlinedTextField(clientName, { if (it.length <= 160) clientName = it }, label = { Text("Cliente") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(serial, { serial = it.uppercase().filter(Char::isLetterOrDigit).take(32) }, label = { Text("Serial ONU (opcional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            } },
            confirmButton = { Button(onClick = {
                busy = true
                scope.launch {
                    try {
                        val result = vm.web("POST", "/provisioning/reservations", JSONObject().put("ip", ip).put("clientName", clientName.trim()).put("serial", serial.ifBlank { null } ?: JSONObject.NULL).put("durationMinutes", 60), ONU_IP_CATALOG_PATH)
                        if (result.optString("ip") != ip || result.trText("token") == null || result.optString("status") != "active") throw IllegalStateException("El servidor no confirmó la reserva")
                        message = "IP $ip reservada hasta ${tr069Date(result.trText("expiresAt"))}${if (result.optBoolean("requiresProbe")) " (verificada con sondeo ARP)" else ""}" to false
                        reserveIp = null
                    } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { message = (error.message ?: "No se pudo reservar la IP") to true }
                    busy = false
                }
            }, enabled = !busy) { Text(if (busy) "Reservando..." else "Reservar") } },
            dismissButton = { TextButton(onClick = { reserveIp = null }, enabled = !busy) { Text("Cancelar") } })
    }
    releasing?.let { reservation ->
        Tr069Confirm("Liberar reserva", "¿Liberar la IP ${reservation.optString("ip")}? Volverá al inventario libre.", "Liberar", danger = true, onDismiss = { releasing = null }) {
            busy = true
            scope.launch {
                try {
                    val result = vm.web("DELETE", "/provisioning/reservations/${tr069Encode(reservation.optString("token"))}", null, ONU_IP_CATALOG_PATH)
                    if (result.optString("status") != "released") throw IllegalStateException("El servidor no confirmó la liberación")
                    message = "IP ${reservation.optString("ip")} liberada" to false
                } catch (cancel: CancellationException) { throw cancel } catch (error: Exception) { message = (error.message ?: "No se pudo liberar la reserva") to true }
                busy = false
            }
        }
    }
}
