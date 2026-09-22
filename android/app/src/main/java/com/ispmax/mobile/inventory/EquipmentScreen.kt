package com.ispmax.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import com.ispmax.mobile.ui.ReliefIcon
import com.ispmax.mobile.ui.IspBlue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

@Composable internal fun EquipmentScreen(vm: MainViewModel, pages: Map<String, PageState>, clientId: Int? = null) {
    var search by rememberSaveable(clientId) { mutableStateOf("") }
    var query by rememberSaveable(clientId) { mutableStateOf("") }
    var status by rememberSaveable(clientId) { mutableStateOf("") }
    var page by rememberSaveable(clientId) { mutableIntStateOf(1) }
    var stock by rememberSaveable(clientId) { mutableStateOf(false) }
    var selected by rememberSaveable(clientId) { mutableIntStateOf(0) }
    var editorId by rememberSaveable(clientId) { mutableIntStateOf(-1) }
    var operation by rememberSaveable(clientId) { mutableStateOf("create") }
    val filter = if (clientId != null && !stock) "&clientId=$clientId" else ""
    val path = "/equipment?page=$page&pageSize=30&q=${URLEncoder.encode(query, "UTF-8")}&status=${if (stock) "stock" else status}$filter"
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(if (stock) "Stock disponible" else "Equipos registrados", style = MaterialTheme.typography.titleMedium)
                Text(money(state.body?.optJSONObject("summary")?.optDouble("cost", 0.0) ?: 0.0), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            FilledTonalIconButton(onClick = { editorId = 0; operation = "create" }) { Icon(Icons.Outlined.Add, "Registrar equipo") }
        }
        if (clientId != null) FilterChip(stock, { stock = !stock; page = 1 }, label = { Text(if (stock) "Volver a equipos del cliente" else "Asignar desde stock") }, leadingIcon = { Icon(Icons.Outlined.Inventory2, null) })
        OutlinedTextField(search, { search = it }, label = { Text("Buscar equipo") }, placeholder = { Text("Serial, MAC o modelo") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar equipos") } }, singleLine = true, modifier = Modifier.fillMaxWidth())
        if (!stock && clientId == null) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            equipmentStates.forEach { (value, label) -> FilterChip(status == value, { status = value; page = 1 }, label = { Text(label) }) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            val total = state.body?.optInt("total") ?: 0
            Text("$total ${if (total == 1) "equipo" else "equipos"}", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar inventario") }
            ExportButton(rows, "Equipos")
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay equipos para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.optInt("id") }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ReliefIcon(Icons.Outlined.Router, IspBlue, 40.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.text("model", row.text("typeName")), fontWeight = FontWeight.SemiBold)
                            Text("SN ${row.text("serialNumber")}", style = MaterialTheme.typography.bodySmall)
                            Text(equipmentStates[row.text("status")] ?: row.text("status"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                            if (!row.isNull("assignedToClientId")) Text(row.text("clientName", "Cliente #${row.optInt("assignedToClientId")}"), style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Outlined.ChevronRight, null)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Equipos anteriores") }
            Text("Pagina $page", style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Equipos siguientes") }
        }
    }
    if (selected > 0) EquipmentDetail(selected, vm, pages, { op -> editorId = selected; operation = op; selected = 0 }, { selected = 0 })
    if (editorId >= 0) EquipmentOperation(editorId, operation, if (stock) clientId else null, vm, pages) { editorId = -1 }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun EquipmentDetail(id: Int, vm: MainViewModel, pages: Map<String, PageState>, action: (String) -> Unit, close: () -> Unit) {
    val path = "/equipment/$id"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val row = state.body
    val online = row != null && !state.cached && state.error == null && !state.loading
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.88f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Detalle del equipo", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Cerrar equipo") } }
            ReadStatus(state) { vm.load(path, true) }
            row?.let {
                Text(it.text("model", it.text("typeName")), style = MaterialTheme.typography.titleMedium)
                Text("Serial: ${it.text("serialNumber")}")
                Text("MAC: ${it.text("macAddress")}")
                Text("${it.text("brand")} / ${it.text("typeName")}")
                Text("Estado: ${equipmentStates[it.text("status")] ?: it.text("status")}")
                Text("Costo: ${money(it.optDouble("unitCost", 0.0))}")
                if (!it.isNull("assignedToClientId")) Text("Cliente: ${it.text("clientName", "#${it.optInt("assignedToClientId")}")}")
                if (!it.isNull("purchaseId")) Notice("Compra #${it.optInt("purchaseId")}: costo y origen protegidos.")
                if (!it.isNull("notes")) Text(it.text("notes"))
                if (!it.isNull("installNotes")) Text("Instalacion: ${it.text("installNotes")}")
                Button(onClick = { action("update") }, enabled = online, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text("Editar equipo") }
                if (it.text("status") == "stock" && it.isNull("assignedToClientId")) OutlinedButton(onClick = { action("assign") }, enabled = online, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonAdd, null); Spacer(Modifier.width(8.dp)); Text("Asignar a cliente") }
                if (!it.isNull("assignedToClientId") || it.text("status") == "assigned") OutlinedButton(onClick = { action("return") }, enabled = online, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Inventory2, null); Spacer(Modifier.width(8.dp)); Text("Devolver a stock") }
                else if (it.isNull("purchaseId")) TextButton(onClick = { action("delete") }, enabled = online) { Icon(Icons.Outlined.DeleteOutline, null); Spacer(Modifier.width(8.dp)); Text("Eliminar equipo") }
                HorizontalDivider(); Text("Historial de movimientos", style = MaterialTheme.typography.titleMedium)
                val events = it.optJSONArray("history").objects()
                if (events.isEmpty()) Text("Sin movimientos registrados")
                events.forEach { e ->
                    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text(mapOf("create_equipment" to "Registro", "update_equipment" to "Edicion", "assign_equipment" to "Asignacion", "return_equipment" to "Devolucion", "unassign_equipment" to "Devolucion")[e.text("action")] ?: "Movimiento", fontWeight = FontWeight.Medium)
                        Text("${e.text("createdAt").replace('T', ' ').take(16)} UTC / ${e.text("actor")}", style = MaterialTheme.typography.bodySmall)
                        if (!e.isNull("fromClient") || !e.isNull("toClient")) Text("${e.text("fromClient", "Stock")} -> ${e.text("toClient", "Stock")}", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun EquipmentOperation(id: Int, requested: String, clientId: Int?, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var stale by rememberSaveable(id) { mutableStateOf(false) }
    var picker by rememberSaveable { mutableStateOf("") }
    var statusMenu by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val form = JSONObject(raw)
    val op = form.optString("operation", requested)
    val data = form.optJSONObject("data") ?: JSONObject()
    val attempted = form.optBoolean("attempted")
    suspend fun initialize() {
        try {
            error = null
            val draft = vm.equipmentDraft(id)
            if (draft != null) raw = draft.toString()
            else {
                val current = if (id == 0) JSONObject().put("unitCost", "0").put("status", "stock") else vm.equipmentForEdit(id)
                if (requested == "assign" && clientId != null) current.put("clientId", clientId).put("clientName", "Cliente #$clientId")
                raw = JSONObject().put("operation", requested).put("data", current).put("version", current.optString("version")).put("key", UUID.randomUUID().toString()).toString()
            }
            loaded = true
        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message }
    }
    LaunchedEffect(id) { if (!loaded) initialize() }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.saveEquipmentDraft(id, JSONObject(raw)) } }
    fun update(field: String, value: Any) { val next = JSONObject(raw); next.getJSONObject("data").put(field, value); raw = next.put("key", UUID.randomUUID().toString()).toString() }
    val dismiss: () -> Unit = { if (!busy) scope.launch { if (loaded) vm.saveEquipmentDraft(id, JSONObject(raw)); close() }; Unit }
    val title = when (op) { "create" -> "Registrar equipo"; "update" -> "Editar equipo"; "assign" -> "Asignar equipo"; "return" -> "Devolver equipo"; else -> "Eliminar equipo" }
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = dismiss) {
        Surface(Modifier.fillMaxSize()) {
            Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = dismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar operacion de equipo") } }) }, bottomBar = {
                Button(onClick = { scope.launch {
                    busy = true; error = null
                    try {
                        val body = equipmentRequest(JSONObject(raw))
                        raw = JSONObject(raw).put("attempted", true).toString()
                        vm.saveEquipmentDraft(id, JSONObject(raw))
                        vm.changeEquipment(id, op, body, JSONObject(raw).getString("key"), if (id == 0) null else JSONObject(raw).getString("version"))
                        loaded = false; close()
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        error = e.message
                        stale = e is ApiFailure && e.code in listOf("STALE_EQUIPMENT", "EQUIPMENT_UNAVAILABLE", "EQUIPMENT_NOT_ASSIGNED", "NOT_FOUND")
                        if (e !is java.io.IOException || e is ApiFailure && e.status in 400..499 && !(e.status == 409 && e.code == "REQUEST_FAILED")) raw = JSONObject(raw).put("attempted", false).toString()
                    } finally { busy = false }
                } }, enabled = loaded && !busy && !stale, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                    Icon(if (op == "delete") Icons.Outlined.DeleteOutline else Icons.Outlined.Check, null); Spacer(Modifier.width(8.dp))
                    Text(if (busy) "Guardando..." else if (attempted) "Reintentar misma operacion" else when (op) { "create", "update" -> "Guardar equipo"; "assign" -> "Confirmar asignacion"; "return" -> "Confirmar devolucion"; else -> "Confirmar eliminacion" })
                }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    if (!loaded && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    error?.let { Notice(it, true) }
                    if (!loaded && error != null) TextButton(onClick = { scope.launch { initialize() } }) { Text("Reintentar consulta") }
                    if (attempted) Notice("Operacion pendiente de confirmacion. Se conserva la misma solicitud para evitar duplicados.")
                    if (stale) TextButton(onClick = { scope.launch { loaded = false; vm.discardEquipmentDraft(id); close() } }) { Text("Descartar y volver al inventario") }
                    val enabled = loaded && !busy && !attempted && !stale
                    if (loaded && op in listOf("create", "update")) {
                        OutlinedButton(onClick = { picker = "type" }, enabled = enabled && id == 0, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Category, null); Spacer(Modifier.width(8.dp)); Text(data.text("typeName", "Seleccionar tipo de equipo")) }
                        for ((field, label) in listOf("serialNumber" to "Serial del equipo", "macAddress" to "MAC", "brand" to "Marca", "model" to "Modelo", "unitCost" to "Costo unitario", "notes" to "Notas del equipo")) {
                            OutlinedTextField(data.text(field, ""), { update(field, it) }, label = { Text(label) }, enabled = enabled && !(field == "unitCost" && !data.isNull("purchaseId")), singleLine = field != "notes", modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = if (field == "unitCost") KeyboardType.Decimal else KeyboardType.Text))
                        }
                        if (id != 0 && data.isNull("assignedToClientId") && data.text("status") != "assigned") Box {
                            OutlinedButton(onClick = { statusMenu = true }, enabled = enabled) { Icon(Icons.Outlined.Tune, null); Spacer(Modifier.width(8.dp)); Text(equipmentStates[data.text("status")] ?: "Estado") }
                            DropdownMenu(statusMenu, { statusMenu = false }) { equipmentStates.filterKeys { it.isNotBlank() && it != "assigned" }.forEach { (value, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { update("status", value); statusMenu = false }) } }
                        }
                    } else if (loaded) {
                        ReliefIcon(Icons.Outlined.Router, IspBlue)
                        Text(data.text("model", data.text("typeName")), style = MaterialTheme.typography.titleLarge)
                        Text("Serial: ${data.text("serialNumber")}")
                        if (op == "assign") {
                            OutlinedButton(onClick = { picker = "client" }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonSearch, null); Spacer(Modifier.width(8.dp)); Text(data.text("clientName", "Seleccionar cliente")) }
                            OutlinedTextField(data.text("installNotes", ""), { update("installNotes", it) }, label = { Text("Notas de instalacion") }, enabled = enabled, modifier = Modifier.fillMaxWidth())
                        } else Text(if (op == "return") "Se devolvera a stock y se conservara el historial. El cliente, sus facturas y el servicio no cambiaran." else "Se eliminara esta unidad del inventario. Su auditoria se conserva; no se elimina ningun cliente ni factura.")
                    }
                    if (loaded && !attempted) TextButton(onClick = { scope.launch { loaded = false; vm.discardEquipmentDraft(id); close() } }, enabled = !busy) { Text("Descartar borrador de equipo") }
                }
            }
        }
    }
    if (picker.isNotBlank()) EquipmentPicker(picker, vm, pages, { row ->
        if (picker == "type") { update("typeId", row.optInt("id")); update("typeName", row.text("name")) }
        else { update("clientId", row.optInt("idServicio")); update("clientName", row.text("nombre")) }
        picker = ""
    }, { picker = "" })
}

@Composable private fun EquipmentPicker(kind: String, vm: MainViewModel, pages: Map<String, PageState>, choose: (JSONObject) -> Unit, close: () -> Unit) {
    var search by rememberSaveable(kind) { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var page by rememberSaveable(kind) { mutableIntStateOf(1) }
    val type = kind == "type"
    val path = "${if (type) "/equipment/types" else "/clients"}?pageSize=20&page=$page&q=${URLEncoder.encode(query, "UTF-8") }"
    LaunchedEffect(search) { delay(300); query = search; page = 1 }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    AlertDialog(onDismissRequest = close, title = { Text(if (type) "Tipo de equipo" else "Cliente del equipo") }, text = {
        Column {
            OutlinedTextField(search, { search = it }, label = { Text(if (type) "Buscar tipo" else "Buscar cliente por nombre o IP") }, singleLine = true)
            ReadStatus(state) { vm.load(path, true) }
            LazyColumn(Modifier.heightIn(max = 280.dp)) {
                if (rows.isEmpty() && !state.loading) item { Text(if (type) "No hay tipos unitarios. Registra el tipo en Inventario de la web." else "Sin clientes coincidentes") }
                items(rows) { row -> ListItem(headlineContent = { Text(row.text(if (type) "name" else "nombre")) }, supportingContent = { Text(row.text(if (type) "category" else "ip")) }, modifier = Modifier.clickable { choose(row) }) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Opciones anteriores") }
                IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Opciones siguientes") }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}
