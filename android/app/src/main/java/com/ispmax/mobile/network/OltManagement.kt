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
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ---------------- Instalaciones ----------------

@Composable
internal fun OltInstallationsTab(ctx: OltCtx, onContinue: (JSONObject) -> Unit) {
    val scope = rememberCoroutineScope()
    var filter by remember { mutableStateOf("all") }
    var loadingId by remember { mutableStateOf<String?>(null) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var saving by remember { mutableStateOf(false) }
    val state = ctx.page(OltPaths.JOBS)
    val jobs = ctx.items(OltPaths.JOBS)
    fun active(job: JSONObject) = job.oltStr("status") !in listOf("complete", "cancelled", "failed")
    val filtered = jobs.filter { when (filter) { "active" -> active(it); "error" -> oltInstallationHasError(it); "complete" -> it.oltStr("status") == "complete"; else -> true } }

    fun openCancellation(job: JSONObject) {
        if (loadingId != null || saving) return
        val id = job.optString("id")
        loadingId = id
        scope.launch {
            try { preview = ctx.read("/provisioning/jobs/${oltEnc(id)}/cancellation-preview") }
            catch (error: Exception) { ctx.notify(error.message ?: "No se pudo preparar la cancelación") } finally { loadingId = null }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OltSectionTitle("Expedientes de instalación", "Progreso persistente desde la reserva de IP hasta la entrega del servicio.") {
                ExportButton(filtered.map { job ->
                    JSONObject().put("Cliente", job.oltStr("clientName") ?: "").put("ID servicio", job.oltInt("clientIdServicio")?.toString() ?: "").put("IP", job.oltStr("ip") ?: "")
                        .put("Serial", job.oltStr("serial") ?: "").put("Modelo", job.oltStr("model") ?: "").put("PON", job.oltStr("ponIndex") ?: "").put("ONU", job.oltStr("onuIndex") ?: "")
                        .put("Etapa", oltInstallationStage(job.oltStr("stage"))).put("Estado", oltInstallationStatus(job)).put("Error", job.oltStr("errorMessage") ?: "")
                        .put("Versión del agente", job.oltStr("agentVersion") ?: "").put("Creado", oltDate(job.oltStr("createdAt"))).put("Actualizado", oltDate(job.oltStr("updatedAt")))
                }, "instalaciones")
            }
        }
        item {
            OltChips(listOf(Triple("all", "Todas", jobs.size), Triple("active", "En curso", jobs.count(::active)),
                Triple("error", "Con error", jobs.count(::oltInstallationHasError)), Triple("complete", "Completadas", jobs.count { it.oltStr("status") == "complete" })), filter) { filter = it }
        }
        item { ReadStatus(state) { ctx.vm.load(OltPaths.JOBS, true) } }
        if (filtered.isEmpty() && !state.loading) item { EmptyState(if (jobs.isNotEmpty()) "No hay expedientes en este filtro. Elija «Todas»." else "Aún no existen expedientes de instalación.") }
        items(filtered, key = { it.optString("id") }) { job ->
            val status = job.oltStr("status")
            val color = when { status == "failed" || job.oltStr("localStatus") == "error" -> IspRed; status == "complete" || job.oltStr("localStatus") == "success" -> IspGreen; status == "cancelled" -> OltGray; else -> IspAmber }
            val clientId = job.oltInt("clientIdServicio")
            OltCard(accent = color) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(job.oltStr("clientName") ?: clientId?.let { "Cliente #$it" } ?: "Sin nombre", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis,
                            modifier = if (clientId != null) Modifier.clickable { ctx.onClient(clientId) } else Modifier)
                        clientId?.let { Text("WispHub #$it", style = MaterialTheme.typography.labelSmall) }
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        OltPill(oltInstallationStatus(job), color)
                        job.oltStr("agentVersion")?.let { Text("Agente v$it", style = MaterialTheme.typography.labelSmall) }
                    }
                }
                Row { OltField("IP", job.oltStr("ip") ?: "--", Modifier.weight(1f), mono = true); OltField("Serial", job.oltStr("serial") ?: "--", Modifier.weight(1f), mono = true) }
                Text(oltInstallationStage(job.oltStr("stage")), fontWeight = FontWeight.SemiBold)
                job.oltStr("ponIndex")?.let { Text("PON $it", style = MaterialTheme.typography.bodySmall) }
                job.oltStr("errorMessage")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = IspRed) }
                Text("Actualizado ${oltAgo(job.oltStr("updatedAt"))} · ${oltDate(job.oltStr("updatedAt"))}", style = MaterialTheme.typography.labelSmall)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (job.oltStr("stage") == "olt_discovered") Button(onClick = { onContinue(job) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Continuar") }
                    if (ctx.admin && status != "cancelled" && job.oltStr("onuIndex") == null) {
                        val busy = loadingId == job.optString("id")
                        OutlinedButton(onClick = { openCancellation(job) }, enabled = !busy, modifier = Modifier.heightIn(min = 44.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = IspRed)) {
                            Icon(Icons.Outlined.Block, null); Spacer(Modifier.width(4.dp)); Text(if (busy) "Revisando..." else if (status == "complete") "Cerrar" else "Cancelar")
                        }
                    }
                }
            }
        }
    }

    preview?.let { current ->
        val job = current.optJSONObject("job") ?: JSONObject()
        val close = current.oltStr("operation") == "close"
        OltFullDialog(title = if (close) "Cerrar expediente" else "Cancelar instalación", eyebrow = "Control de instalaciones",
            subtitle = job.oltStr("clientName") ?: job.oltStr("serial") ?: job.oltStr("ip") ?: "Solicitud sin nombre", closeEnabled = !saving, onClose = { preview = null }, footer = {
                OutlinedButton(onClick = { preview = null }, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Volver") }
                if (current.optBoolean("allowed")) Button(onClick = {
                    if (saving) return@Button
                    saving = true
                    scope.launch {
                        try {
                            val result = ctx.write("POST", "/provisioning/jobs/${oltEnc(job.optString("id"))}/cancel", JSONObject().put("confirmation", current.optString("requiredConfirmation")))
                            if (result.optBoolean("ok")) { preview = null; ctx.notify(if (close) "Expediente cerrado" else "Instalación cancelada") }
                            else ctx.notify("El servidor no confirmó la cancelación")
                        } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo cancelar la instalación") } finally { saving = false }
                    }
                }, enabled = !saving, colors = ButtonDefaults.buttonColors(containerColor = IspRed), modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(if (saving) "Procesando..." else if (close) "Cerrar expediente" else "Cancelar instalación")
                }
            }) {
            if (current.optBoolean("allowed")) {
                Notice((if (close) "El expediente quedará cerrado" else "La instalación dejará de estar pendiente") + ". El historial se conserva para auditoría y puede consultarse después.")
                OltField("WispHub y MikroTik", if (current.optBoolean("servicePreserved")) "Se conservan sin cambios" else "No hay servicio creado")
                OltField("Dirección IP", when (current.oltStr("reservationAction")) { "release" -> "La reserva se liberará"; "keep_committed" -> "Se conserva asignada"; else -> "Sin reserva activa" })
                OltField("ONU en la OLT", if (current.optBoolean("hasOltChanges")) "Tiene cambios aplicados" else "No se modificará")
                OltField("Historial", "Se conserva completo")
                current.optJSONArray("warnings").oltStrings().forEach { Notice(it, true) }
            } else {
                Notice("Esta solicitud no se puede cancelar directamente. " + if (current.optBoolean("alreadyCancelled")) "Ya fue cancelada." else "La ONU ya recibió cambios en la OLT. Use la opción «Eliminar de la OLT» de la ONU para darla de baja sin dejar el servicio a medias.", true)
            }
        }
    }
}

// ---------------- Topologia: splitters, NAP y puertos ----------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun OltTopologyTab(ctx: OltCtx) {
    val scope = rememberCoroutineScope()
    val state = ctx.page(OltPaths.TOPOLOGY)
    val splitters = ctx.items(OltPaths.TOPOLOGY)
    var splitterForm by remember { mutableStateOf(false) }
    var napForm by remember { mutableStateOf(false) }
    var lastPon by remember { mutableStateOf("1/1/1") }
    var lastSplitterId by remember { mutableIntStateOf(0) }
    var port by remember { mutableStateOf<JSONObject?>(null) }
    var portOnu by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { OltSectionTitle("Planta externa FTTH", "Relación PON, splitter, NAP, puerto, ONU y cliente.") }
        if (ctx.admin) item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { splitterForm = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Icon(Icons.Outlined.Add, null); Text("Nuevo splitter") }
                OutlinedButton(onClick = { napForm = true }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Icon(Icons.Outlined.Add, null); Text("Nueva NAP") }
            }
        }
        item { ReadStatus(state) { ctx.vm.load(OltPaths.TOPOLOGY, true) } }
        if (splitters.isEmpty() && !state.loading) item { EmptyState("Cree el primer splitter y luego agregue sus NAP.") }
        items(splitters, key = { it.optInt("id") }) { splitter ->
            val naps = splitter.optJSONArray("naps").objects()
            OltCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(splitter.text("name", ""), fontWeight = FontWeight.Bold); OltMono("PON ${splitter.text("ponIndex", "")} · 1:${splitter.optInt("ratio")}") }
                    Text("${naps.size} NAP", style = MaterialTheme.typography.labelMedium)
                }
                if (naps.isEmpty()) Text("Este splitter aún no tiene NAP asignadas.", style = MaterialTheme.typography.bodySmall)
                naps.forEach { nap ->
                    HorizontalDivider()
                    Text("${nap.text("code", "")} · ${nap.text("name", "")}", fontWeight = FontWeight.SemiBold)
                    Text("${nap.optInt("usedPorts")} ocupados · ${nap.optInt("availablePorts")} libres · ${nap.optInt("capacity")} total", style = MaterialTheme.typography.bodySmall)
                    val capacity = nap.optInt("capacity")
                    LinearProgressIndicator(progress = { if (capacity > 0) nap.optInt("usedPorts").toFloat() / capacity else 0f }, modifier = Modifier.fillMaxWidth())
                    nap.optJSONArray("ports").objects().chunked(8).forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            row.forEach { item ->
                                val color = when (item.oltStr("status")) { "assigned" -> IspGreen; "damaged" -> IspRed; "reserved" -> IspAmber; else -> OltGray }
                                val selected = port?.optInt("id") == item.optInt("id")
                                Box(Modifier.size(38.dp).background(color.copy(alpha = if (selected) 0.45f else 0.15f), MaterialTheme.shapes.small)
                                    .clickable { port = item; portOnu = item.oltStr("onuIndex") ?: "" }, contentAlignment = Alignment.Center) {
                                    Text(item.optInt("portNumber").toString(), color = color, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (splitterForm) {
        var name by remember { mutableStateOf("") }
        var pon by remember { mutableStateOf(lastPon) }
        var ratio by remember { mutableStateOf("16") }
        OltFullDialog(title = "Nuevo splitter", eyebrow = "Planta externa", closeEnabled = !saving, onClose = { splitterForm = false }, footer = {
            Button(onClick = {
                saving = true
                scope.launch {
                    try {
                        val created = ctx.write("POST", "/olt-api/topology/splitters", JSONObject().put("name", name).put("ponIndex", pon).put("ratio", ratio.toInt()).put("zone", ""))
                        ctx.notify("Splitter ${created.text("name", name)} creado"); lastPon = created.oltStr("ponIndex") ?: pon; splitterForm = false
                    } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo crear el splitter") } finally { saving = false }
                }
            }, enabled = !saving && name.isNotBlank() && pon.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) { Text("Crear splitter") }
        }) {
            OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Nombre") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(pon, { pon = it }, singleLine = true, label = { Text("PON") }, modifier = Modifier.fillMaxWidth())
            OltSelect("Relación", ratio, listOf("8", "16", "32", "64", "128").map { it to "1:$it" }) { ratio = it }
        }
    }
    if (napForm) {
        var code by remember { mutableStateOf("") }
        var name by remember { mutableStateOf("") }
        var splitterId by remember { mutableIntStateOf(lastSplitterId) }
        var capacity by remember { mutableStateOf("16") }
        OltFullDialog(title = "Nueva NAP", eyebrow = "Planta externa", closeEnabled = !saving, onClose = { napForm = false }, footer = {
            Button(onClick = {
                saving = true
                scope.launch {
                    try {
                        val created = ctx.write("POST", "/olt-api/topology/naps", JSONObject().put("code", code).put("name", name).put("splitterId", splitterId).put("capacity", capacity.toInt()).put("zone", ""))
                        ctx.notify("NAP ${created.text("code", code)} creada con ${created.optInt("capacity", capacity.toInt())} puertos"); lastSplitterId = splitterId; napForm = false
                    } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo crear la NAP") } finally { saving = false }
                }
            }, enabled = !saving && code.isNotBlank() && name.isNotBlank() && splitterId != 0, modifier = Modifier.heightIn(min = 48.dp)) { Text("Crear NAP") }
        }) {
            OutlinedTextField(code, { code = it }, singleLine = true, label = { Text("Código") }, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Nombre") }, modifier = Modifier.fillMaxWidth())
            OltSelect("Splitter", splitterId.toString(), listOf("0" to "Seleccionar") + splitters.map { it.optInt("id").toString() to "${it.text("name", "")} · ${it.text("ponIndex", "")}" }) { splitterId = it.toInt() }
            OltSelect("Puertos", capacity, listOf("8", "16", "24", "32").map { it to it }) { capacity = it }
        }
    }
    port?.let { selected ->
        fun save(status: String) {
            saving = true
            scope.launch {
                try {
                    ctx.write("PATCH", "/olt-api/topology/ports/${selected.optInt("id")}", JSONObject().put("status", status).put("onuIndex", if (status == "assigned") portOnu.trim() else JSONObject.NULL))
                    ctx.notify("Puerto NAP actualizado"); port = null; portOnu = ""
                } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo actualizar el puerto") } finally { saving = false }
            }
        }
        ModalBottomSheet(onDismissRequest = { if (!saving) port = null }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Puerto ${selected.optInt("portNumber")}: ${selected.oltStr("onuIndex") ?: oltNapPortStatus(selected.oltStr("status"))}", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                selected.optJSONObject("client")?.let { Text("${it.text("nombre", "")} · ${it.oltStr("ip") ?: "Sin IP"}", style = MaterialTheme.typography.bodySmall) }
                if (ctx.admin) {
                    OutlinedTextField(portOnu, { portOnu = it }, singleLine = true, label = { Text("ONU (ej. 1/1/13:2)") }, modifier = Modifier.fillMaxWidth())
                    Button(onClick = { save("assigned") }, enabled = !saving && portOnu.isNotBlank(), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Asignar ONU") }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { save("reserved") }, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Reservar") }
                        OutlinedButton(onClick = { save("available") }, enabled = !saving, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text("Liberar") }
                    }
                    OutlinedButton(onClick = { save("damaged") }, enabled = !saving, colors = ButtonDefaults.outlinedButtonColors(contentColor = IspRed), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Marcar averiado") }
                }
                TextButton(onClick = { port = null }, enabled = !saving, modifier = Modifier.fillMaxWidth()) { Text("Cerrar") }
            }
        }
    }
}

// ---------------- Perfiles: tipos de ONU, sincronizacion de planes y perfiles ----------------

private val CAPABILITY_LABELS = linkedMapOf(
    "olt_provision" to "Aprovisionamiento OLT", "optical_read" to "Lectura óptica", "equipment_read" to "Inventario",
    "service_read" to "Lectura de servicio", "ethernet_read" to "Lectura Ethernet", "wifi_read" to "Lectura WiFi",
    "wifi_write" to "Cambios WiFi", "lan_read" to "Lectura LAN", "lan_write" to "Cambios LAN", "wan_read" to "Lectura WAN",
    "wan_write" to "Cambios WAN", "diagnostics" to "Diagnósticos", "reboot" to "Reinicio", "factory_reset" to "Restauración de fábrica",
    "firmware_upgrade" to "Firmware", "acs_config" to "Configuración ACS", "security_config" to "NAT y seguridad",
)
private val CHANNELS = listOf("OLT_CLI" to "OLT (consola)", "OMCI" to "OMCI (OLT)", "TR069" to "TR-069 (remoto)", "WEB_LOCAL" to "Web local")
private val CAP_STATUSES = listOf("detected" to "Detectada", "verified" to "Verificada", "failed" to "Con fallo", "blocked" to "Bloqueada")
private fun omciLabel(mode: String?) = mapOf("baseline" to "OMCI base", "extended" to "OMCI extendido", "vendor" to "OMCI propietario")[mode.orEmpty()] ?: mode ?: "OMCI"
private fun defaultCapabilities(): List<JSONObject> = CAPABILITY_LABELS.keys.map { action ->
    JSONObject().put("action", action)
        .put("channel", if (action == "olt_provision") "OLT_CLI" else if (action in listOf("optical_read", "equipment_read", "service_read", "reboot")) "OMCI" else "TR069")
        .put("status", if (action == "olt_provision") "detected" else "blocked").put("rollbackSupported", false)
        .put("destructive", action in listOf("factory_reset", "firmware_upgrade"))
}

@Composable
internal fun OltProfilesTab(ctx: OltCtx) {
    val scope = rememberCoroutineScope()
    var showArchived by remember { mutableStateOf(false) }
    val profilesPath = if (showArchived) OltPaths.PROFILES_ALL else OltPaths.PROFILES
    LaunchedEffect(profilesPath) { ctx.vm.load(profilesPath) }
    val profilesState = ctx.page(profilesPath)
    val profiles = ctx.items(profilesPath)
    val modelsState = ctx.page(OltPaths.MODELS)
    val models = ctx.items(OltPaths.MODELS)
    var planSync by remember { mutableStateOf<JSONObject?>(null) }
    var planLoading by remember { mutableStateOf(false) }
    var planSaving by remember { mutableStateOf(false) }
    var planConfirm by remember { mutableStateOf(false) }
    var reconciling by remember { mutableStateOf(false) }
    var modelEditor by remember { mutableStateOf<JSONObject?>(null) }
    var archiveModel by remember { mutableStateOf<JSONObject?>(null) }
    var profileEditor by remember { mutableStateOf<JSONObject?>(null) }

    fun loadPlanSync() {
        if (planLoading) return
        planLoading = true
        scope.launch {
            try { planSync = ctx.read("/olt-api/profiles/plan-sync") } catch (error: Exception) { ctx.notify(error.message ?: "No se pudieron comparar los planes") } finally { planLoading = false }
        }
    }
    // La web compara catalogos al abrir la pestana; el servidor exige rol admin para esa lectura.
    LaunchedEffect(Unit) { if (ctx.admin && planSync == null) loadPlanSync() }

    fun toggleModel(profile: JSONObject) {
        val active = profile.optBoolean("active")
        scope.launch {
            try {
                ctx.write("PATCH", "/olt-api/model-profiles/${profile.optInt("id")}", JSONObject().put("active", !active).put("changeReason", if (active) "Perfil archivado" else "Perfil reactivado"))
                ctx.notify(if (active) "Perfil archivado" else "Perfil activado")
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo actualizar el perfil") }
        }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // Tipos de ONU (onu-model-catalog)
        item {
            OltSectionTitle("Tipos de ONU", "Cada modelo define cómo se autoriza en la OLT y qué canal administra cada función.")
        }
        if (ctx.admin) item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    if (reconciling) return@OutlinedButton
                    reconciling = true
                    scope.launch {
                        try {
                            val result = ctx.write("POST", "/olt-api/model-profiles/reconcile", JSONObject())
                            if (result.optBoolean("ok")) ctx.notify("${result.optInt("matched")} de ${result.optInt("scanned")} ONU asociadas a perfiles") else ctx.notify("El servidor no confirmó la conciliación")
                        } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo conciliar el catálogo") } finally { reconciling = false }
                    }
                }, enabled = !reconciling, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Text(if (reconciling) "Asociando..." else "Asociar inventario") }
                Button(onClick = { modelEditor = JSONObject() }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) { Icon(Icons.Outlined.Add, null); Text("Nuevo tipo") }
            }
        }
        item {
            Row {
                OltField("Modelos activos", models.count { it.optBoolean("active") }.toString(), Modifier.weight(1f))
                OltField("Certificados", models.count { it.oltStr("certificationStatus") == "verified" }.toString(), Modifier.weight(1f))
                OltField("ONU asociadas", models.sumOf { it.optInt("deviceCount") }.toString(), Modifier.weight(1f))
            }
        }
        item { ReadStatus(modelsState) { ctx.vm.load(OltPaths.MODELS, true) } }
        if (models.isEmpty() && !modelsState.loading) item { EmptyState("Sin tipos de ONU. Pulse «Nuevo tipo» para registrar el primer modelo.") }
        items(models, key = { "model-" + it.optInt("id") }) { profile ->
            val caps = profile.optJSONArray("capabilities").objects()
            val verified = profile.oltStr("certificationStatus") == "verified"
            OltCard(accent = if (!profile.optBoolean("active")) OltGray else if (verified) IspGreen else IspAmber) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(profile.text("manufacturer", ""), style = MaterialTheme.typography.labelSmall)
                        Text(profile.text("model", ""), fontWeight = FontWeight.Bold)
                        OltMono(profile.text("firmwarePattern", ""))
                    }
                    OltPill(CAP_STATUSES.toMap()[profile.oltStr("certificationStatus")] ?: profile.text("certificationStatus", ""), if (verified) IspGreen else IspAmber)
                }
                Row { OltField("OLT", "${profile.text("oltVendor", "")} ${profile.text("oltModel", "")}", Modifier.weight(1f)); OltField("Tipo autorizado", profile.text("oltOnuType", ""), Modifier.weight(1f), mono = true) }
                Row {
                    OltField("Serial", profile.optJSONArray("serialPrefixes").oltStrings().joinToString(", ").ifBlank { "Sin prefijo" }, Modifier.weight(1f), mono = true)
                    OltField("Gestión", omciLabel(profile.oltStr("omciMode")) + if (profile.oltStr("tr069ProfileKey") != null) " + TR-069" else "", Modifier.weight(1f))
                }
                Text("${caps.count { it.oltStr("status") == "verified" }}/${caps.size} funciones verificadas · ${profile.optInt("deviceCount")} ONU instaladas · v${profile.optInt("version")}", style = MaterialTheme.typography.bodySmall)
                if (!profile.optBoolean("active")) Text("Archivado", color = OltGray, style = MaterialTheme.typography.labelSmall)
                if (ctx.admin) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { modelEditor = profile }, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(4.dp)); Text("Editar") }
                    TextButton(onClick = { if (profile.optBoolean("active")) archiveModel = profile else toggleModel(profile) }, modifier = Modifier.heightIn(min = 44.dp)) { Text(if (profile.optBoolean("active")) "Archivar" else "Activar") }
                }
            }
        }

        // Sincronizacion comercial (plan-sync)
        if (ctx.admin) {
            item {
                HorizontalDivider()
                OltSectionTitle("Perfiles de aprovisionamiento", "Plantillas aprobadas para VLAN, modelo y velocidad.") {
                    TextButton(onClick = ::loadPlanSync, enabled = !planLoading) { Text("Comparar catálogos") }
                }
            }
            if (planLoading && planSync == null) item { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Consultando WispHub, MikroTik y ZTE C320...", style = MaterialTheme.typography.bodySmall) }
            planSync?.let { sync ->
                val summary = sync.optJSONObject("summary") ?: JSONObject()
                item {
                    OltCard {
                        OltSectionTitle("Sincronización comercial", "Solo velocidades simétricas presentes tanto en WispHub como en MikroTik.")
                        Row {
                            OltField("Comunes", summary.optInt("commonSpeeds").toString(), Modifier.weight(1f))
                            OltField("Listas", summary.optInt("ready").toString(), Modifier.weight(1f), IspGreen)
                            OltField("Faltantes", summary.optInt("missing").toString(), Modifier.weight(1f), if (summary.optInt("missing") > 0) IspAmber else androidx.compose.ui.graphics.Color.Unspecified)
                        }
                        val plans = sync.optJSONArray("plans").objects()
                        if (plans.isEmpty()) Text("No se encontraron velocidades válidas en ambos sistemas.", style = MaterialTheme.typography.bodySmall)
                        plans.forEach { plan ->
                            HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("${plan.optInt("speedMbps")} Mbps", fontWeight = FontWeight.Bold)
                                    val names = plan.optJSONArray("wisphubPlans").objects()
                                    Text((names.firstOrNull()?.text("name", "") ?: "") + if (names.size > 1) " +${names.size - 1} nombres equivalentes" else "", style = MaterialTheme.typography.bodySmall)
                                    Text("${plan.optInt("mikrotikQueues")} clientes MikroTik", style = MaterialTheme.typography.bodySmall)
                                    OltMono("↑ ${plan.text("tcontProfile", "")} · ↓ ${plan.text("trafficProfile", "")}")
                                }
                                OltPill(if (plan.oltStr("status") == "ready") "Lista" else "Falta crear", if (plan.oltStr("status") == "ready") IspGreen else IspAmber)
                            }
                        }
                        if (summary.optInt("missing") > 0) Button(onClick = { planConfirm = true }, enabled = !planSaving, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text(if (planSaving) "Creando y verificando..." else "Crear ${summary.optInt("missing")} perfiles faltantes")
                        }
                    }
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Button(onClick = { profileEditor = JSONObject() }, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Outlined.Add, null); Text("Nuevo perfil") }
                    Spacer(Modifier.weight(1f))
                    Text("Ver archivados", style = MaterialTheme.typography.bodySmall); Switch(showArchived, { showArchived = it })
                }
            }
        } else item { OltSectionTitle("Perfiles de aprovisionamiento", "Plantillas aprobadas para VLAN, modelo y velocidad.") }
        item { ReadStatus(profilesState) { ctx.vm.load(profilesPath, true) } }
        if (profiles.isEmpty() && !profilesState.loading) item { EmptyState("Aún no hay perfiles guardados.") }
        items(profiles, key = { "profile-" + it.optInt("id") }) { profile ->
            OltCard(accent = if (profile.optBoolean("active")) IspGreen else OltGray) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(profile.text("name", ""), fontWeight = FontWeight.Bold)
                        if (profile.optBoolean("isDefault")) Text("Predeterminado", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                    }
                    OltPill(if (profile.optBoolean("active")) "Activo" else "Archivado", if (profile.optBoolean("active")) IspGreen else OltGray)
                }
                Row { OltField("Modelo / fabricante", "${profile.oltStr("onuType") ?: "Cualquier modelo"} · ${profile.oltStr("vendorPrefix") ?: "Cualquier serial"}", Modifier.weight(1f)); OltField("VLAN", profile.optInt("vlan").toString()) }
                Row { OltField("Subida", profile.text("tcontProfile", ""), Modifier.weight(1f), mono = true); OltField("Bajada", profile.text("trafficProfile", ""), Modifier.weight(1f), mono = true) }
                Text("Modo ${if (profile.oltStr("serviceMode") == "bridge") "Bridge" else "Router"} · LAN ${profile.optJSONArray("lanPorts")?.let { arr -> (0 until arr.length()).joinToString(", ") { arr.optInt(it).toString() } } ?: "1"}", style = MaterialTheme.typography.bodySmall)
                if (ctx.admin) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { profileEditor = profile }, modifier = Modifier.heightIn(min = 44.dp)) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(4.dp)); Text("Editar") }
                    TextButton(onClick = {
                        val active = profile.optBoolean("active")
                        scope.launch {
                            try { ctx.write("PATCH", "/olt-api/profiles/${profile.optInt("id")}", JSONObject().put("active", !active)); ctx.notify(if (active) "Perfil archivado" else "Perfil activado") }
                            catch (error: Exception) { ctx.notify(error.message ?: "No se pudo actualizar el perfil") }
                        }
                    }, modifier = Modifier.heightIn(min = 44.dp)) { Text(if (profile.optBoolean("active")) "Archivar" else "Activar") }
                }
            }
        }
    }

    if (planConfirm) planSync?.let { sync ->
        var typed by remember { mutableStateOf("") }
        val required = sync.oltStr("requiredConfirmation") ?: "SINCRONIZAR PLANES"
        OltFullDialog(title = "Crear perfiles de velocidad", eyebrow = "Sincronización comercial", closeEnabled = !planSaving, onClose = { planConfirm = false }, footer = {
            OutlinedButton(onClick = { planConfirm = false }, enabled = !planSaving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
            Button(onClick = {
                planSaving = true
                scope.launch {
                    try {
                        val result = ctx.write("POST", "/olt-api/profiles/plan-sync", JSONObject().put("confirmation", typed.trim()))
                        if (result.optBoolean("ok")) {
                            result.optJSONObject("preview")?.let { planSync = it }
                            ctx.notify(if (result.optBoolean("changed")) "Perfiles creados y verificados en la OLT" else "Los perfiles ya estaban sincronizados")
                            planConfirm = false
                        } else ctx.notify("El servidor no confirmó la sincronización")
                    } catch (error: Exception) { ctx.notify(error.message ?: "No se pudieron sincronizar los perfiles") } finally { planSaving = false }
                }
            }, enabled = !planSaving && oltConfirmed(required, typed), modifier = Modifier.heightIn(min = 48.dp)) { Text(if (planSaving) "Creando y verificando..." else "Crear y verificar") }
        }) {
            Text("¿Crear ${sync.optJSONObject("summary")?.optInt("missing") ?: 0} perfiles de velocidad en la OLT? Se escribirán en la ZTE C320 y se verificarán al terminar.")
            OltTypedConfirmation(required, typed, { typed = it }, enabled = !planSaving)
        }
    }
    archiveModel?.let { profile ->
        OltConfirmDialog("¿Archivar el tipo ${profile.text("manufacturer", "")} ${profile.text("model", "")}? Dejará de sugerirse al autorizar ONU nuevas.", "Archivar",
            onDismiss = { archiveModel = null }) { archiveModel = null; toggleModel(profile) }
    }
    modelEditor?.let { OltModelEditor(ctx, it) { modelEditor = null } }
    profileEditor?.let { OltProfileEditor(ctx, it) { profileEditor = null } }
}

@Composable
private fun OltModelEditor(ctx: OltCtx, source: JSONObject, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val editingId = source.oltInt("id")
    var manufacturer by remember { mutableStateOf(source.oltStr("manufacturer") ?: "") }
    var model by remember { mutableStateOf(source.oltStr("model") ?: "") }
    var firmware by remember { mutableStateOf(source.oltStr("firmwarePattern") ?: "*") }
    var prefixes by remember { mutableStateOf(source.optJSONArray("serialPrefixes").oltStrings().joinToString(", ")) }
    var ponType by remember { mutableStateOf(source.oltStr("ponType") ?: "GPON") }
    var certification by remember { mutableStateOf(source.oltStr("certificationStatus") ?: "detected") }
    var oltVendor by remember { mutableStateOf(source.oltStr("oltVendor") ?: "ZTE") }
    var oltModel by remember { mutableStateOf(source.oltStr("oltModel") ?: "C320") }
    var oltOnuType by remember { mutableStateOf(source.oltStr("oltOnuType") ?: "") }
    var vlan by remember { mutableStateOf((source.optJSONObject("defaults")?.oltInt("vlan") ?: 101).toString()) }
    var omciMode by remember { mutableStateOf(source.oltStr("omciMode") ?: "baseline") }
    var tr069 by remember { mutableStateOf(source.oltStr("tr069ProfileKey") ?: "") }
    var extended by remember { mutableStateOf(source.optBoolean("extendedOmci")) }
    var notes by remember { mutableStateOf(source.oltStr("notes") ?: "") }
    val capabilities = remember { mutableStateListOf<JSONObject>().apply { addAll(source.optJSONArray("capabilities").objects().map { JSONObject(it.toString()) }.ifEmpty { defaultCapabilities() }) } }
    var saving by remember { mutableStateOf(false) }

    fun save() {
        if (saving) return
        if (manufacturer.isBlank() || model.isBlank() || oltOnuType.isBlank()) { ctx.notify("Complete fabricante, modelo y tipo ONU de la OLT"); return }
        val payload = JSONObject().put("manufacturer", manufacturer.trim()).put("model", model.trim()).put("firmwarePattern", firmware.trim().ifBlank { "*" })
            .put("serialPrefixes", JSONArray(prefixes.split(Regex("[\\s,;]+")).map { it.trim().uppercase() }.filter { it.isNotBlank() }))
            .put("ponType", ponType).put("oltVendor", oltVendor.trim().ifBlank { "ZTE" }).put("oltModel", oltModel.trim().ifBlank { "C320" }).put("oltOnuType", oltOnuType.trim())
            .put("omciMode", omciMode).put("extendedOmci", extended).put("tr069ProfileKey", tr069.trim().ifBlank { null } ?: JSONObject.NULL)
            .put("certificationStatus", certification).put("active", source.optBoolean("active", true)).put("notes", notes.trim().ifBlank { null } ?: JSONObject.NULL)
            .put("defaults", JSONObject().put("vlan", vlan.toIntOrNull() ?: 0).put("wanMode", "static").put("dataModel", "InternetGatewayDevice"))
            .put("capabilities", JSONArray(capabilities.map { JSONObject(it.toString()).apply { remove("id") } }))
        if (editingId != null) payload.put("changeReason", "Actualizacion desde el catalogo de modelos")
        saving = true
        scope.launch {
            try {
                val profile = if (editingId != null) ctx.write("PATCH", "/olt-api/model-profiles/$editingId", payload) else ctx.write("POST", "/olt-api/model-profiles", payload)
                ctx.notify("Perfil ${profile.text("manufacturer", manufacturer)} ${profile.text("model", model)} guardado"); close()
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo guardar el perfil") } finally { saving = false }
        }
    }

    OltFullDialog(title = "Tipo de ONU", eyebrow = if (editingId != null) "Versionar perfil" else "Nuevo perfil", closeEnabled = !saving, onClose = close, footer = {
        OutlinedButton(onClick = close, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        Button(onClick = ::save, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (saving) "Guardando..." else "Guardar perfil") }
    }) {
        Text("Hardware, compatibilidad OLT y canales de administración.", style = MaterialTheme.typography.bodySmall)
        OltSectionTitle("Identidad del equipo", "Datos utilizados para seleccionar el perfil automáticamente.")
        OutlinedTextField(manufacturer, { manufacturer = it }, singleLine = true, label = { Text("Fabricante") }, placeholder = { Text("ZTE") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(model, { model = it }, singleLine = true, label = { Text("Modelo") }, placeholder = { Text("F670L") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(firmware, { firmware = it }, singleLine = true, label = { Text("Firmware") }, placeholder = { Text("V7.1*") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(prefixes, { prefixes = it }, singleLine = true, label = { Text("Prefijos de serial") }, placeholder = { Text("ZXIC, ZTEG") }, modifier = Modifier.fillMaxWidth())
        OltSelect("Tipo PON", ponType, listOf("GPON", "EPON", "XGPON", "XGSPON").map { it to it }) { ponType = it }
        OltSelect("Estado", certification, listOf("detected" to "Detectado", "verified" to "Verificado", "failed" to "Con fallo", "blocked" to "Bloqueado")) { certification = it }
        OltSectionTitle("Compatibilidad y red", "El tipo OLT es independiente del nombre y la IP de cada cliente.")
        OutlinedTextField(oltVendor, { oltVendor = it }, singleLine = true, label = { Text("Fabricante OLT") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(oltModel, { oltModel = it }, singleLine = true, label = { Text("Modelo OLT") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(oltOnuType, { oltOnuType = it }, singleLine = true, label = { Text("Tipo ONU en OLT") }, placeholder = { Text("F670L") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vlan, { vlan = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text("VLAN predeterminada") }, modifier = Modifier.fillMaxWidth())
        OltSelect("Modo OMCI", omciMode, listOf("baseline" to "Base", "extended" to "Extendido", "vendor" to "Propietario")) { omciMode = it }
        OutlinedTextField(tr069, { tr069 = it }, singleLine = true, label = { Text("Perfil TR-069 (opcional)") }, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(extended, { extended = it }); Text("La OLT y este firmware soportan OMCI extendido", style = MaterialTheme.typography.bodySmall) }
        OutlinedTextField(notes, { notes = it }, label = { Text("Notas") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        OltSectionTitle("Matriz de capacidades", "Una función bloqueada nunca se ejecutará aunque aparezca en el equipo.")
        capabilities.forEachIndexed { index, capability ->
            val action = capability.optString("action")
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(CAPABILITY_LABELS[action] ?: action.replace("_", " "), fontWeight = FontWeight.SemiBold); OltMono(action)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OltSelect("Canal", capability.optString("channel"), CHANNELS, Modifier.weight(1f)) { capabilities[index] = JSONObject(capability.toString()).put("channel", it) }
                    OltSelect("Estado", capability.optString("status"), CAP_STATUSES, Modifier.weight(1f)) { capabilities[index] = JSONObject(capability.toString()).put("status", it) }
                }
            }
        }
    }
}

@Composable
private fun OltProfileEditor(ctx: OltCtx, source: JSONObject, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val editingId = source.oltInt("id")
    var name by remember { mutableStateOf(source.oltStr("name") ?: "") }
    var onuType by remember { mutableStateOf(source.oltStr("onuType") ?: "") }
    var vendorPrefix by remember { mutableStateOf(source.oltStr("vendorPrefix") ?: "") }
    var vlan by remember { mutableStateOf((source.oltInt("vlan") ?: 101).toString()) }
    var tcont by remember { mutableStateOf(source.oltStr("tcontProfile") ?: "") }
    var traffic by remember { mutableStateOf(source.oltStr("trafficProfile") ?: "") }
    var isDefault by remember { mutableStateOf(source.optBoolean("isDefault")) }
    var serviceMode by remember { mutableStateOf(source.oltStr("serviceMode") ?: "router") }
    var lanPorts by remember { mutableStateOf(source.optJSONArray("lanPorts")?.let { arr -> (0 until arr.length()).map { arr.optInt(it) }.toSet() }?.ifEmpty { null } ?: setOf(1)) }
    var saving by remember { mutableStateOf(false) }

    fun save() {
        if (saving) return
        val payload = JSONObject().put("name", name).put("onuType", onuType).put("vlan", vlan.toIntOrNull() ?: 0).put("tcontProfile", tcont).put("trafficProfile", traffic)
            .put("isDefault", isDefault).put("serviceMode", serviceMode).put("lanPorts", JSONArray(lanPorts.sorted()))
        if (editingId == null) payload.put("vendorPrefix", vendorPrefix) else if (onuType.isBlank()) payload.put("onuType", JSONObject.NULL)
        saving = true
        scope.launch {
            try {
                val profile = if (editingId != null) ctx.write("PATCH", "/olt-api/profiles/$editingId", payload) else ctx.write("POST", "/olt-api/profiles", payload)
                ctx.notify("Perfil ${profile.text("name", name)} guardado"); close()
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo guardar el perfil") } finally { saving = false }
        }
    }

    OltFullDialog(title = if (editingId != null) "Editar perfil" else "Nuevo perfil", eyebrow = "Perfiles de aprovisionamiento", closeEnabled = !saving, onClose = close, footer = {
        OutlinedButton(onClick = close, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") }
        Button(onClick = ::save, enabled = !saving && name.isNotBlank() && tcont.isNotBlank() && traffic.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) { Text(if (saving) "Guardando..." else "Guardar perfil") }
    }) {
        OutlinedTextField(name, { name = it }, singleLine = true, label = { Text("Nombre") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(onuType, { onuType = it }, singleLine = true, label = { Text("Modelo ONU") }, placeholder = { Text("Cualquier modelo") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vendorPrefix, { vendorPrefix = it.take(8) }, singleLine = true, enabled = editingId == null, label = { Text("Prefijo SN") },
            supportingText = if (editingId != null) ({ Text("El servidor no permite cambiar el prefijo de un perfil existente.") }) else null, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(vlan, { vlan = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text("VLAN") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(tcont, { tcont = it }, singleLine = true, label = { Text("Perfil subida") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(traffic, { traffic = it }, singleLine = true, label = { Text("Perfil bajada") }, modifier = Modifier.fillMaxWidth())
        OltSelect("Modo de servicio", serviceMode, listOf("router" to "Router · IP/NAT", "bridge" to "Bridge · Ethernet")) { serviceMode = it }
        Text("Puertos LAN", style = MaterialTheme.typography.labelMedium)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (1..4).forEach { lan -> FilterChip(selected = lan in lanPorts, onClick = { lanPorts = if (lan in lanPorts && lanPorts.size > 1) lanPorts - lan else lanPorts + lan }, label = { Text("LAN$lan") }) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(isDefault, { isDefault = it }); Text("Predeterminado") }
    }
}

// ---------------- Alarmas ----------------

@Composable
internal fun OltAlarmsTab(ctx: OltCtx, onInspect: (JSONObject) -> Unit) {
    var filter by remember { mutableStateOf("all") }
    val alarms = ctx.items(OltPaths.ALARMS)
    val signalAlerts = ctx.items(OltPaths.SIGNAL)
    val byIndex = ctx.items(OltPaths.MAP).associateBy { it.text("onuIndex", "") }
    val visibleSignal = if (filter == "chassis") emptyList() else signalAlerts.filter { filter != "critical" || it.oltStr("severity") == "critical" }
    val visibleAlarms = if (filter == "signal") emptyList() else alarms.filter { filter != "critical" || it.oltStr("level") == "critical" }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OltSectionTitle("Alarmas activas", "Eventos del chasis y degradación calculada desde el historial óptico.") {
                ExportButton(oltAlarmCsvRows(visibleSignal, visibleAlarms, byIndex), "alarmas_olt")
            }
        }
        item {
            OltChips(listOf(
                Triple("all", "Todas", alarms.size + signalAlerts.size),
                Triple("critical", "Críticas", alarms.count { it.oltStr("level") == "critical" } + signalAlerts.count { it.oltStr("severity") == "critical" }),
                Triple("signal", "Señal óptica", signalAlerts.size), Triple("chassis", "Chasis OLT", alarms.size),
            ), filter) { filter = it }
        }
        item { ReadStatus(ctx.page(OltPaths.ALARMS)) { ctx.vm.load(OltPaths.ALARMS, true); ctx.vm.load(OltPaths.SIGNAL, true) } }
        items(visibleSignal, key = { "sig-" + it.optInt("id") }) { alert ->
            val critical = alert.oltStr("severity") == "critical"
            val target = byIndex[alert.text("onuIndex", "")]
            OltCard(accent = if (critical) IspRed else IspAmber, onClick = target?.let { { onInspect(it) } }) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Speed, null, tint = if (critical) IspRed else IspAmber)
                    OltPill(oltAlarmLevel(alert.oltStr("severity")), if (critical) IspRed else IspAmber)
                    Spacer(Modifier.weight(1f)); Text(oltAgo(alert.oltStr("lastSeenAt")), style = MaterialTheme.typography.labelSmall)
                }
                Text(alert.text("message", ""), fontWeight = FontWeight.SemiBold)
                Text(listOfNotNull(target?.let { oltOnuName(it) }, "ONU ${alert.text("onuIndex", "")}", "${alert.optInt("occurrenceCount")} detecciones",
                    alert.oltNum("currentValue")?.let { "actual ${oltNumText(it)} dBm" + (alert.oltNum("baselineValue")?.let { base -> " (antes ${oltNumText(base)} dBm)" } ?: "") }).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        items(visibleAlarms, key = { "alarm-" + it.text("alarmId", it.optInt("id").toString()) }) { alarm ->
            val level = alarm.oltStr("level")
            val color = when (level) { "critical" -> IspRed; "major" -> IspAmber; else -> IspBlue }
            OltCard(accent = color) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.WarningAmber, null, tint = color)
                    OltPill(oltAlarmLevel(level), color)
                    Spacer(Modifier.weight(1f)); Text(alarm.oltStr("alarmTime") ?: oltDate(alarm.oltStr("lastSeenAt")), style = MaterialTheme.typography.labelSmall)
                }
                Text(alarm.text("description", ""), fontWeight = FontWeight.SemiBold)
                Text("ID ${alarm.text("alarmId", "")} · Código ${alarm.oltStr("code") ?: "--"}", style = MaterialTheme.typography.bodySmall)
            }
        }
        if ((alarms.isNotEmpty() || signalAlerts.isNotEmpty()) && visibleAlarms.isEmpty() && visibleSignal.isEmpty()) item { EmptyState("No hay alarmas en este filtro. Elija «Todas».") }
        if (alarms.isEmpty() && signalAlerts.isEmpty() && ctx.pages[OltPaths.ALARMS]?.body != null) item {
            OltCard { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen); Column { Text("Sin alarmas activas", fontWeight = FontWeight.Bold); Text("La OLT no reporta eventos pendientes.", style = MaterialTheme.typography.bodySmall) } } }
        }
    }
}

// ---------------- Bitacora ----------------

@Composable
internal fun OltActivityTab(ctx: OltCtx) {
    val state = ctx.page(OltPaths.ACTIVITY)
    val rows = ctx.items(OltPaths.ACTIVITY)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { OltSectionTitle("Bitácora OLT", "Operaciones manuales ejecutadas por los usuarios del sistema.") }
        item { ReadStatus(state) { ctx.vm.load(OltPaths.ACTIVITY, true) } }
        if (rows.isEmpty() && !state.loading) item { EmptyState("Aún no existen operaciones manuales registradas.") }
        items(rows, key = { "act-" + it.optInt("id") }) { event ->
            OltCard {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(oltActivityLabel(event.optString("action")), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text(oltDate(event.oltStr("createdAt")), style = MaterialTheme.typography.labelSmall)
                }
                OltMono(event.oltStr("entityId") ?: event.oltStr("entityName") ?: "--")
                Text("${event.optJSONObject("details")?.oltStr("actor") ?: "Sistema"} · ${oltActivityDetail(event)}", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
