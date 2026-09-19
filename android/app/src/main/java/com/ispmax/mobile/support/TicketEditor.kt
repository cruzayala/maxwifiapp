package com.ispmax.mobile

import com.ispmax.mobile.data.ApiFailure
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun TicketEditor(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var optionsRaw by rememberSaveable(id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var stale by rememberSaveable(id) { mutableStateOf(false) }
    var picker by rememberSaveable(id) { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val form = JSONObject(raw)
    val options = JSONObject(optionsRaw)
    val attempted = form.optBoolean("attempted")

    suspend fun loadEditor(discardDraft: Boolean = false) {
        error = null
        try {
            if (discardDraft) vm.discardTicketDraft(id)
            optionsRaw = vm.ticketOptions().toString()
            val saved = vm.ticketDraft(id)
            val source = when {
                saved != null -> saved
                id == 0 -> JSONObject().put("state", 1).put("priority", 2)
                else -> vm.ticketForEdit(id).let { ticket ->
                    JSONObject()
                        .put("clientId", ticket.optJSONObject("client")?.optInt("id") ?: 0)
                        .put("clientName", ticket.optJSONObject("client")?.text("name", "") ?: "")
                        .put("subject", ticket.text("subject", ""))
                        .put("technicianId", ticket.optJSONObject("technician")?.optInt("id") ?: 0)
                        .put("technicianName", ticket.optJSONObject("technician")?.text("name", "") ?: "")
                        .put("description", ticket.text("description", ""))
                        .put("state", ticket.optInt("state", 1))
                        .put("priority", ticket.optInt("priority", 2))
                        .put("version", ticket.text("version", ""))
                }
            }
            if (source.text("key", "").length < 16) source.put("key", UUID.randomUUID().toString())
            raw = source.toString()
            loaded = true
        } catch (failure: Exception) {
            if (failure is CancellationException) throw failure
            error = failure.message ?: "No se pudo preparar el ticket"
        }
    }

    LaunchedEffect(id) { if (!loaded) loadEditor() }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(300); vm.saveTicketDraft(id, JSONObject(raw)) } }
    fun update(field: String, value: Any) {
        raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).put("attempted", false).toString()
        error = null
    }
    val dismiss: () -> Unit = {
        if (!busy) scope.launch { if (loaded) vm.saveTicketDraft(id, JSONObject(raw)); close() }
        Unit
    }
    val valid = form.optInt("clientId") > 0 && form.text("subject", "").length >= 2 && form.optInt("technicianId") > 0 &&
        form.text("description", "").length >= 3 && form.optInt("state") in 1..4 && form.optInt("priority") in 1..4

    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(
                topBar = { TopAppBar(title = { Text(if (id == 0) "Nuevo ticket" else "Ticket #$id") }, navigationIcon = { IconButton(onClick = dismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar editor") } }) },
                bottomBar = {
                    Button(
                        onClick = {
                            scope.launch {
                                busy = true; error = null
                                val current = JSONObject(raw).put("attempted", true)
                                raw = current.toString(); vm.saveTicketDraft(id, current)
                                try {
                                    val body = JSONObject()
                                        .put("clientId", current.getInt("clientId"))
                                        .put("subject", current.getString("subject").trim())
                                        .put("technicianId", current.getInt("technicianId"))
                                        .put("description", current.getString("description").trim())
                                        .put("state", current.getInt("state"))
                                        .put("priority", current.getInt("priority"))
                                    vm.saveTicket(id, body, current.getString("key"), if (id == 0) null else current.getString("version"))
                                    loaded = false; close()
                                } catch (failure: Exception) {
                                    if (failure is CancellationException) throw failure
                                    error = failure.message ?: "No se pudo guardar el ticket"
                                    stale = failure is ApiFailure && failure.code == "STALE_TICKET"
                                    if (failure !is IOException || failure is ApiFailure && failure.status in 400..499) {
                                        raw = JSONObject(raw).put("attempted", false).toString()
                                    }
                                } finally { busy = false }
                            }
                        },
                        enabled = loaded && valid && !busy && !stale,
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                    ) {
                        Icon(if (attempted) Icons.Outlined.Refresh else Icons.Outlined.Save, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (busy) "Confirmando en WispHub..." else if (attempted) "Consultar la misma operacion" else "Guardar y verificar")
                    }
                },
            ) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!loaded && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (!loaded && error != null) OutlinedButton(onClick = { scope.launch { loadEditor() } }, modifier = Modifier.fillMaxWidth()) { Text("Reintentar") }
                    if (attempted) Notice("La operacion ya fue enviada. Se consultara con la misma clave para impedir duplicados.")
                    error?.let { Notice(it, true) }
                    if (stale) OutlinedButton(onClick = { scope.launch { stale = false; loaded = false; loadEditor(true) } }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Sync, null); Spacer(Modifier.width(8.dp)); Text("Descartar borrador y leer WispHub") }
                    if (loaded) LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
                        item { TicketChoice("Cliente", form.text("clientName", if (form.optInt("clientId") > 0) "Cliente #${form.optInt("clientId")}" else "Seleccionar cliente"), Icons.Outlined.PersonSearch, !busy && !attempted) { picker = "client" } }
                        item { TicketChoice("Asunto", form.text("subject", "Seleccionar asunto"), Icons.Outlined.Subject, !busy && !attempted) { picker = "subject" } }
                        item { TicketChoice("Tecnico", form.text("technicianName", "Seleccionar tecnico"), Icons.Outlined.Engineering, !busy && !attempted) { picker = "technician" } }
                        item {
                            OutlinedTextField(form.text("description", ""), { update("description", it.take(5000)) }, label = { Text("Descripcion") }, minLines = 4, enabled = !busy && !attempted, modifier = Modifier.fillMaxWidth())
                        }
                        item { TicketChoice("Estado", optionLabel(options.optJSONArray("states"), form.optInt("state"), "Seleccionar estado"), Icons.Outlined.Flag, !busy && !attempted) { picker = "state" } }
                        item { TicketChoice("Prioridad", optionLabel(options.optJSONArray("priorities"), form.optInt("priority"), "Seleccionar prioridad"), Icons.Outlined.PriorityHigh, !busy && !attempted) { picker = "priority" } }
                        item { Notice("El ticket solo se marcara guardado cuando WispHub devuelva cliente, asunto, tecnico, estado y prioridad iguales.") }
                        if (!attempted) item { TextButton(onClick = { scope.launch { loaded = false; vm.discardTicketDraft(id); close() } }, enabled = !busy) { Text("Descartar borrador") } }
                    }
                }
            }
        }
    }

    when (picker) {
        "client" -> TicketClientPicker(vm, pages, { client -> update("clientId", client.optInt("idServicio")); update("clientName", client.text("nombre")); picker = "" }, { picker = "" })
        "subject" -> TextChoiceDialog("Asunto", options.optJSONArray("subjects").stringValues(), form.text("subject", ""), { update("subject", it); picker = "" }, { picker = "" })
        "technician" -> JsonChoiceDialog("Tecnico", options.optJSONArray("technicians"), form.optInt("technicianId"), { row -> update("technicianId", row.optInt("id")); update("technicianName", row.text("name")); picker = "" }, { picker = "" })
        "state" -> JsonChoiceDialog("Estado", options.optJSONArray("states"), form.optInt("state"), { row -> update("state", row.optInt("id")); picker = "" }, { picker = "" })
        "priority" -> JsonChoiceDialog("Prioridad", options.optJSONArray("priorities"), form.optInt("priority"), { row -> update("priority", row.optInt("id")); picker = "" }, { picker = "" })
    }
}

@Composable
private fun TicketChoice(label: String, value: String, icon: androidx.compose.ui.graphics.vector.ImageVector, enabled: Boolean, open: () -> Unit) {
    OutlinedCard(onClick = open, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
        ListItem(headlineContent = { Text(value, fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(label) }, leadingContent = { Icon(icon, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
    }
}

@Composable
private fun TicketClientPicker(vm: MainViewModel, pages: Map<String, PageState>, choose: (JSONObject) -> Unit, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    val path = "/clients?pageSize=30&q=${URLEncoder.encode(query, "UTF-8")}" 
    LaunchedEffect(search) { delay(300); query = search }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    AlertDialog(onDismissRequest = close, title = { Text("Cliente del ticket") }, text = {
        Column {
            OutlinedTextField(search, { search = it }, label = { Text("Nombre, IP o telefono") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            ReadStatus(state) { vm.load(path, true) }
            LazyColumn(Modifier.heightIn(max = 360.dp)) {
                val rows = state.body?.optJSONArray("items").objects()
                if (rows.isEmpty() && !state.loading) item { EmptyState("Sin clientes coincidentes") }
                items(rows, key = { it.optInt("idServicio") }) { row -> ListItem(headlineContent = { Text(row.text("nombre")) }, supportingContent = { Text("#${row.optInt("idServicio")} · ${row.text("ip", "Sin IP")}") }, modifier = Modifier.clickable { choose(row) }) }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}

@Composable
private fun TextChoiceDialog(title: String, values: List<String>, selected: String, choose: (String) -> Unit, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    val rows = values.filter { search.isBlank() || it.contains(search, true) }
    AlertDialog(onDismissRequest = close, title = { Text(title) }, text = { Column {
        OutlinedTextField(search, { search = it }, label = { Text("Buscar") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true)
        LazyColumn(Modifier.heightIn(max = 360.dp)) { items(rows) { value -> ListItem(headlineContent = { Text(value) }, trailingContent = if (value == selected) ({ Icon(Icons.Outlined.Check, null) }) else null, modifier = Modifier.clickable { choose(value) }) } }
    } }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}

@Composable
private fun JsonChoiceDialog(title: String, values: JSONArray?, selected: Int, choose: (JSONObject) -> Unit, close: () -> Unit) {
    val rows = values.objects()
    AlertDialog(onDismissRequest = close, title = { Text(title) }, text = { LazyColumn(Modifier.heightIn(max = 360.dp)) {
        if (rows.isEmpty()) item { EmptyState("No hay opciones sincronizadas") }
        items(rows, key = { it.optInt("id") }) { row -> ListItem(headlineContent = { Text(row.text("name")) }, trailingContent = if (row.optInt("id") == selected) ({ Icon(Icons.Outlined.Check, null) }) else null, modifier = Modifier.clickable { choose(row) }) }
    } }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}

private fun JSONArray?.stringValues(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { optString(it).takeIf(String::isNotBlank) }
private fun optionLabel(values: JSONArray?, id: Int, fallback: String): String = values.objects().firstOrNull { it.optInt("id") == id }?.text("name") ?: fallback
