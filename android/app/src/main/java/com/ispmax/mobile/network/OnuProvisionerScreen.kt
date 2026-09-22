package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
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

/**
 * «Configurar ONU»: centro de agentes ONU Studio. Replica src/app/pages/onu-provisioner de la web
 * (operación guiada, agentes, historial) y agrega los expedientes y reservas IP de /provisioning.
 * Mismas rutas, permisos (tecnico para operar, admin para administrar agentes y expedientes) y confirmaciones.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OnuProvisionerScreen(vm: MainViewModel, pages: Map<String, PageState>, onLocalProbe: () -> Unit) {
    val app by vm.app.collectAsState()
    val role = app.user?.optString("role")
    val canUse = tr069HasRole(role, "tecnico")
    val canManage = tr069HasRole(role, "admin")
    val scope = rememberCoroutineScope()
    val controller = remember(vm) { OnuProvisionerController(vm, scope) }

    // La web vuelve a leer agentes y trabajos cada 4 segundos.
    LaunchedEffect(canUse) {
        if (!canUse) return@LaunchedEffect
        vm.load(ONU_MANIFEST_PATH, true); vm.load(ONU_JOBS_PATH, true)
        while (true) { vm.load(ONU_AGENTS_PATH, true); vm.load(ONU_TASKS_PATH, true); delay(4000) }
    }
    val agentsState = pages[ONU_AGENTS_PATH] ?: PageState(loading = true)
    val tasksState = pages[ONU_TASKS_PATH] ?: PageState(loading = true)
    LaunchedEffect(agentsState.body, tasksState.body) {
        controller.update(agentsState.body?.optJSONArray("items")?.objects(), tasksState.body?.optJSONArray("items")?.objects())
    }
    val manifest = pages[ONU_MANIFEST_PATH]?.body
    val latestVersion = manifest?.trText("version")

    if (!canUse) { Column(Modifier.fillMaxSize().padding(16.dp)) { Notice("Permisos insuficientes: Configurar ONU requiere rol técnico o superior.", true) }; return }

    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Centro de agentes ONU", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text("Opera equipos conectados a cualquier PC autorizada sin exponer la red local.", style = MaterialTheme.typography.bodySmall)
                }
                IconButton(onClick = { controller.refreshAll() }, enabled = !agentsState.loading) { Icon(Icons.Outlined.Refresh, "Actualizar datos") }
            }
            OutlinedButton(onClick = onLocalProbe, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Router, null); Spacer(Modifier.width(8.dp)); Text("Prueba local desde este teléfono") }
            controller.error?.let { Tr069Banner(it, true) { controller.error = null } }
            controller.notice?.let { Tr069Banner(it, false) { controller.notice = null } }
            if (agentsState.error != null && agentsState.body == null) { Notice(agentsState.error, true); TextButton(onClick = { controller.refreshAll() }) { Text("Reintentar") } }
        }
        val tabs = listOf("operation" to "Operación", "agents" to "Agentes ${controller.onlineCount}/${controller.authorizedCount}", "history" to "Historial", "jobs" to "Expedientes", "reservations" to "Reservas IP")
        ScrollableTabRow(selectedTabIndex = tabs.indexOfFirst { it.first == controller.tab }.coerceAtLeast(0), edgePadding = 8.dp) {
            tabs.forEach { (id, label) -> Tab(selected = controller.tab == id, onClick = { controller.tab = id }, text = { Text(label) }) }
        }
        if (agentsState.loading && agentsState.body == null) {
            Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) { CircularProgressIndicator(); Spacer(Modifier.height(8.dp)); Text("Conectando con los agentes") }
        } else when (controller.tab) {
            "operation" -> OnuOperationTab(controller, manifest, latestVersion)
            "agents" -> OnuAgentsTab(controller, canManage, manifest)
            "history" -> OnuHistoryTab(controller)
            "jobs" -> OnuJobsTab(vm, pages, canManage)
            else -> OnuReservationsTab(vm, pages, canManage, app.user?.optString("username"))
        }
    }
    if (controller.showOperation) OnuProvisionerWizard(controller)
}

@Composable private fun OnuOperationTab(controller: OnuProvisionerController, manifest: JSONObject?, latestVersion: String?) {
    val agent = controller.selectedAgent
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("Agentes disponibles", fontWeight = FontWeight.Bold); Text("Selecciona la PC conectada a la ONU · ${controller.onlineCount} en línea", style = MaterialTheme.typography.bodySmall)
        }
        if (controller.operationalAgents.isEmpty()) item { EmptyState("No hay agentes vinculados. Descarga ONU Studio en una PC con Windows e inicia sesión con ISP Max.") }
        items(controller.operationalAgents, key = { "op-" + it.optString("id") }) { item ->
            val selected = item.optString("id") == controller.selectedAgentId
            OutlinedCard(onClick = { controller.selectAgent(item.optString("id")) }, modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.outlinedCardColors(containerColor = if (selected) IspGreen.copy(alpha = .08f) else com.ispmax.mobile.ui.ispCardColor())) {
                ListItem(colors = ListItemDefaults.colors(containerColor = Color.Transparent),
                    leadingContent = { RadioButton(selected = selected, onClick = { controller.selectAgent(item.optString("id")) }) },
                    headlineContent = { Text(item.optString("displayName"), fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("${item.trText("windowsUser") ?: item.trText("hostname") ?: item.optString("agentId")}\nv${item.trText("version") ?: "--"} · ${onuSeenAgo(item.trText("lastSeenAt"))}") },
                    trailingContent = { OnuStateDot(item.optBoolean("online"), if (item.optBoolean("online")) "Conectado" else "Desconectado") })
            }
        }
        if (agent == null) {
            item {
                OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.LaptopWindows, null, tint = IspBlue, modifier = Modifier.size(30.dp))
                    Text("Instala o selecciona un agente", fontWeight = FontWeight.Bold)
                    Text("El sistema enviará el trabajo a la PC que tenga la ONU conectada por cable.", style = MaterialTheme.typography.bodySmall)
                    OnuDownloadInfo(manifest)
                } }
            }
        } else {
            item { OnuDeviceCard(controller, agent) }
            item { OnuReadinessCard(agent, latestVersion) }
            item { OnuWorkflowTrack(agent, controller.activeTask?.optString("status")) }
            item {
                val task = controller.activeTask
                if (task != null) OnuActiveJobCard(controller, agent, task)
                else OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.VerifiedUser, null, tint = IspGreen, modifier = Modifier.size(28.dp))
                    Text(if (agent.optBoolean("online")) "Agente listo para trabajar" else "El agente está desconectado", fontWeight = FontWeight.Bold)
                    Text(if (agent.optBoolean("online")) "La operación se ejecutará dentro de esta PC y el progreso aparecerá aquí." else "Enciende ONU Studio en esa computadora para continuar.", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { controller.openOperation("check") }, enabled = agent.optBoolean("online"), modifier = Modifier.weight(1f)) { Text("Comprobar acceso") }
                        Button(onClick = { controller.openOperation("provision") }, enabled = agent.optBoolean("online"), modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.PlayArrow, null); Text("Configurar ONU") }
                    }
                } }
            }
            item {
                Text("Actividad en vivo", fontWeight = FontWeight.Bold); Text("Eventos del agente seleccionado", style = MaterialTheme.typography.bodySmall)
            }
            val events = controller.activity()
            if (events.isEmpty()) item { EmptyState("La actividad aparecerá cuando el agente reciba un trabajo.") }
            items(events) { event -> OnuEventRow(event) }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) { Text("Historial de trabajos", fontWeight = FontWeight.Bold); Text("Últimas operaciones de todos los agentes", style = MaterialTheme.typography.bodySmall) }
                TextButton(onClick = { controller.tab = "history" }) { Text("Ver todos") }
            }
        }
        items(controller.tasks.take(6), key = { "prev-" + it.optString("id") }) { OnuTaskRow(controller, it) }
    }
}

@Composable internal fun OnuStateDot(ok: Boolean, label: String, warn: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(9.dp).background(if (ok) IspGreen else if (warn) IspAmber else IspRed, MaterialTheme.shapes.extraLarge)); Spacer(Modifier.width(5.dp))
        Text(label, style = MaterialTheme.typography.labelSmall)
    }
}

@Composable private fun OnuDeviceCard(controller: OnuProvisionerController, agent: JSONObject) {
    val discovery = agent.optJSONObject("discovery"); val device = discovery?.optJSONObject("device")
    val detected = discovery?.optBoolean("detected") == true
    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (detected) Icons.Outlined.CheckCircle else Icons.Outlined.Router, null, tint = if (detected) IspGreen else IspAmber); Spacer(Modifier.width(8.dp))
            Column(Modifier.weight(1f)) {
                Text(if (detected) "ONU detectada" else "Esperando detección", fontWeight = FontWeight.Bold)
                Text(discovery?.trText("next_action") ?: "Conecta la ONU por Ethernet al agente seleccionado.", style = MaterialTheme.typography.bodySmall)
            }
        }
        Row { Tr069Fact("Modelo", device?.trText("model") ?: "Sin identificar", Modifier.weight(1f)); Tr069Fact("IP de gestión", device?.trText("host") ?: "Sin respuesta", Modifier.weight(1f), mono = true) }
        Row {
            Tr069Fact("Adaptador", device?.trText("adapter_name") ?: "Pendiente", Modifier.weight(1f))
            Tr069Fact("Latencia", device?.trText("latency_ms")?.let { "$it ms" } ?: "--", Modifier.weight(1f))
        }
        Tr069Fact("Permisos", if (agent.optBoolean("isAdmin")) "Administrador" else "Limitados")
        OutlinedButton(onClick = { controller.detectOnu() }, enabled = !controller.creatingTask && agent.optBoolean("online"), modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(6.dp)); Text("Actualizar detección")
        }
    } }
}

@Composable private fun OnuReadinessCard(agent: JSONObject, latestVersion: String?) {
    val checks = onuReadinessChecks(agent, latestVersion)
    val pending = checks.count { !it.ok && !it.optional }
    OutlinedCard(Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = if (pending == 0) IspGreen.copy(alpha = .06f) else IspAmber.copy(alpha = .06f))) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(if (pending == 0) "Listo para configurar" else "Antes de empezar: $pending ${if (pending == 1) "punto pendiente" else "puntos pendientes"}", fontWeight = FontWeight.Bold)
                    Text("Última señal del agente ${onuSeenAgo(agent.trText("lastSeenAt"))}", style = MaterialTheme.typography.labelSmall)
                }
                Text("${checks.count { it.ok }}/${checks.size}", fontWeight = FontWeight.Bold, color = if (pending == 0) IspGreen else IspAmber)
            }
            checks.forEach { check ->
                Row(verticalAlignment = Alignment.Top) {
                    Icon(if (check.ok) Icons.Outlined.CheckCircle else Icons.Outlined.ErrorOutline, null, Modifier.size(18.dp), tint = if (check.ok) IspGreen else if (check.optional) IspAmber else IspRed)
                    Spacer(Modifier.width(8.dp))
                    Column { Text(check.label, style = MaterialTheme.typography.labelLarge); Text(check.detail, style = MaterialTheme.typography.bodySmall) }
                }
            }
        }
    }
}

@Composable private fun OnuWorkflowTrack(agent: JSONObject, status: String?) {
    val detected = agent.optJSONObject("discovery")?.optBoolean("detected") == true
    val steps = listOf("Agente" to true, "Detectar" to detected, "Servicio" to (status == "processing" || status == "success"), "Configurar" to (status == "success"), "Verificar" to (status == "success"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        steps.forEachIndexed { index, (label, done) ->
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.size(26.dp).background(if (done) IspGreen else MaterialTheme.colorScheme.surfaceVariant, MaterialTheme.shapes.extraLarge), contentAlignment = Alignment.Center) {
                    if (done) Icon(Icons.Outlined.Check, null, tint = Color.White, modifier = Modifier.size(16.dp)) else Text("${index + 1}", style = MaterialTheme.typography.labelSmall)
                }
                Text(label, style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}

@Composable private fun OnuActiveJobCard(controller: OnuProvisionerController, agent: JSONObject, task: JSONObject) {
    val status = task.optString("status")
    val payload = task.optJSONObject("payload") ?: JSONObject()
    val tone = when (status) { "failed" -> IspRed; "success" -> IspGreen; else -> IspBlue }
    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(onuStatusLabel(status), style = MaterialTheme.typography.labelSmall, color = tone); Text(task.trText("stageLabel") ?: onuActionLabel(task.optString("action")), fontWeight = FontWeight.Bold) }
            Text("${task.optInt("progress")}%", fontWeight = FontWeight.Bold, color = tone)
        }
        LinearProgressIndicator(progress = { task.optInt("progress") / 100f }, modifier = Modifier.fillMaxWidth(), color = tone)
        Row { Tr069Fact("Operación", onuActionLabel(task.optString("action")), Modifier.weight(1f)); Tr069Fact("Equipo", payload.trPathText("device.model", agent.trPathText("discovery.device.model")), Modifier.weight(1f)) }
        Row { Tr069Fact("IP WAN", payload.trPathText("wan.ip_address"), Modifier.weight(1f), mono = true); Tr069Fact("VLAN", payload.trPathText("wan.vlan_id"), Modifier.weight(1f)) }
        Row { Tr069Fact("WiFi", payload.trPathText("wifi.ssid"), Modifier.weight(1f)); Tr069Fact("Expediente", task.trText("cloudJobId")?.take(10) ?: "Operación local", Modifier.weight(1f), mono = true) }
        task.trText("errorMessage")?.let { Notice(it, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (status == "pending") Button(onClick = { controller.cancelTask(task) }, colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)) { Text("Cancelar trabajo") }
            if (status == "failed" || status == "cancelled") OutlinedButton(onClick = { controller.retryTask(task) }) { Icon(Icons.Outlined.Refresh, null); Text("Reintentar") }
            if (status !in listOf("pending", "processing")) Button(onClick = { controller.openOperation("provision") }, enabled = agent.optBoolean("online")) { Icon(Icons.Outlined.PlayArrow, null); Text("Nueva operación") }
        }
    } }
}

@Composable internal fun OnuEventRow(event: JSONObject) {
    val status = event.optString("status")
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        Text(tr069Time(event.trText("at")), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace, modifier = Modifier.width(62.dp))
        Box(Modifier.padding(top = 4.dp).size(8.dp).background(when (status) { "error" -> IspRed; "success" -> IspGreen; else -> IspBlue }, MaterialTheme.shapes.extraLarge))
        Spacer(Modifier.width(8.dp))
        Column { Text(event.optString("message"), style = MaterialTheme.typography.bodyMedium); Text(event.optString("step"), style = MaterialTheme.typography.labelSmall) }
    }
}

@Composable private fun OnuTaskRow(controller: OnuProvisionerController, task: JSONObject) {
    val status = task.optString("status"); val payload = task.optJSONObject("payload") ?: JSONObject()
    OutlinedCard(Modifier.fillMaxWidth()) {
        ListItem(colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            headlineContent = { Text(payload.trPath("device.model")?.toString() ?: onuActionLabel(task.optString("action")), fontWeight = FontWeight.SemiBold) },
            supportingContent = {
                Text("${task.optString("id").take(12)} · ${tr069DateSeconds(task.trText("createdAt"))}\n${task.trText("agentName") ?: "--"} · ${task.optString("createdBy")}\n" +
                    "${payload.trPath("wan.ip_address") ?: payload.trPath("device.host") ?: "--"} · ${onuTaskDuration(task)}", maxLines = 3, overflow = TextOverflow.Ellipsis)
            },
            trailingContent = {
                Column(horizontalAlignment = Alignment.End) {
                    StatusBadge(onuStatusLabel(status))
                    if (status == "failed" || status == "cancelled") IconButton(onClick = { controller.retryTask(task) }) { Icon(Icons.Outlined.Refresh, "Reintentar trabajo") }
                }
            })
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun OnuAgentsTab(controller: OnuProvisionerController, canManage: Boolean, manifest: JSONObject?) {
    var managed by remember { mutableStateOf<Pair<JSONObject, String>?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("Agentes de Windows", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text("Controla qué PC pueden configurar ONU y revisa su conexión con el sistema.", style = MaterialTheme.typography.bodySmall) }
        item {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                AssistChip({}, label = { Text("${controller.authorizedCount} autorizados") }, leadingIcon = { Icon(Icons.Outlined.VerifiedUser, null) })
                AssistChip({}, label = { Text("${controller.onlineCount} conectados") }, leadingIcon = { Icon(Icons.Outlined.Sensors, null) })
                AssistChip({}, label = { Text("${controller.revokedCount} revocados") }, leadingIcon = { Icon(Icons.Outlined.RemoveModerator, null) })
                AssistChip({}, label = { Text("Credenciales protegidas") }, leadingIcon = { Icon(Icons.Outlined.Key, null) })
            }
        }
        if (controller.agents.isEmpty()) item { EmptyState("No hay agentes vinculados todavía.") }
        items(controller.agents, key = { "ag-" + it.optString("id") }) { agent ->
            val active = agent.optBoolean("active")
            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.LaptopWindows, null, tint = if (active) IspBlue else IspRed); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) { Text(agent.optString("displayName"), fontWeight = FontWeight.Bold); Text(agent.optString("agentId"), style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace) }
                    OnuStateDot(agent.optBoolean("online"), onuAgentStateLabel(agent))
                }
                Text(if (active) (if (agent.optBoolean("isAdmin")) "Administrador local" else "Sin permisos de administrador") else "Debe iniciar sesión de nuevo como administrador", style = MaterialTheme.typography.bodySmall)
                Text("${agent.trText("osName") ?: "Windows"} · ${agent.trText("architecture") ?: "--"} · v${agent.trText("version") ?: "--"}", style = MaterialTheme.typography.bodySmall)
                Text("Credencial ${agent.trText("tokenFingerprint") ?: "Sin huella"} · ${if (active) "Vinculado ${tr069DateSeconds(agent.trText("pairedAt"))}" else "Revocado por ${agent.trText("revokedBy") ?: "administrador"}"}", style = MaterialTheme.typography.bodySmall)
                Text("Último contacto ${tr069DateSeconds(agent.trText("lastSeenAt"))} · ${agent.trText("lastIp") ?: "IP no reportada"}", style = MaterialTheme.typography.bodySmall)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (active) TextButton(onClick = { controller.selectAgent(agent.optString("id")); controller.tab = "operation" }) { Icon(Icons.Outlined.PlayArrow, null); Text("Operar") }
                    if (canManage) TextButton(onClick = { managed = agent to "rename" }) { Icon(Icons.Outlined.Edit, null); Text("Nombre") }
                    if (canManage && active) TextButton(onClick = { managed = agent to "revoke" }, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) { Icon(Icons.Outlined.RemoveModerator, null); Text("Revocar") }
                }
            } }
        }
        item { Notice("Vinculación controlada: al revocar una PC, su credencial y su sesión recordada dejan de funcionar. Para reconectarla, abre ONU Studio e inicia sesión con un administrador; se emitirá una credencial nueva.") }
        item { OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) { Text("Instalar otra PC", fontWeight = FontWeight.Bold); OnuDownloadInfo(manifest) } } }
    }
    managed?.let { (agent, mode) -> OnuAgentAdminDialog(controller, agent, mode) { managed = null } }
}

@Composable private fun OnuAgentAdminDialog(controller: OnuProvisionerController, agent: JSONObject, mode: String, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    var name by remember(agent) { mutableStateOf(agent.optString("displayName")) }
    var saving by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = { if (!saving) close() },
        title = { Text(if (mode == "revoke") "Revocar agente" else "Identificar agente") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("${agent.optString("displayName")} · ${agent.optString("agentId")}", style = MaterialTheme.typography.bodySmall)
                if (mode == "rename") {
                    OutlinedTextField(name, { if (it.length <= 120) name = it }, label = { Text("Nombre visible de esta PC") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Text("Usa un nombre reconocible, por ejemplo “Laptop técnico norte”.", style = MaterialTheme.typography.bodySmall)
                } else {
                    Text("Esta PC perderá el acceso al sistema", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.error)
                    Text("Se cancelarán sus trabajos activos y ONU Studio solicitará usuario y clave de administrador para emitir una credencial nueva.")
                }
            }
        },
        confirmButton = {
            Button(onClick = {
                saving = true
                scope.launch {
                    val ok = if (mode == "rename") controller.renameAgent(agent, name) else controller.revokeAgent(agent)
                    saving = false; if (ok) close()
                }
            }, enabled = !saving, colors = if (mode == "revoke") ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors()) {
                Text(if (saving) "Guardando..." else if (mode == "revoke") "Revocar acceso" else "Guardar nombre")
            }
        },
        dismissButton = { TextButton(onClick = close, enabled = !saving) { Text("Cancelar") } })
}

/** La web descarga el instalador .exe; en el teléfono solo se muestra la versión publicada para instalarla desde la PC. */
@Composable private fun OnuDownloadInfo(manifest: JSONObject?) {
    if (manifest == null) { Text("El instalador de ONU Studio aún no está publicado.", style = MaterialTheme.typography.bodySmall); return }
    Text("ONU Studio para Windows v${manifest.optString("version")} · ${onuBytes(manifest.optLong("sizeBytes"))}", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    manifest.trText("sha256")?.let { Text("SHA-256 $it", style = MaterialTheme.typography.labelSmall, fontFamily = FontFamily.Monospace) }
    Text("Descárguelo desde ISP Max en la web (Configurar ONU → «Descargar agente para Windows») en la PC que se conectará a la ONU.", style = MaterialTheme.typography.bodySmall)
}

@Composable private fun OnuHistoryTab(controller: OnuProvisionerController) {
    var query by remember { mutableStateOf("") }
    val rows = controller.tasks.filter { task ->
        val q = query.trim().lowercase()
        q.isEmpty() || listOf(task.optString("id"), task.trText("agentName"), task.optString("action"), task.optString("status"), task.trText("cloudJobId"),
            task.optJSONObject("payload")?.trPath("device.model")?.toString(), task.optJSONObject("payload")?.trPath("wifi.ssid")?.toString())
            .any { it.orEmpty().lowercase().contains(q) }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Historial de trabajos", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text("Auditoría centralizada de detecciones, comprobaciones y configuraciones.", style = MaterialTheme.typography.bodySmall) }
        item { OutlinedTextField(query, { query = it }, label = { Text("Buscar agente, ONU, estado o ID") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
        if (rows.isEmpty()) item { EmptyState("No hay trabajos que coincidan con la búsqueda.") }
        items(rows, key = { "h-" + it.optString("id") }) { OnuTaskRow(controller, it) }
    }
}
