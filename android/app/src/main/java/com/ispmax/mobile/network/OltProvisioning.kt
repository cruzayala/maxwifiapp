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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

// ---------------- Centro de autorizacion (ONUs por autorizar) ----------------

private fun isReview(onu: JSONObject): Boolean {
    val relocation = onu.optJSONObject("relocation")
    return onu.oltStr("authorizationStatus") == "review" || (relocation != null && !relocation.optBoolean("allowed"))
}

@Composable
internal fun OltDiscoveredTab(ctx: OltCtx, syncing: Boolean, onSync: () -> Unit, onAuthorize: (JSONObject) -> Unit) {
    var filter by remember { mutableStateOf("all") }
    val state = ctx.page(OltPaths.UNCONFIGURED)
    val rows = ctx.items(OltPaths.UNCONFIGURED)
    val counts = mapOf(
        "all" to rows.size, "new" to rows.count { it.optJSONObject("relocation") == null },
        "relocation" to rows.count { it.optJSONObject("relocation") != null }, "review" to rows.count(::isReview),
    )
    val filtered = rows.filter {
        when (filter) { "new" -> it.optJSONObject("relocation") == null; "relocation" -> it.optJSONObject("relocation") != null; "review" -> isReview(it); else -> true }
    }
    val emptyTitle = mapOf("all" to "Cola de autorización al día", "new" to "Sin ONUs nuevas", "relocation" to "Sin cambios de PON", "review" to "Sin casos por revisar")[filter]!!
    val emptyMessage = mapOf(
        "all" to "No hay equipos nuevos ni cambios de PON esperando autorización.", "new" to "Ningún equipo nuevo está esperando autorización.",
        "relocation" to "Ninguna ONU conocida apareció conectada en otro puerto PON.", "review" to "No existen conflictos de serial, cliente o ubicación.",
    )[filter]!!

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            OltSectionTitle("Centro de autorización", "Equipos detectados directamente por la ZTE C320. Última detección ${oltDate(state.savedAt.takeIf { it > 0 }?.let { java.time.Instant.ofEpochMilli(it).toString() })}")
        }
        if (ctx.admin) item {
            OutlinedButton(onClick = onSync, enabled = !syncing, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(6.dp)); Text(if (syncing) "Detectando..." else "Detectar ahora")
            }
        }
        item {
            OltChips(listOf(Triple("all", "Todas", counts["all"]!!), Triple("new", "Nuevas", counts["new"]!!), Triple("relocation", "Cambios de PON", counts["relocation"]!!), Triple("review", "Revisar", counts["review"]!!)), filter) { filter = it }
        }
        item { ReadStatus(state) { ctx.vm.load(OltPaths.UNCONFIGURED, true) } }
        if (filtered.isEmpty() && !state.loading) item {
            OltCard {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen); Text(emptyTitle, fontWeight = FontWeight.Bold) }
                Text(emptyMessage, style = MaterialTheme.typography.bodySmall)
                if (ctx.admin) TextButton(onClick = onSync, enabled = !syncing) { Text("Comprobar nuevamente") }
            }
        }
        items(filtered, key = { it.optInt("id") }) { onu ->
            val relocation = onu.optJSONObject("relocation")
            val previous = relocation?.optJSONObject("previousLocation")
            val review = isReview(onu)
            OltCard(accent = if (review) IspRed else if (relocation != null) IspBlue else IspAmber) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        OltMono(onu.text("serial", ""), weight = FontWeight.Bold)
                        if (relocation != null) Text("Cambio de PON", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                    }
                    OltPill(if (relocation != null) (if (relocation.optBoolean("allowed")) "Reautorizar" else "Revisar") else if (onu.oltStr("authorizationStatus") == "review") "Revisar" else "Pendiente", IspAmber)
                }
                if (previous != null) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(previous.text("ponIndex", ""), textDecoration = TextDecoration.LineThrough, style = MaterialTheme.typography.bodySmall)
                    Text("→", style = MaterialTheme.typography.bodySmall); Text(onu.text("ponIndex", ""), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodySmall)
                } else Text("PON ${onu.text("ponIndex", "")}", style = MaterialTheme.typography.bodySmall)
                Text(onu.optJSONObject("suggestedClient")?.oltStr("nombre") ?: "Sin coincidencia en WispHub", style = MaterialTheme.typography.bodyMedium,
                    color = if (onu.optJSONObject("suggestedClient") == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                onu.oltStr("authorizationReason")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = IspAmber) }
                Text("Primera detección ${oltDate(onu.oltStr("firstSeenAt"))} · última ${oltDate(onu.oltStr("lastSeenAt"))}", style = MaterialTheme.typography.labelSmall)
                if (ctx.admin) {
                    val blocked = relocation != null && !relocation.optBoolean("allowed")
                    Button(onClick = { onAuthorize(onu) }, enabled = !blocked, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text(if (blocked) "Requiere revisión manual antes de reautorizar" else if (relocation != null) "Reautorizar" else "Autorizar")
                    }
                }
            }
        }
    }
}

// ---------------- Asistente de autorizacion ----------------

@Composable
internal fun OltProvisioningWizard(ctx: OltCtx, pending: JSONObject, close: () -> Unit, onOnuProvisioner: (String?, Int?, String?) -> Unit) {
    val scope = rememberCoroutineScope()
    val serial = pending.text("serial", "")
    val relocation = pending.optJSONObject("relocation")
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var step by remember { mutableIntStateOf(1) }
    var preview by remember { mutableStateOf<JSONObject?>(null) }
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var client by remember { mutableStateOf(pending.optJSONObject("suggestedClient")) }
    var clientQuery by remember { mutableStateOf("") }
    var searchTerm by remember { mutableStateOf("") }
    var clientResults by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var clientSearching by remember { mutableStateOf(false) }
    var onuType by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var vlan by remember { mutableStateOf("101") }
    var tcont by remember { mutableStateOf("") }
    var traffic by remember { mutableStateOf("") }
    var managementIp by remember { mutableStateOf("") }
    var serviceMode by remember { mutableStateOf("router") }
    var lanPorts by remember { mutableStateOf(listOf(1)) }
    var profileId by remember { mutableStateOf<Int?>(null) }
    var modelProfileId by remember { mutableStateOf<Int?>(null) }
    var ipPickerOpen by remember { mutableStateOf(false) }
    var reservation by remember { mutableStateOf<JSONObject?>(null) }
    var typed by remember { mutableStateOf("") }

    fun profiles() = catalog?.optJSONArray("profiles").objects()
    fun applyProfile(id: Int?) {
        profileId = id
        val profile = profiles().firstOrNull { it.optInt("id") == id } ?: return
        vlan = profile.optInt("vlan").toString(); tcont = profile.text("tcontProfile", ""); traffic = profile.text("trafficProfile", "")
        serviceMode = profile.oltStr("serviceMode") ?: "router"
        lanPorts = profile.optJSONArray("lanPorts")?.let { arr -> (0 until arr.length()).map { arr.optInt(it) } }?.takeIf { it.isNotEmpty() } ?: listOf(1)
        if (serviceMode == "bridge") managementIp = ""
        profile.oltStr("onuType")?.let { onuType = it }
    }
    fun selectClient(selected: JSONObject) {
        client = selected
        clientQuery = selected.text("nombre", ""); clientResults = emptyList()
        managementIp = selected.oltStr("ip") ?: ""
        name = oltSafeName(selected.oltStr("nombre") ?: selected.oltStr("usuario") ?: "cliente_${selected.optInt("idServicio")}")
        val speed = oltPlanSpeed(selected.oltStr("planInternetName"))
        val matched = speed?.let { s -> profiles().firstOrNull { it.text("name", "").lowercase() == "internet $s mbps" || Regex("(?:^|-)${s}M(?:-|$)", RegexOption.IGNORE_CASE).containsMatchIn(it.text("tcontProfile", "")) } }
        if (matched != null) applyProfile(matched.optInt("id"))
    }

    LaunchedEffect(serial) {
        try {
            val options = ctx.read("/olt-api/unconfigured/${oltEnc(serial)}/provisioning-options")
            catalog = options
            val defaultProfile = options.optJSONArray("profiles").objects().firstOrNull { it.optBoolean("isDefault") }
            profileId = defaultProfile?.optInt("id")
            modelProfileId = options.optJSONObject("modelProfile")?.oltInt("id")
            onuType = options.oltStr("recommendedOnuType") ?: options.optJSONArray("onuTypes").objects().firstOrNull()?.oltStr("name") ?: ""
            val defaults = options.optJSONObject("defaults") ?: JSONObject()
            vlan = defaults.optInt("vlan", 101).toString()
            tcont = defaults.oltStr("tcontProfile") ?: options.optJSONArray("tcontProfiles").objects().firstOrNull()?.oltStr("name") ?: ""
            traffic = defaults.oltStr("trafficProfile") ?: options.optJSONArray("trafficProfiles").objects().firstOrNull()?.oltStr("name") ?: ""
            serviceMode = defaultProfile?.oltStr("serviceMode") ?: "router"
            lanPorts = defaultProfile?.optJSONArray("lanPorts")?.let { arr -> (0 until arr.length()).map { arr.optInt(it) } }?.takeIf { it.isNotEmpty() } ?: listOf(1)
            client?.let { selectClient(it) }
        } catch (error: Exception) { ctx.notify(error.message ?: "No se pudieron leer las opciones de la OLT") } finally { loading = false }
    }
    LaunchedEffect(searchTerm) {
        if (searchTerm.trim().length < 2) { clientResults = emptyList(); return@LaunchedEffect }
        delay(300)
        clientSearching = true
        clientResults = try { ctx.read("/olt-api/clients/search?q=${oltEnc(searchTerm.trim())}").optJSONArray("items").objects() } catch (_: Exception) { emptyList() }
        clientSearching = false
    }

    fun payload(): JSONObject? {
        val selected = client ?: return null
        return JSONObject().put("profileId", profileId ?: JSONObject.NULL).put("modelProfileId", modelProfileId ?: JSONObject.NULL)
            .put("clientIdServicio", selected.optInt("idServicio")).put("onuType", onuType).put("name", name).put("vlan", vlan.toIntOrNull() ?: 0)
            .put("tcontProfile", tcont).put("trafficProfile", traffic).put("managementIp", if (serviceMode == "bridge") JSONObject.NULL else managementIp)
            .put("serviceMode", serviceMode).put("lanPorts", JSONArray(lanPorts))
            .put("previousOnuIndex", relocation?.optJSONObject("previousLocation")?.oltStr("onuIndex") ?: JSONObject.NULL)
    }
    fun runPreview() {
        val body = payload() ?: run { ctx.notify("Seleccione el cliente y complete la configuración"); return }
        loading = true
        scope.launch {
            try { preview = ctx.vm.web("POST", "/olt-api/unconfigured/${oltEnc(serial)}/provision/preview", body); typed = ""; step = 3 }
            catch (error: Exception) { ctx.notify(error.message ?: "No se pudo validar la configuración de la ONU") } finally { loading = false }
        }
    }
    fun runProvisioning() {
        val body = payload() ?: return
        val current = preview ?: return
        if (saving) return
        saving = true
        scope.launch {
            try {
                val response = ctx.write("POST", "/olt-api/unconfigured/${oltEnc(serial)}/provision", body.put("confirmation", typed.trim()))
                if (response.oltStr("onuIndex") != null && response.optBoolean("ok", true)) {
                    result = response; step = 4
                    ctx.notify("ONU ${response.text("onuIndex", "")} autorizada y verificada")
                } else ctx.notify("El servidor no confirmó la autorización de ${current.text("onuIndex", "la ONU")}")
            } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo autorizar la ONU") } finally { saving = false }
        }
    }

    val defaults = catalog?.optJSONObject("defaults")
    OltFullDialog(
        title = if (relocation != null) "Reautorizar en nuevo PON" else "Autorizar ONU", eyebrow = "Aprovisionamiento C320",
        subtitle = "$serial · PON ${pending.text("ponIndex", "")}", closeEnabled = !saving, onClose = close,
        footer = {
            when {
                loading && catalog == null -> {}
                step == 1 -> {
                    val hint = when { catalog == null -> "Esperando datos de la OLT..."; client == null -> "Busque y seleccione el cliente."; serviceMode == "router" && client?.oltStr("ip") == null -> "Elija una IP libre para el cliente."; else -> "" }
                    Text(hint, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Button(onClick = { step = 2 }, enabled = !(serviceMode == "router" && client?.oltStr("ip") == null) && catalog != null, modifier = Modifier.heightIn(min = 48.dp)) { Text("Continuar") }
                }
                step == 2 -> {
                    OutlinedButton(onClick = { step = 1 }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Atrás") }
                    val hint = when { name.isBlank() -> "Falta el nombre en la OLT."; onuType.isBlank() -> "Falta el modelo de ONU."; tcont.isBlank() || traffic.isBlank() -> "Faltan los perfiles de velocidad."; else -> "" }
                    Text(hint, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
                    Button(onClick = ::runPreview, enabled = !loading && name.isNotBlank() && onuType.isNotBlank() && tcont.isNotBlank() && traffic.isNotBlank(), modifier = Modifier.heightIn(min = 48.dp)) { Text(if (loading) "Revisando..." else "Revisar") }
                }
                step == 3 -> {
                    OutlinedButton(onClick = { step = 2 }, enabled = !saving, modifier = Modifier.heightIn(min = 48.dp)) { Text("Atrás") }
                    Button(onClick = ::runProvisioning, enabled = !saving && oltConfirmed(preview?.oltStr("requiredConfirmation"), typed), colors = ButtonDefaults.buttonColors(containerColor = IspRed), modifier = Modifier.heightIn(min = 48.dp)) {
                        Text(if (saving) "Configurando OLT..." else if (relocation != null) "Reautorizar y verificar" else "Autorizar y configurar")
                    }
                }
                else -> Button(onClick = close, modifier = Modifier.heightIn(min = 48.dp)) { Text("Finalizar") }
            }
        },
    ) {
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("1 Cliente", "2 Servicio", "3 Confirmar", "4 Resultado").forEachIndexed { index, label ->
                val number = index + 1
                OltPill(label, if (step == number) IspBlue else if (step > number) IspGreen else OltGray)
            }
        }
        if (loading && catalog == null) {
            LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Leyendo perfiles e IDs disponibles...")
            return@OltFullDialog
        }
        when (step) {
            1 -> {
                Row {
                    OltField("Serial", serial, Modifier.weight(1f), mono = true); OltField("PON", pending.text("ponIndex", ""), Modifier.weight(1f), mono = true)
                }
                Row {
                    OltField("ID propuesto", catalog?.oltInt("recommendedOnuId")?.toString() ?: "--", Modifier.weight(1f))
                    OltField("Modelo sugerido", catalog?.oltStr("recommendedOnuType") ?: "--", Modifier.weight(1f))
                }
                relocation?.optJSONObject("previousLocation")?.let { previous ->
                    Notice("Cambio de puerto detectado. Se moverá ${previous.text("onuIndex", "")} al PON ${pending.text("ponIndex", "")} conservando cliente, IP, WispHub, MikroTik, facturas e historial.")
                }
                catalog?.optJSONObject("agentInventory")?.let { agent ->
                    val summary = agent.optJSONObject("summary") ?: JSONObject()
                    Notice("ONU Studio ${agent.oltStr("agentVersion") ?: ""}: ${summary.oltStr("model") ?: "Modelo sin leer"} - Firmware ${summary.oltStr("softwareVersion") ?: "--"} - WAN ${summary.oltStr("wanIp") ?: "sin configurar"} - VLAN ${summary.oltStr("vlan") ?: "--"}. Lectura enlazada por serial ${summary.text("serial", "")}.")
                }
                OltSectionTitle("Cliente de WispHub", "La IP del cliente se validará contra el inventario de red antes de escribir.")
                if (relocation?.oltInt("clientIdServicio") == null) {
                    OutlinedTextField(clientQuery, { clientQuery = it; searchTerm = it; client = null }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
                        label = { Text("Nombre, usuario, teléfono o ID") }, modifier = Modifier.fillMaxWidth())
                    if (clientSearching) Text("Buscando...", style = MaterialTheme.typography.bodySmall)
                    clientResults.forEach { result ->
                        OutlinedCard(onClick = { selectClient(result) }, modifier = Modifier.fillMaxWidth()) {
                            ListItem(headlineContent = { Text(result.text("nombre", ""), fontWeight = FontWeight.SemiBold) },
                                supportingContent = { Text("${result.oltStr("usuario") ?: "Sin usuario"} · ${result.oltStr("planInternetName") ?: "Sin plan"}") },
                                trailingContent = { OltMono(result.oltStr("ip") ?: "Sin IP") })
                        }
                    }
                }
                client?.let { selected ->
                    OltCard(accent = IspGreen) {
                        Text("Cliente seleccionado", style = MaterialTheme.typography.labelSmall)
                        Text(selected.text("nombre", ""), fontWeight = FontWeight.Bold)
                        Text("${selected.oltStr("usuario") ?: ""} · ${selected.oltStr("planInternetName") ?: ""}", style = MaterialTheme.typography.bodySmall)
                        OltField("IP WispHub", selected.oltStr("ip") ?: "Sin IP asignada", mono = true)
                        OutlinedButton(onClick = { ipPickerOpen = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (selected.oltStr("ip") != null) "Cambiar IP" else "Elegir IP libre") }
                    }
                }
            }
            2 -> {
                OltSectionTitle("Servicio GPON", "Valores tomados de la configuración existente de esta C320.")
                val modelProfile = catalog?.optJSONObject("modelProfile")
                if (modelProfile != null) OltCard(accent = if (modelProfile.oltStr("certificationStatus") == "verified") IspGreen else IspAmber) {
                    Text("Perfil de hardware detectado", style = MaterialTheme.typography.labelSmall)
                    Text("${modelProfile.text("manufacturer", "")} ${modelProfile.text("model", "")}", fontWeight = FontWeight.Bold)
                    Text("${modelProfile.text("firmwarePattern", "")} · serial ${modelProfile.optJSONArray("serialPrefixes").oltStrings().joinToString(", ")}", style = MaterialTheme.typography.bodySmall)
                    Text("Registro OLT: ${modelProfile.text("oltOnuType", "")} · ${modelProfile.text("omciMode", "")}${if (modelProfile.oltStr("tr069ProfileKey") != null) " + TR-069" else ""}", style = MaterialTheme.typography.bodySmall)
                    OltPill(if (modelProfile.oltStr("certificationStatus") == "verified") "Verificado" else "Detectado", if (modelProfile.oltStr("certificationStatus") == "verified") IspGreen else IspAmber)
                } else Notice("No existe un tipo guardado para este serial. Puede autorizarse manualmente y luego registrar el modelo en Perfiles.")
                OltSelect("Perfil guardado", profileId?.toString() ?: "", listOf("" to "Configuración manual") + profiles().map { it.optInt("id").toString() to "${it.text("name", "")} · VLAN ${it.optInt("vlan")}" }) { applyProfile(it.toIntOrNull()) }
                OltSelect("Modo de servicio", serviceMode, listOf("router" to "Router · IP/NAT", "bridge" to "Bridge · Ethernet")) { serviceMode = it }
                OltSelect("Modelo ONU", onuType, catalog?.optJSONArray("onuTypes").objects().map { it.text("name", "") to "${it.text("name", "")} · ${it.optInt("usage")} instaladas" }) { onuType = it }
                OutlinedTextField(name, { name = it.take(32) }, singleLine = true, label = { Text("Nombre en OLT") }, modifier = Modifier.fillMaxWidth())
                OltSelect("Perfil de subida", tcont, catalog?.optJSONArray("tcontProfiles").objects().map { it.text("name", "") to it.text("name", "") }) { tcont = it }
                OltSelect("Perfil de bajada", traffic, catalog?.optJSONArray("trafficProfiles").objects().map { it.text("name", "") to it.text("name", "") }) { traffic = it }
                OutlinedTextField(vlan, { vlan = it.filter(Char::isDigit).take(4) }, singleLine = true, label = { Text("VLAN") }, modifier = Modifier.fillMaxWidth())
                if (serviceMode == "router") Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(managementIp, {}, readOnly = true, singleLine = true, label = { Text("IP WAN / gestión") }, modifier = Modifier.weight(1f))
                    IconButton(onClick = { if (client == null) ctx.notify("Seleccione primero el cliente de la instalación") else ipPickerOpen = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Search, "Elegir IP disponible") }
                } else Notice("Bridge sin IP de cliente. La OLT entregará VLAN $vlan por LAN${lanPorts.joinToString(", LAN")} y verificará que no exista ip-host.")
                Text("Red ${defaults?.oltStr("managementCidr") ?: "--"} · Máscara ${defaults?.oltStr("mask") ?: "--"} · Gateway ${defaults?.oltStr("gateway") ?: "--"} · DNS ${defaults?.oltStr("primaryDns") ?: "--"}", style = MaterialTheme.typography.bodySmall)
            }
            3 -> preview?.let { current ->
                val config = current.optJSONObject("config") ?: JSONObject()
                Row { OltField("ONU", current.text("onuIndex", ""), Modifier.weight(1f), mono = true); OltField("Cliente", current.optJSONObject("client")?.text("nombre", "") ?: "", Modifier.weight(1f)) }
                Row { OltField("Modelo", config.text("onuType", ""), Modifier.weight(1f)); OltField("IP", config.oltStr("managementIp") ?: "--", Modifier.weight(1f), mono = true) }
                Row { OltField("VLAN", config.optInt("vlan").toString(), Modifier.weight(1f)); OltField("Modo", if (config.oltStr("serviceMode") == "bridge") "Bridge" else "Router", Modifier.weight(1f)) }
                OltField("Perfiles", "${config.text("tcontProfile", "")} / ${config.text("trafficProfile", "")}")
                current.optJSONArray("warnings").oltStrings().forEach { Notice(it, true) }
                current.optJSONArray("steps").oltStrings().forEachIndexed { index, text -> Text("${index + 1}. $text", style = MaterialTheme.typography.bodyMedium) }
                current.oltStr("requiredConfirmation")?.let { OltTypedConfirmation(it, typed, { value -> typed = value }, enabled = !saving) }
            }
            else -> result?.let { done ->
                val config = done.optJSONObject("config") ?: JSONObject()
                val local = done.optJSONObject("localProvisioning") ?: JSONObject()
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen, modifier = Modifier.size(36.dp))
                    Column { Text("ONU autorizada y verificada", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium); OltMono("${done.text("onuIndex", "")} · ${config.text("serial", serial)}") }
                }
                Row { OltField("Cliente", done.optJSONObject("client")?.text("nombre", "") ?: "", Modifier.weight(1f)); OltField("Estado", if (done.optBoolean("online")) "En línea" else oltPhaseLabel(done.oltStr("phaseState")), Modifier.weight(1f)) }
                Row { OltField("VLAN", config.optInt("vlan").toString(), Modifier.weight(1f)); OltField("IP", config.oltStr("managementIp") ?: "--", Modifier.weight(1f), mono = true) }
                if (done.optJSONObject("modelProfile")?.oltStr("tr069ProfileKey") != null) {
                    Button(onClick = { onOnuProvisioner(local.oltStr("wanIp"), local.oltInt("vlan"), local.oltStr("ssid")); close() }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Continuar con WAN y WiFi") }
                } else Notice("El servicio GPON quedó configurado. Este modelo no tiene control remoto (TR-069) certificado: configure WAN y WiFi en el equipo.")
            }
        }
    }

    if (ipPickerOpen) client?.let { selected ->
        OltIpPicker(ctx, selected, serial, defaults?.oltStr("managementCidr") ?: "", onClose = { ipPickerOpen = false }) { updatedClient, newReservation, ip ->
            val previous = reservation
            client = updatedClient
            managementIp = updatedClient.oltStr("ip") ?: ip
            reservation = newReservation
            ipPickerOpen = false
            if (previous != null && previous.oltStr("token") != newReservation.oltStr("token")) {
                scope.launch { runCatching { ctx.vm.web("DELETE", "/provisioning/reservations/${oltEnc(previous.optString("token"))}") } }
            }
        }
    }
}

/** Selector de IP libre: reserva 60 min y la asigna al cliente en WispHub y MikroTik (igual que la web). */
@Composable
private fun OltIpPicker(ctx: OltCtx, client: JSONObject, serial: String, initialNetwork: String, onClose: () -> Unit, onAssigned: (JSONObject, JSONObject, String) -> Unit) {
    val scope = rememberCoroutineScope()
    var network by remember { mutableStateOf(initialNetwork) }
    var search by remember { mutableStateOf("") }
    var catalog by remember { mutableStateOf<JSONObject?>(null) }
    var loading by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<JSONObject?>(null) }
    var reloadKey by remember { mutableIntStateOf(0) }

    LaunchedEffect(network, reloadKey) {
        loading = true
        try {
            val query = listOfNotNull(network.takeIf { it.isNotBlank() }?.let { "cidr=${oltEnc(it)}" }, search.trim().takeIf { it.isNotBlank() }?.let { "q=${oltEnc(it)}" }).joinToString("&")
            catalog = ctx.read("/provisioning/ip-catalog" + if (query.isNotBlank()) "?$query" else "")
        } catch (error: Exception) { ctx.notify(error.message ?: "No se pudo consultar el inventario de IP") } finally { loading = false }
    }

    fun assign() {
        val address = selected ?: return
        if (saving) return
        saving = true
        scope.launch {
            val ip = address.text("ip", "")
            val reservation = try {
                ctx.vm.web("POST", "/provisioning/reservations", JSONObject().put("ip", ip).put("clientName", client.text("nombre", "")).put("serial", serial).put("durationMinutes", 60))
            } catch (error: Exception) {
                saving = false; ctx.notify(error.message ?: "La IP ya no está disponible"); reloadKey++; return@launch
            }
            try {
                val result = ctx.vm.web("POST", "/provisioning/clients/${client.optInt("idServicio")}/assign-ip",
                    JSONObject().put("reservationToken", reservation.optString("token")).put("serial", serial), "/provisioning/jobs")
                val updated = result.optJSONObject("client")
                if (result.optBoolean("ok") && updated != null) {
                    ctx.notify("$ip reservada y sincronizada con WispHub y MikroTik")
                    onAssigned(updated, reservation, ip)
                } else {
                    runCatching { ctx.vm.web("DELETE", "/provisioning/reservations/${oltEnc(reservation.optString("token"))}") }
                    ctx.notify("El servidor no confirmó la asignación de la IP")
                }
            } catch (error: Exception) {
                runCatching { ctx.vm.web("DELETE", "/provisioning/reservations/${oltEnc(reservation.optString("token"))}") }
                ctx.notify(error.message ?: "No se pudo asignar la IP al cliente")
            } finally { saving = false }
        }
    }

    val rows = catalog?.optJSONArray("rows").objects().filter { it.optJSONObject("reservation") == null }
    OltFullDialog(title = "Elegir IP disponible", eyebrow = "Inventario MikroTik", closeEnabled = !saving, onClose = onClose, scrollable = false, footer = {
        Column(Modifier.weight(1f)) {
            selected?.let { address ->
                Text("Seleccionada", style = MaterialTheme.typography.labelSmall); OltMono(address.text("ip", ""), weight = FontWeight.Bold)
                client.oltStr("ip")?.takeIf { it != address.optString("ip") }?.let { current -> Text("Reemplazará la IP $current en WispHub y MikroTik", style = MaterialTheme.typography.labelSmall, color = IspAmber) }
            }
        }
        Button(onClick = ::assign, enabled = selected != null && !saving, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(if (saving) "Reservando y sincronizando..." else if (client.oltStr("ip") != null) "Cambiar IP y reservar" else "Reservar y asignar")
        }
    }) {
        Text("La IP elegida queda reservada 60 minutos y se asigna al cliente en WispHub y MikroTik.", style = MaterialTheme.typography.bodySmall)
        OltSelect("Segmento", network, listOf("" to "Todos los segmentos") + catalog?.optJSONArray("networks").objects().map { it.text("cidr", "") to "${it.text("cidr", "")} · ${it.optInt("available")} libres" }) { network = it; selected = null }
        Row(verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Buscar IP (ej. 192.168.16.24)") }, modifier = Modifier.weight(1f))
            TextButton(onClick = { reloadKey++ }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Buscar") }
        }
        if (catalog?.optBoolean("stale") == true) Notice("Se muestra el último inventario guardado. La disponibilidad se comprobará nuevamente al reservar.")
        if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (!loading && rows.isEmpty()) item { EmptyState("No se encontraron IP disponibles en este segmento.") }
            items(rows, key = { it.text("ip", "") }) { address ->
                val isSelected = selected?.optString("ip") == address.optString("ip")
                val probe = address.oltStr("availabilityConfidence") == "probe_required"
                OutlinedCard(onClick = { selected = address }, modifier = Modifier.fillMaxWidth(),
                    border = if (isSelected) androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else CardDefaults.outlinedCardBorder()) {
                    ListItem(headlineContent = { OltMono(address.text("ip", ""), weight = FontWeight.Bold) },
                        supportingContent = { Text(address.oltStr("cidr") ?: "Segmento sin identificar") },
                        trailingContent = { OltPill(if (probe) "Requiere prueba" else "Verificada", if (probe) IspAmber else IspGreen) })
                }
            }
        }
    }
}
