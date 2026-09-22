package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ispmax.mobile.data.IpRangeRules
import com.ispmax.mobile.data.LocalIpRange
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.launch

@Composable
fun IpRangeSettingsScreen(vm: MainViewModel) {
    val ranges by vm.ipRanges.collectAsStateWithLifecycle()
    var editing by remember { mutableStateOf<LocalIpRange?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<LocalIpRange?>(null) }
    LaunchedEffect(Unit) { vm.ensureIpRanges() }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Segmentos del dispositivo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Se usan para recomendar y reservar IP al crear clientes", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = { creating = true }) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp)); Text("Agregar") }
        }
        Notice("La disponibilidad siempre se confirma en vivo contra WispHub y MikroTik. Estos rangos permanecen solamente en este dispositivo.")
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(ranges, key = { it.id }) { range ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Outlined.Lan, null, tint = if (range.active) IspGreen else MaterialTheme.colorScheme.outline)
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(range.name, fontWeight = FontWeight.SemiBold)
                                Text(range.cidr, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            AssistChip(onClick = {}, label = { Text(if (range.active) "Activo" else "Inactivo") }, leadingIcon = { Icon(if (range.active) Icons.Outlined.CheckCircle else Icons.Outlined.PauseCircle, null, Modifier.size(18.dp)) })
                        }
                        Text("VLAN ${range.vlan ?: "sin definir"}  ·  Gateway ${range.gateway.ifBlank { "sin definir" }}  ·  Prioridad ${range.priority}", style = MaterialTheme.typography.bodySmall)
                        Text("Utilizable ${range.usableStart} - ${range.usableEnd}  ·  DNS ${range.dns}", style = MaterialTheme.typography.bodySmall)
                        if (range.exclusions.isNotBlank()) Text("Exclusiones: ${range.exclusions}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            TextButton(onClick = { editing = range }) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(6.dp)); Text("Editar") }
                            TextButton(onClick = { deleting = range }, enabled = ranges.size > 1) { Icon(Icons.Outlined.DeleteOutline, null); Spacer(Modifier.width(6.dp)); Text("Eliminar") }
                        }
                    }
                }
            }
            if (ranges.isEmpty()) item { EmptyState("Preparando el segmento principal") }
        }
    }

    if (creating || editing != null) IpRangeEditor(editing ?: IpRangeRules.defaultRange().copy(id = 0, name = "", cidr = "", gateway = "", usableStart = "", usableEnd = "", exclusions = ""), vm) {
        creating = false
        editing = null
    }
    deleting?.let { range ->
        val scope = rememberCoroutineScope()
        var busy by remember { mutableStateOf(false) }
        var error by remember { mutableStateOf<String?>(null) }
        AlertDialog(onDismissRequest = { if (!busy) deleting = null }, title = { Text("Eliminar segmento") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text("${range.name} (${range.cidr}) dejara de aparecer al crear clientes."); error?.let { Notice(it, true) } } },
            confirmButton = { TextButton(onClick = { scope.launch { busy = true; error = null; try { vm.deleteIpRange(range.id); deleting = null } catch (e: Exception) { error = e.message } finally { busy = false } } }, enabled = !busy) { Text("Eliminar") } },
            dismissButton = { TextButton(onClick = { deleting = null }, enabled = !busy) { Text("Cancelar") } })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun IpRangeEditor(initial: LocalIpRange, vm: MainViewModel, close: () -> Unit) {
    var name by remember(initial.id) { mutableStateOf(initial.name) }
    var cidr by remember(initial.id) { mutableStateOf(initial.cidr) }
    var vlan by remember(initial.id) { mutableStateOf(initial.vlan?.toString().orEmpty()) }
    var gateway by remember(initial.id) { mutableStateOf(initial.gateway) }
    var dns by remember(initial.id) { mutableStateOf(initial.dns) }
    var start by remember(initial.id) { mutableStateOf(initial.usableStart) }
    var end by remember(initial.id) { mutableStateOf(initial.usableEnd) }
    var exclusions by remember(initial.id) { mutableStateOf(initial.exclusions) }
    var priority by remember(initial.id) { mutableStateOf(initial.priority.toString()) }
    var active by remember(initial.id) { mutableStateOf(initial.active) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!busy) close() }) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Text(if (initial.id == 0L) "Agregar rango IP" else "Editar rango IP") }, navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } }) }, bottomBar = {
                Box(Modifier.fillMaxWidth().padding(16.dp)) {
                    Button(onClick = {
                        scope.launch {
                            busy = true; error = null
                            try {
                                val parsedVlan = vlan.trim().takeIf { it.isNotEmpty() }?.toIntOrNull()
                                require(vlan.isBlank() || parsedVlan != null && parsedVlan in 1..4094) { "La VLAN debe estar entre 1 y 4094" }
                                val parsedPriority = priority.toIntOrNull() ?: throw IllegalArgumentException("La prioridad debe ser numerica")
                                vm.saveIpRange(initial.copy(name = name, cidr = cidr, vlan = parsedVlan, gateway = gateway, dns = dns, usableStart = start, usableEnd = end, exclusions = exclusions, priority = parsedPriority, active = active))
                                close()
                            } catch (e: Exception) { error = e.message ?: "No se pudo guardar" } finally { busy = false }
                        }
                    }, enabled = !busy && name.isNotBlank() && cidr.isNotBlank() && dns.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Validando..." else "Guardar segmento")
                    }
                }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    error?.let { Notice(it, true) }
                    OutlinedTextField(name, { name = it }, label = { Text("Nombre") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(cidr, { cidr = it }, label = { Text("CIDR") }, supportingText = { Text("Ejemplo: 192.168.16.0/24") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(vlan, { vlan = it }, label = { Text("VLAN") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, modifier = Modifier.weight(1f))
                        OutlinedTextField(priority, { priority = it }, label = { Text("Prioridad") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true, modifier = Modifier.weight(1f))
                    }
                    OutlinedTextField(gateway, { gateway = it }, label = { Text("Gateway") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(dns, { dns = it }, label = { Text("DNS") }, supportingText = { Text("Separa varios con coma") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(start, { start = it }, label = { Text("Primera IP") }, singleLine = true, modifier = Modifier.weight(1f))
                        OutlinedTextField(end, { end = it }, label = { Text("Ultima IP") }, singleLine = true, modifier = Modifier.weight(1f))
                    }
                    OutlinedTextField(exclusions, { exclusions = it }, label = { Text("Exclusiones") }, supportingText = { Text("IP o intervalos separados por coma") }, minLines = 2, modifier = Modifier.fillMaxWidth())
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("Segmento activo", fontWeight = FontWeight.Medium); Text("Disponible para nuevas reservas", style = MaterialTheme.typography.bodySmall) }
                        Switch(checked = active, onCheckedChange = { active = it })
                    }
                }
            }
        }
    }
}
