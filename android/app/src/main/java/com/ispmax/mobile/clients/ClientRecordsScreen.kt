package com.ispmax.mobile

import android.app.DatePickerDialog
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import com.ispmax.mobile.ui.ReliefIcon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalDate
import java.util.UUID

internal val promiseStatuses = linkedMapOf("pending" to "Pendiente", "paid" to "Cumplida", "broken" to "Incumplida")

@Composable internal fun PromisesScreen(vm: MainViewModel, pages: Map<String, PageState>, clientId: Int? = null) {
    var search by rememberSaveable(clientId) { mutableStateOf("") }
    var query by rememberSaveable(clientId) { mutableStateOf("") }
    var status by rememberSaveable(clientId) { mutableStateOf("") }
    var page by rememberSaveable(clientId) { mutableIntStateOf(1) }
    var overdue by rememberSaveable(clientId) { mutableStateOf(false) }
    var editor by rememberSaveable(clientId) { mutableIntStateOf(-1) }
    val path = "/promises?page=$page&q=${URLEncoder.encode(query, "UTF-8")}&status=$status&overdue=$overdue" + if (clientId != null) "&clientId=$clientId" else ""
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Compromisos de pago", style = MaterialTheme.typography.titleMedium)
                Text(state.body?.optJSONObject("summary")?.let { money(it.optDouble("amount")) } ?: "Sin lectura", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.Add, "Nueva promesa") }
        }
        OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Buscar promesa") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (linkedMapOf("" to "Todas") + promiseStatuses).forEach { (value, label) -> FilterChip(status == value && !overdue, { status = value; overdue = false; page = 1 }, label = { Text(label) }) }
            FilterChip(overdue, { overdue = !overdue; status = ""; page = 1 }, label = { Text("Vencidas") })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${state.body?.optInt("total") ?: 0} compromisos", Modifier.weight(1f))
            IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar promesas") }
            ExportButton(rows.map { row -> JSONObject().put("clientName", row.text("clientName")).put("amount", row.optDouble("amount")).put("promisedDate", row.text("promisedDate").take(10)).put("status", promiseStatuses[row.text("status")]) }, "Promesas")
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("Sin promesas para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { editor = row.optInt("id") }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ReliefIcon(Icons.Outlined.EventAvailable, size = 40.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.text("clientName"), fontWeight = FontWeight.SemiBold)
                            Text(money(row.optDouble("amount")), style = MaterialTheme.typography.titleMedium)
                            Text("${row.text("promisedDate").take(10)} · ${promiseStatuses[row.text("status")] ?: row.text("status")}", style = MaterialTheme.typography.bodySmall)
                        }
                        Icon(Icons.Outlined.Edit, "Editar promesa")
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Promesas anteriores") }
            Text("Pagina $page")
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Promesas siguientes") }
        }
    }
    if (editor >= 0) ClientRecordEditor("promise", editor, clientId, vm, pages) { editor = -1 }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ClientRecordEditor(kind: String, id: Int, clientId: Int?, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    var raw by rememberSaveable(kind, id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(kind, id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var picker by rememberSaveable { mutableStateOf(false) }
    var stale by rememberSaveable { mutableStateOf(false) }
    var confirm by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val form = JSONObject(raw)
    val data = form.optJSONObject("data") ?: JSONObject()
    val attempted = form.optBoolean("attempted")
    val alias = kind == "alias"
    suspend fun initialize() {
        try {
            error = null
            val draft = vm.recordDraft(kind, id)
            if (draft != null) raw = draft.toString()
            else {
                val current = if (id > 0) vm.recordForEdit(kind, id) else JSONObject().put("promisedDate", LocalDate.now().toString()).put("status", "pending").apply { if (clientId != null) put("idServicio", clientId).put("clientName", "Cliente #$clientId") }
                raw = JSONObject().put("data", current).put("version", current.optString("version")).put("key", UUID.randomUUID().toString()).toString()
            }
            loaded = true
        } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message }
    }
    LaunchedEffect(kind, id) { if (!loaded) initialize() }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.saveRecordDraft(kind, id, JSONObject(raw)) } }
    fun update(field: String, value: Any) { val next = JSONObject(raw); next.getJSONObject("data").put(field, value); raw = next.put("key", UUID.randomUUID().toString()).toString() }
    val dismiss: () -> Unit = { if (!busy) scope.launch { if (loaded) vm.saveRecordDraft(kind, id, JSONObject(raw)); close() }; Unit }
    val submit: () -> Unit = { scope.launch {
        busy = true; error = null
        try {
            val body = clientRecordRequest(kind, data, id == 0)
            raw = JSONObject(raw).put("attempted", true).toString()
            vm.saveRecordDraft(kind, id, JSONObject(raw))
            vm.changeRecord(kind, id, body, form.getString("key"), form.optString("version").takeIf { it.isNotBlank() })
            loaded = false; close()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = e.message ?: "No se pudo confirmar"
            if (e is ApiFailure && e.code.startsWith("STALE_")) stale = true
            if (e is IllegalArgumentException || e is ApiFailure && (e.status in listOf(400, 401, 403, 404) || e.code.startsWith("STALE_"))) {
                raw = JSONObject(raw).put("attempted", false).put("key", UUID.randomUUID().toString()).toString()
            }
            vm.saveRecordDraft(kind, id, JSONObject(raw))
        } finally { busy = false }
    }; Unit }
    Dialog(onDismissRequest = dismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize()) {
            Scaffold(topBar = { TopAppBar(title = { Text(if (alias) "Editar expediente local" else if (id == 0) "Nueva promesa" else "Editar promesa") }, navigationIcon = { IconButton(onClick = dismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar editor de expediente") } }) }, bottomBar = {
                Button(onClick = { if (!alias && data.optString("status") != "pending" && !attempted) confirm = true else submit() }, enabled = loaded && !busy && !stale, modifier = Modifier.fillMaxWidth().imePadding().navigationBarsPadding().padding(16.dp)) {
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Save, null)
                    Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else if (attempted) "Consultar y reintentar" else if (alias) "Guardar expediente" else "Guardar promesa")
                }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    if (!loaded && error == null) CircularProgressIndicator()
                    if (alias) Notice("Datos propios de ISP Max. No cambia el nombre ni el servicio en WispHub o MikroTik.")
                    else Notice("Una promesa no registra un cobro ni cambia facturas. Cumplida indica seguimiento manual.")
                    if (attempted) Notice("Hay una solicitud sin confirmar. Conservamos sus datos para no duplicarla.")
                    error?.let { Notice(it, true) }
                    if (!loaded || stale) OutlinedButton(onClick = { scope.launch { if (stale) { vm.discardRecordDraft(kind, id); loaded = false; stale = false }; initialize() } }) { Icon(Icons.Outlined.Refresh, null); Text(if (stale) "Descartar borrador y recargar" else "Reintentar lectura") }
                    if (loaded && alias) {
                        listOf("aliasNombre" to "Nombre local", "aliasTelefono" to "Telefono local", "aliasCedula" to "Documento local", "aliasNotas" to "Observaciones locales").forEach { (key, label) ->
                            OutlinedTextField(data.text(key, ""), { update(key, it) }, enabled = !busy && !attempted && !stale, label = { Text(label) }, modifier = Modifier.fillMaxWidth(), minLines = if (key == "aliasNotas") 3 else 1)
                        }
                    } else if (loaded) {
                        Text(data.text("clientName", "Selecciona un cliente"), style = MaterialTheme.typography.titleMedium)
                        if (id == 0) OutlinedButton(onClick = { picker = true }, enabled = !busy && !attempted) { Icon(Icons.Outlined.PersonSearch, null); Spacer(Modifier.width(8.dp)); Text("Seleccionar cliente") }
                        OutlinedTextField(data.text("amount", ""), { update("amount", it) }, enabled = !busy && !attempted && !stale, label = { Text("Importe comprometido") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), modifier = Modifier.fillMaxWidth())
                        OutlinedButton(onClick = {
                            val date = runCatching { LocalDate.parse(data.optString("promisedDate").take(10)) }.getOrDefault(LocalDate.now())
                            DatePickerDialog(context, { _, year, month, day -> update("promisedDate", LocalDate.of(year, month + 1, day).toString()) }, date.year, date.monthValue - 1, date.dayOfMonth).show()
                        }, enabled = !busy && !attempted && !stale) { Icon(Icons.Outlined.CalendarMonth, null); Spacer(Modifier.width(8.dp)); Text(data.text("promisedDate", "Fecha comprometida").take(10)) }
                        if (id > 0) Column { promiseStatuses.forEach { (value, label) -> Row(Modifier.fillMaxWidth().testTag("promise-status-$value").clickable(enabled = !busy && !attempted && !stale) { update("status", value) }, verticalAlignment = Alignment.CenterVertically) {
                            RadioButton(data.optString("status") == value, { update("status", value) }, enabled = !busy && !attempted && !stale); Text(label)
                        } } }
                        OutlinedTextField(data.text("notes", ""), { update("notes", it) }, enabled = !busy && !attempted && !stale, label = { Text("Notas de seguimiento") }, minLines = 3, modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        }
    }
    if (picker) ClientRecordPicker(vm, pages, { row -> update("idServicio", row.optInt("idServicio")); update("clientName", row.text("aliasNombre", row.text("nombre"))); picker = false }, { picker = false })
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Actualizar seguimiento") }, text = { Text("La promesa quedara ${promiseStatuses[data.optString("status")]?.lowercase()}. No se registrara un pago ni se modificara el saldo.") }, confirmButton = { TextButton(onClick = { confirm = false; submit() }) { Text("Confirmar estado") } }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar") } })
}

@Composable private fun ClientRecordPicker(vm: MainViewModel, pages: Map<String, PageState>, choose: (JSONObject) -> Unit, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    val path = "/clients?pageSize=20&page=$page&q=${URLEncoder.encode(query, "UTF-8") }"
    LaunchedEffect(search) { delay(300); query = search; page = 1 }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    AlertDialog(onDismissRequest = close, title = { Text("Cliente de la promesa") }, text = { Column {
        OutlinedTextField(search, { search = it }, label = { Text("Buscar cliente de la promesa") }, singleLine = true)
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.heightIn(max = 260.dp)) {
            val rows = state.body?.optJSONArray("items").objects()
            if (rows.isEmpty() && !state.loading) item { Text("Sin coincidencias") }
            items(rows) { row -> ListItem(headlineContent = { Text(row.text("aliasNombre", row.text("nombre"))) }, supportingContent = { Text(row.text("ip")) }, modifier = Modifier.clickable { choose(row) }) }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Clientes anteriores") }
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Clientes siguientes") }
        }
    } }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}

@Composable internal fun ClientRecordHistory(id: Int, vm: MainViewModel, pages: Map<String, PageState>) {
    var page by rememberSaveable(id) { mutableIntStateOf(1) }
    val path = "/clients/$id/history?page=$page&pageSize=20"
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val names = mapOf("client_alias_updated" to "Expediente actualizado", "mobile.client.note" to "Nota agregada", "payment_promise_created" to "Promesa creada", "payment_promise_updated" to "Promesa actualizada", "client_created" to "Cliente creado", "client_provisioned" to "Servicio aprovisionado")
    ReadStatus(state) { vm.load(path, true) }
    val rows = state.body?.optJSONArray("items").objects()
    if (rows.isEmpty() && !state.loading) EmptyState("Sin cambios registrados en este expediente")
    rows.forEach { row -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(names[row.text("action")] ?: "Actualizacion", fontWeight = FontWeight.SemiBold)
        Text("${row.text("createdAt").replace('T', ' ').take(16)} UTC", style = MaterialTheme.typography.bodySmall)
        Text(row.text("actor", "Sin autor registrado"), style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
    } }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Historial anterior") }
        IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Historial siguiente") }
    }
}
