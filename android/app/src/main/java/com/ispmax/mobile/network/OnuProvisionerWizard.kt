package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.launch

/** Asistente guiado de 4 pasos (ONU → Servicio → WiFi → Aplicar), igual que la web. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
internal fun OnuProvisionerWizard(c: OnuProvisionerController) {
    val scope = rememberCoroutineScope()
    val inspection = c.inspectionTask
    val provision = c.provisionTask
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { c.closeOperation() }) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Column { Text(if (c.operationMode == "check") "Comprobar ONU" else "Nueva operación", fontWeight = FontWeight.Bold); Text("${c.selectedAgent?.optString("displayName") ?: ""} ejecutará los cambios dentro de la red local.", style = MaterialTheme.typography.labelSmall) } },
                        navigationIcon = { IconButton(onClick = { c.closeOperation() }, enabled = c.canCloseOperation) { Icon(Icons.Outlined.Close, "Cerrar") } },
                    )
                },
                bottomBar = {
                    Surface(tonalElevation = 3.dp) { Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Paso ${c.wizardStep} de 4 · ${c.wizardMessage}", style = MaterialTheme.typography.labelMedium)
                        if (c.wizardStep == 2 && c.serviceMissing().isNotEmpty()) Text(c.serviceMissing(), style = MaterialTheme.typography.labelSmall, color = IspAmber)
                        else if (c.wizardStep == 3 && c.wifiMissing().isNotEmpty()) Text(c.wifiMissing(), style = MaterialTheme.typography.labelSmall, color = IspAmber)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { c.previousWizardStep() }, enabled = !(c.wizardStep == 1 || c.wizardBusy || c.provisionTaskId != null || (c.wizardStep == 3 && c.servicePrepared)), modifier = Modifier.weight(1f)) {
                                Icon(Icons.AutoMirrored.Outlined.ArrowBack, null); Text("Atrás")
                            }
                            val primaryModifier = Modifier.weight(1.4f)
                            when {
                                c.wizardStep == 1 -> {
                                    if (c.onuInventory != null && c.operationMode == "provision") Button(onClick = { c.wizardStep = 2 }, modifier = primaryModifier) { Text("Continuar"); Icon(Icons.AutoMirrored.Outlined.ArrowForward, null) }
                                    else if (c.wizardComplete && c.operationMode == "check") Button(onClick = { c.closeOperation() }, modifier = primaryModifier) { Text("Cerrar comprobación") }
                                    else Spacer(primaryModifier)
                                }
                                c.wizardStep == 2 -> Button(onClick = { c.prepareService() }, enabled = !c.wizardBusy, modifier = primaryModifier) { Text(if (c.wizardBusy) "Preparando..." else "Preparar servicio") }
                                c.wizardStep == 3 -> Button(onClick = { c.goToReview() }, modifier = primaryModifier) { Text("Revisar"); Icon(Icons.AutoMirrored.Outlined.ArrowForward, null) }
                                c.provisionTaskId == null -> Button(onClick = { c.submitOperation() }, enabled = !c.creatingTask, modifier = primaryModifier) { Icon(Icons.Outlined.PlayArrow, null); Text(if (c.creatingTask) "Enviando..." else "Configurar y verificar") }
                                c.wizardComplete -> Button(onClick = { c.closeOperation() }, modifier = primaryModifier) { Text("Finalizar") }
                                else -> Spacer(primaryModifier)
                            }
                        }
                    } }
                },
            ) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OnuWizardSteps(c)
                    c.error?.let { Tr069Banner(it, true) { c.error = null } }
                    c.notice?.let { Tr069Banner(it, false) { c.notice = null } }
                    if (c.wizardBusy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    when (c.wizardStep) {
                        1 -> if (c.onuInventory == null) {
                            Text("Conexión local automática", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                            Text(c.wizardMessage, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("El agente prepara la tarjeta Ethernet, encuentra la IP de administración e inicia sesión con las credenciales protegidas de esa PC.", style = MaterialTheme.typography.bodySmall)
                            inspection?.let { task ->
                                Row { Text(task.optString("stageLabel"), Modifier.weight(1f)); Text("${task.optInt("progress")}%", fontWeight = FontWeight.Bold) }
                                LinearProgressIndicator(progress = { task.optInt("progress") / 100f }, modifier = Modifier.fillMaxWidth())
                                if (task.optString("status") == "failed") Notice(task.trText("errorMessage") ?: "No se pudo leer la ONU", true)
                            }
                            OutlinedButton(onClick = { scope.launch { c.startInspection(true) } }, enabled = !c.wizardBusy && inspection?.optString("status") != "processing") { Icon(Icons.Outlined.Refresh, null); Text("Intentar nuevamente") }
                        } else {
                            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen, modifier = Modifier.size(30.dp)); Spacer(Modifier.width(8.dp))
                                    Column(Modifier.weight(1f)) { Text("Lectura directa completada", style = MaterialTheme.typography.labelSmall); Text(c.inventoryFact("device.model", c.deviceModel), fontWeight = FontWeight.Bold) }
                                    StatusBadge(c.profileStatusLabel())
                                }
                                Text("El serial y la configuración fueron leídos desde la ONU, no escritos manualmente.", style = MaterialTheme.typography.bodySmall)
                            } }
                            Tr069Fact("Serial GPON", c.detectedSerial.ifBlank { "--" }, mono = true)
                            Row { Tr069Fact("IP de gestión", c.deviceHost, Modifier.weight(1f), mono = true); Tr069Fact("Firmware", c.inventoryFact("device.software_version"), Modifier.weight(1f)) }
                            Row { Tr069Fact("Estado GPON", c.inventoryFact("device.registration_status"), Modifier.weight(1f)); Tr069Fact("WAN actual", c.inventoryFact("wan.0.name", "Sin perfil"), Modifier.weight(1f)) }
                            Tr069Fact("WiFi actual", c.inventoryFact("wifi.radios.0.ssid", "Sin SSID"))
                            var advanced by remember { mutableStateOf(false) }
                            TextButton(onClick = { advanced = !advanced }) { Text(if (advanced) "Ocultar lectura técnica" else "Ver lectura técnica completa") }
                            if (advanced) {
                                Row { Tr069Fact("Hardware", c.inventoryFact("device.hardware_version"), Modifier.weight(1f)); Tr069Fact("MAC", c.inventoryFact("device.mac", c.inventoryFact("ethernet.mac")), Modifier.weight(1f), mono = true) }
                                Row { Tr069Fact("CPU", c.inventoryFact("device.cpu_usage"), Modifier.weight(1f)); Tr069Fact("Memoria", c.inventoryFact("device.memory_usage"), Modifier.weight(1f)) }
                                Row { Tr069Fact("RX óptico", c.inventoryFact("optical.rx_power_dbm"), Modifier.weight(1f)); Tr069Fact("Adaptador", c.selectedAgent?.trPathText("discovery.device.adapter_name") ?: "--", Modifier.weight(1f)) }
                            }
                        }
                        2 -> {
                            Text("Qué trabajo vas a realizar", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                            Text("Cliente y servicio", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("La nube protege WispHub, MikroTik, facturas e IP antes de tocar la ONU. Sin duplicados.", style = MaterialTheme.typography.bodySmall)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                listOf("new_client" to "Cliente nuevo · Crear todo", "restore_same_onu" to "Restaurar · Misma ONU", "replace_onu" to "Cambiar ONU · Conservar servicio", "migrate_pon" to "Mover de PON · Misma ONU").forEach { (id, label) ->
                                    FilterChip(selected = c.serviceOperation == id, onClick = { c.chooseServiceOperation(id) }, label = { Text(label) })
                                }
                            }
                            Text("La ONU trabajará como", style = MaterialTheme.typography.labelMedium)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                FilterChip(selected = c.serviceMode == "router", onClick = { c.setServiceModeValue("router") }, label = { Text("Router WiFi") }, leadingIcon = { Icon(Icons.Outlined.Wifi, null) })
                                FilterChip(selected = c.serviceMode == "bridge", onClick = { c.setServiceModeValue("bridge") }, label = { Text("Bridge") }, leadingIcon = { Icon(Icons.Outlined.Cable, null) })
                            }
                            if (c.serviceOperation == "new_client") {
                                OutlinedTextField(c.clientName, { if (it.length <= 160) c.clientName = it }, label = { Text("Nombre del cliente") }, placeholder = { Text("Nombre que aparecerá en WispHub y MikroTik") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                Tr069Dropdown("Zona", listOf("" to "Seleccionar zona") + c.zones.map { it.optInt("id").toString() to onuOptionLabel(it) }, c.zoneId?.toString() ?: "", { c.zoneId = it.toIntOrNull() })
                                Tr069Dropdown("Plan de Internet", listOf("" to "Seleccionar plan") + c.plans.map { it.optInt("id").toString() to onuPlanLabel(onuOptionLabel(it)) }, c.planId?.toString() ?: "", { c.planId = it.toIntOrNull(); c.onPlanChange() })
                                if (c.serviceMode == "router") {
                                    OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Text("IP recomendada y verificada", style = MaterialTheme.typography.labelSmall)
                                        Text(c.selectedIp?.trText("ip") ?: "Buscando una IP disponible", fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold)
                                        Text(c.selectedIp?.trText("rangeName") ?: c.selectedIp?.trText("cidr") ?: "Se validará en WispHub, MikroTik, ARP y reservas activas.", style = MaterialTheme.typography.bodySmall)
                                        StatusBadge(if (c.ipCatalogStale) "Datos en caché" else "Disponible ahora")
                                        var change by remember { mutableStateOf(false) }
                                        TextButton(onClick = { change = !change }) { Text("Cambiar dirección") }
                                        if (change) {
                                            if (c.ipRows.isEmpty()) Text("No hay direcciones libres en los rangos de este agente.", style = MaterialTheme.typography.bodySmall)
                                            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                                c.ipRows.take(12).forEach { row ->
                                                    FilterChip(selected = c.wanIp == row.optString("ip"), onClick = { c.chooseIp(row) }, label = { Column { Text(row.optString("ip"), fontFamily = FontFamily.Monospace); Text(row.trText("rangeName") ?: row.optString("cidr"), style = MaterialTheme.typography.labelSmall) } })
                                                }
                                            }
                                        }
                                    } }
                                } else Notice("Bridge no reserva IP. La OLT entregará la VLAN por Ethernet y no se crearán WAN, NAT, WiFi ni TR-069 en la ONU.")
                                var speeds by remember { mutableStateOf(false) }
                                TextButton(onClick = { speeds = !speeds }) { Text("Velocidad y datos opcionales") }
                                if (speeds) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedTextField(c.uploadMbps, { c.uploadMbps = it.filter { ch -> ch.isDigit() || ch == '.' } }, label = { Text("Subida Mbps") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                                    OutlinedTextField(c.downloadMbps, { c.downloadMbps = it.filter { ch -> ch.isDigit() || ch == '.' } }, label = { Text("Bajada Mbps") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.weight(1f))
                                }
                            } else {
                                val selected = c.selectedExistingClient
                                if (selected == null) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        OutlinedTextField(c.clientSearch, { c.clientSearch = it }, label = { Text("Buscar el cliente existente") }, placeholder = { Text("Nombre, usuario, IP o teléfono") }, singleLine = true, modifier = Modifier.weight(1f))
                                        Spacer(Modifier.width(6.dp)); IconButton(onClick = { c.searchClients() }, enabled = !c.wizardBusy) { Icon(Icons.Outlined.Search, "Buscar") }
                                    }
                                    c.clientResults.forEach { client ->
                                        OutlinedCard(onClick = { c.selectExistingClient(client) }, modifier = Modifier.fillMaxWidth()) {
                                            ListItem(headlineContent = { Text(client.optString("nombre"), fontWeight = FontWeight.SemiBold) },
                                                supportingContent = { Text("${client.trText("usuario") ?: "Sin usuario"} · ${onuPlanLabel(client.trText("planInternetName"))}") },
                                                trailingContent = { Column(horizontalAlignment = Alignment.End) { Text(client.trText("ip") ?: "Sin IP", fontFamily = FontFamily.Monospace); Text("WispHub #${client.optInt("idServicio")}", style = MaterialTheme.typography.labelSmall) } })
                                        }
                                    }
                                } else {
                                    OutlinedCard(Modifier.fillMaxWidth()) {
                                        ListItem(leadingContent = { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen) },
                                            headlineContent = { Text(selected.optString("nombre"), fontWeight = FontWeight.SemiBold) },
                                            supportingContent = { Text("${onuPlanLabel(selected.trText("planInternetName"))} · ${selected.trText("ip") ?: "Bridge sin IP"}") },
                                            trailingContent = { TextButton(onClick = { c.selectedExistingClient = null }) { Text("Cambiar") } })
                                    }
                                    OutlinedTextField(c.operationReason, { if (it.length <= 240) c.operationReason = it }, label = { Text("Motivo técnico") }, placeholder = { Text("Ej. ONU formateada o cambio por avería") }, modifier = Modifier.fillMaxWidth())
                                    if (c.serviceOperation == "migrate_pon") OutlinedTextField(c.targetPonIndex, { c.targetPonIndex = it.trim() }, label = { Text("PON de destino") }, placeholder = { Text("Ej. 1/2/3") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                }
                            }
                        }
                        3 -> {
                            val routed = c.serviceMode == "router"
                            Text("Perfil automático ${if (routed) "Router" else "Bridge"}", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                            Text(if (routed) "WiFi y administración" else "Entrega Ethernet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("Solo completa lo que verá el cliente; las decisiones técnicas ya fueron calculadas. ${c.managementLabel()}", style = MaterialTheme.typography.bodySmall)
                            if (routed) {
                                var reveal by remember { mutableStateOf(false) }
                                OutlinedTextField(c.wifiSsid, { if (it.length <= 32) c.wifiSsid = it }, label = { Text("Nombre de la red WiFi") }, placeholder = { Text("Nombre visible") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(c.wifiPassword, { if (it.length <= 64) c.wifiPassword = it }, label = { Text("Clave WiFi") }, placeholder = { Text("Mínimo 8 caracteres") }, singleLine = true,
                                    visualTransformation = if (reveal) VisualTransformation.None else PasswordVisualTransformation(),
                                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                                    trailingIcon = { IconButton(onClick = { reveal = !reveal }) { Icon(if (reveal) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, if (reveal) "Ocultar clave" else "Mostrar clave") } },
                                    modifier = Modifier.fillMaxWidth())
                                OutlinedButton(onClick = { c.generateWifiDefaults() }) { Icon(Icons.Outlined.Refresh, null); Text("Generar") }
                                OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text("Internet: VLAN ${c.vlan} · IP ${c.wanIp} · NAT activo", style = MaterialTheme.typography.bodySmall)
                                    Text("Administración: ${c.managementLabel()} · HTTP restringido", style = MaterialTheme.typography.bodySmall)
                                    Text("Protección: respaldo, verificación y reversión automática", style = MaterialTheme.typography.bodySmall)
                                } }
                            } else Notice("Bridge listo para la OLT. Se aplicará VLAN ${c.vlan} en LAN1–LAN4. La ONU no tendrá IP WAN, NAT, WiFi ni TR-069; OMCI seguirá disponible para óptica, estado y reinicio.")
                            var technical by remember { mutableStateOf(false) }
                            TextButton(onClick = { technical = !technical }) { Text("Ajustes técnicos avanzados") }
                            if (technical) {
                                OutlinedTextField(c.vlan, { c.vlan = it.filter(Char::isDigit).take(4) }, label = { Text("VLAN") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                                if (routed) {
                                    OutlinedTextField(c.gateway, { c.gateway = it.trim() }, label = { Text("Gateway") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(c.subnetMask, { c.subnetMask = it.trim() }, label = { Text("Máscara") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(c.primaryDns, { c.primaryDns = it.trim() }, label = { Text("DNS primario") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(c.secondaryDns, { c.secondaryDns = it.trim() }, label = { Text("DNS secundario") }, placeholder = { Text("Opcional") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(c.mtu, { c.mtu = it.filter(Char::isDigit).take(4) }, label = { Text("MTU") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), modifier = Modifier.fillMaxWidth())
                                }
                                Tr069Check("Limpiar WAN incompatible (siempre crea respaldo antes)", c.replaceConflictingWan, { c.replaceConflictingWan = it })
                                if (routed) {
                                    Tr069Check("TR-069 (según perfil ${c.deviceModel})", c.tr069Enabled, { c.tr069Enabled = it })
                                    Tr069Check("Acceso técnico HTTP (solo desde ${c.gateway}/32)", c.remoteAccessEnabled, { c.remoteAccessEnabled = it })
                                }
                            }
                        }
                        else -> if (c.provisionTaskId == null) {
                            Icon(Icons.Outlined.VerifiedUser, null, tint = IspGreen, modifier = Modifier.size(28.dp))
                            Text("Todo listo para aplicar", style = MaterialTheme.typography.labelSmall, color = IspBlue)
                            Text("Revisa la entrega al cliente", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            Text("El agente hará respaldo, configuración, guardado y lectura posterior.", style = MaterialTheme.typography.bodySmall)
                            Tr069Fact("Operación", onuOperationLabel(c.serviceOperation)); Tr069Fact("Cliente", c.clientName.ifBlank { "--" })
                            Tr069Fact("ONU", "${c.deviceModel} · ${c.detectedSerial}"); Tr069Fact("Servicio", if (c.serviceMode == "router") "Router · ${c.wanIp}" else "Bridge · sin IP WAN")
                            Tr069Fact("WiFi", if (c.serviceMode == "router") c.wifiSsid else "No aplica"); Tr069Fact("Gestión", c.managementLabel())
                            Tr069Fact("Protección", "Respaldo y verificación siempre activos")
                            Notice("Se puede reintentar sin riesgo: reintentar no duplicará el cliente en WispHub, la cola en MikroTik, la IP ni el expediente.")
                        } else provision?.let { task ->
                            val status = task.optString("status")
                            val tone = when (status) { "success" -> IspGreen; "failed" -> IspRed; else -> IspBlue }
                            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                                when (status) { "success" -> Icon(Icons.Outlined.CheckCircle, null, tint = tone, modifier = Modifier.size(34.dp)); "failed" -> Icon(Icons.Outlined.ErrorOutline, null, tint = tone, modifier = Modifier.size(34.dp)); else -> CircularProgressIndicator() }
                                Text(onuStatusLabel(status), style = MaterialTheme.typography.labelSmall, color = tone)
                                Text(task.optString("stageLabel"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text(when (status) { "success" -> "La configuración fue leída nuevamente y coincide con el perfil."; "failed" -> task.trText("errorMessage") ?: "El agente detuvo el proceso."; else -> "Puedes cerrar esta ventana; el trabajo continuará en el agente." }, style = MaterialTheme.typography.bodySmall)
                                Text("${task.optInt("progress")}%", fontWeight = FontWeight.Bold)
                                LinearProgressIndicator(progress = { task.optInt("progress") / 100f }, modifier = Modifier.fillMaxWidth(), color = tone)
                            }
                            task.optJSONObject("result")?.optJSONArray("events").objects().forEach { OnuEventRow(it) }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun OnuWizardSteps(c: OnuProvisionerController) {
    val labels = listOf("ONU" to "Detectar y leer", "Servicio" to "Cliente e IP", "WiFi" to "Nombre y clave", "Aplicar" to "Revisar y verificar")
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        labels.forEachIndexed { index, (title, subtitle) ->
            val step = index + 1
            val complete = when (step) { 1 -> c.wizardStep > 1 || c.onuInventory != null; 4 -> c.wizardComplete; else -> c.wizardStep > step }
            val active = c.wizardStep == step
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                Icon(if (complete) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked, null, tint = if (complete) IspGreen else if (active) IspBlue else MaterialTheme.colorScheme.onSurfaceVariant)
                Text(title, style = MaterialTheme.typography.labelMedium, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal)
                Text(subtitle, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            }
        }
    }
}
