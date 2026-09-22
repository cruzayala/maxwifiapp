package com.ispmax.mobile
import com.ispmax.mobile.ui.IspPrimaryButton as Button

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.data.ApiFailure
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalDate
import java.util.UUID

@Composable fun ExpensesScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("") }
    var from by rememberSaveable { mutableStateOf("") }
    var to by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var filters by rememberSaveable { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var editor by rememberSaveable { mutableIntStateOf(-1) }
    val path = "/expenses?q=${URLEncoder.encode(query, "UTF-8")}&page=$page&category=$category&from=$from&to=$to"
    LaunchedEffect(search) { delay(350); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Gastos registrados", style = MaterialTheme.typography.labelLarge)
                Text(state.body?.optJSONObject("summary")?.let { money(it.optDouble("amount", 0.0)) } ?: "--", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            }
            FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.Add, "Nuevo gasto") }
        }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar gasto o referencia") }, singleLine = true, modifier = Modifier.fillMaxWidth(), leadingIcon = { Icon(Icons.Outlined.Search, null) }, trailingIcon = { IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar busqueda de gastos") } })
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = { filters = true }) { Icon(Icons.Outlined.FilterList, null); Text("Filtros" + if (category.isNotBlank() || from.isNotBlank() || to.isNotBlank()) " activos" else "") }
            Text("${state.body?.optInt("total") ?: 0} registros", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar gastos") }
            ExportButton(rows.map { row -> JSONObject(row.toString()).apply { remove("version"); remove("editable"); remove("blockedReason") } }, "Gastos")
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay gastos para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(row.text("description"), fontWeight = FontWeight.SemiBold)
                        Text(money(row.optDouble("amount", 0.0)), style = MaterialTheme.typography.titleMedium)
                        Text("${expenseCategories[row.optString("category")] ?: row.text("category")} · ${row.text("expenseDate").take(10)}", style = MaterialTheme.typography.bodySmall)
                        if (!row.optBoolean("editable")) Text(row.text("blockedReason"), style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
            Text("Pagina $page")
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
        }
    }
    if (filters) ExpenseFilters(category, from, to, { c, f, t -> category = c; from = f; to = t; page = 1; filters = false }, { filters = false })
    selected?.let { json -> ExpenseDetails(JSONObject(json), !state.cached, vm, {
        editor = JSONObject(json).optInt("id"); selected = null
    }, { selected = null }) }
    if (editor >= 0) ExpenseEditor(editor, vm, pages) { editor = -1; vm.load(path, true) }
}

@Composable internal fun OptionField(label: String, value: String, options: Map<String, String>, enabled: Boolean = true, change: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(Modifier.fillMaxWidth()) {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("$label: ${options[value] ?: value.ifBlank { "Seleccionar" }}", Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null)
        }
        DropdownMenu(open, { open = false }, modifier = Modifier.heightIn(max = 280.dp)) {
            options.forEach { (key, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { change(key); open = false }) }
        }
    }
}

@Composable private fun ExpenseFilters(category: String, from: String, to: String, apply: (String, String, String) -> Unit, close: () -> Unit) {
    var c by rememberSaveable { mutableStateOf(category) }
    var f by rememberSaveable { mutableStateOf(from) }
    var t by rememberSaveable { mutableStateOf(to) }
    val invalid = f.isNotBlank() && runCatching { LocalDate.parse(f) }.isFailure || t.isNotBlank() && runCatching { LocalDate.parse(t) }.isFailure || f.isNotBlank() && t.isNotBlank() && f > t
    AlertDialog(onDismissRequest = close, title = { Text("Filtrar gastos") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OptionField("Categoria", c, linkedMapOf("" to "Todas") + expenseCategories) { c = it }
            OutlinedTextField(f, { f = it }, label = { Text("Desde (AAAA-MM-DD)") }, singleLine = true)
            OutlinedTextField(t, { t = it }, label = { Text("Hasta (AAAA-MM-DD)") }, singleLine = true)
            if (invalid) Text("Revisa el rango de fechas", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { c = ""; f = ""; t = "" }) { Text("Limpiar filtros") }
        }
    }, confirmButton = { Button(onClick = { apply(c, f, t) }, enabled = !invalid) { Icon(Icons.Outlined.FilterAlt, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Aplicar filtros") } }, dismissButton = { TextButton(onClick = close) { Text("Cancelar") } })
}

@Composable private fun ExpenseDetails(row: JSONObject, online: Boolean, vm: MainViewModel, edit: () -> Unit, close: () -> Unit) {
    var confirm by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val key = rememberSaveable { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(if (confirm) "Eliminar gasto" else "Detalle del gasto") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(row.text("description")); Text(money(row.optDouble("amount", 0.0)), style = MaterialTheme.typography.titleLarge)
            Text("Fecha: ${row.text("expenseDate").take(10)}")
            Text("Forma de pago: ${row.text("paymentMethod")}")
            Text("Referencia: ${row.text("reference")}")
            Text("Cliente: ${row.text("clientIdServicio", "Sin cliente asociado")}")
            if (!row.isNull("notes")) Text(row.text("notes"))
            if (!row.optBoolean("editable")) Notice(row.text("blockedReason"))
            if (!online) Notice("Actualiza en linea antes de modificar este gasto.")
            if (confirm) Text("Se eliminara este gasto; la auditoria del cambio se conserva.")
            error?.let { Notice(it, true) }
        }
    }, confirmButton = {
        if (row.optBoolean("editable") && online) Button(enabled = !busy, onClick = {
            if (!confirm) edit() else scope.launch { busy = true; error = null
                try { vm.deleteExpense(row.optInt("id"), key, row.getString("version")); close() }
                catch (e: Exception) { error = e.message } finally { busy = false }
            }
        }) { Icon(if (confirm) Icons.Outlined.DeleteOutline else Icons.Outlined.Edit, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(if (busy) "Eliminando..." else if (confirm) "Eliminar" else "Editar gasto") }
    }, dismissButton = {
        Row {
            if (!confirm && row.optBoolean("editable") && online) IconButton(onClick = { confirm = true }) { Icon(Icons.Outlined.DeleteOutline, "Eliminar gasto") }
            TextButton(onClick = { if (confirm) confirm = false else close() }, enabled = !busy) { Text(if (confirm) "Cancelar" else "Cerrar") }
        }
    })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ExpenseEditor(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var stale by rememberSaveable(id) { mutableStateOf(false) }
    var chooseClient by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val form = JSONObject(raw)
    val attempted = form.optBoolean("attempted")
    suspend fun loadEditor() {
        error = null
        try {
            val draft = vm.expenseDraft(id)
            if (draft != null) { raw = draft.toString(); loaded = true }
            else if (id == 0) { raw = JSONObject().put("category", "otros").put("expenseDate", LocalDate.now().toString()).put("key", UUID.randomUUID().toString()).toString(); loaded = true }
            else { raw = vm.expenseForEdit(id).apply { put("expenseDate", optString("expenseDate").take(10)); put("key", UUID.randomUUID().toString()) }.toString(); loaded = true }
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = e.message ?: "No se pudo consultar el gasto"
        }
    }
    LaunchedEffect(id) { if (!loaded) loadEditor() }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.saveExpenseDraft(id, JSONObject(raw)) } }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    val dismiss: () -> Unit = { if (!busy) scope.launch { if (loaded) vm.saveExpenseDraft(id, JSONObject(raw)); close() }; Unit }
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = dismiss) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Text(if (id == 0) "Nuevo gasto" else "Editar gasto") }, navigationIcon = { IconButton(onClick = dismiss, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar editor de gasto") } }) }, bottomBar = {
                Button(modifier = Modifier.fillMaxWidth().padding(16.dp), enabled = loaded && !busy && !stale && (id == 0 || form.optBoolean("editable", true)), onClick = {
                    scope.launch {
                        busy = true; error = null
                        try {
                            val payload = expenseRequest(JSONObject(raw))
                            raw = JSONObject(raw).put("attempted", true).toString()
                            vm.saveExpenseDraft(id, JSONObject(raw))
                            vm.saveExpense(id, payload, JSONObject(raw).getString("key"), if (id == 0) null else JSONObject(raw).getString("version"))
                            loaded = false
                            close()
                        } catch (e: Exception) {
                            if (e is kotlinx.coroutines.CancellationException) throw e
                            error = e.message ?: "No se pudo guardar"
                            stale = e is ApiFailure && e.code == "STALE_EXPENSE"
                            if (e !is java.io.IOException || e is ApiFailure && e.status in 400..499) raw = JSONObject(raw).put("attempted", false).toString()
                        } finally { busy = false }
                    }
                }) { Icon(if (attempted) Icons.Outlined.Refresh else Icons.Outlined.Save, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else if (attempted) "Reintentar misma operacion" else "Guardar gasto") }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!loaded && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (!loaded && error != null) TextButton(onClick = { scope.launch { loadEditor() } }) { Text("Reintentar") }
                    if (attempted) Notice("Operacion enviada. Verifica o reintenta la misma solicitud antes de cambiar los datos.")
                    error?.let { Notice(it, true) }
                    if (stale) TextButton(onClick = { scope.launch { loaded = false; vm.discardExpenseDraft(id); stale = false; loadEditor() } }) { Text("Descartar cambios y recargar gasto") }
                    val enabled = loaded && !busy && !attempted
                    OptionField("Categoria", form.optString("category"), expenseCategories, enabled) { update("category", it) }
                    for ((field, label) in listOf("description" to "Descripcion", "amount" to "Importe", "expenseDate" to "Fecha (AAAA-MM-DD)", "reference" to "Referencia", "notes" to "Notas del gasto")) {
                        OutlinedTextField(form.text(field, ""), { update(field, it) }, label = { Text(label) }, enabled = enabled, modifier = Modifier.fillMaxWidth(), singleLine = field != "notes", keyboardOptions = KeyboardOptions(keyboardType = if (field == "amount") KeyboardType.Decimal else KeyboardType.Text))
                    }
                    OptionField("Forma de pago", form.text("paymentMethod", ""), linkedMapOf("" to "Sin especificar", "efectivo" to "Efectivo", "transferencia" to "Transferencia", "tarjeta" to "Tarjeta"), enabled) { update("paymentMethod", it) }
                    OutlinedButton(onClick = { chooseClient = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonSearch, null); Text(form.text("clientName", if (form.optInt("clientIdServicio") > 0) "Cliente #${form.optInt("clientIdServicio")}" else "Asociar cliente")) }
                    if (form.optInt("clientIdServicio") > 0) TextButton(onClick = { update("clientIdServicio", JSONObject.NULL); update("clientName", JSONObject.NULL) }, enabled = enabled) { Text("Quitar cliente del gasto") }
                    if (!attempted) TextButton(onClick = { scope.launch { loaded = false; vm.discardExpenseDraft(id); close() } }, enabled = !busy) { Text("Descartar borrador") }
                }
            }
        }
    }
    if (chooseClient) ExpenseClientPicker(vm, pages, { client -> update("clientIdServicio", client.optInt("idServicio")); update("clientName", client.text("nombre")); chooseClient = false }, { chooseClient = false })
}

@Composable private fun ExpenseClientPicker(vm: MainViewModel, pages: Map<String, PageState>, choose: (JSONObject) -> Unit, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by remember { mutableStateOf("") }
    val path = "/clients?pageSize=20&q=${URLEncoder.encode(query, "UTF-8")}"
    LaunchedEffect(search) { delay(300); query = search }
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    AlertDialog(onDismissRequest = close, title = { Text("Asociar cliente") }, text = {
        Column {
            OutlinedTextField(search, { search = it }, label = { Text("Buscar cliente para gasto") }, singleLine = true)
            ReadStatus(state) { vm.load(path, true) }
            LazyColumn(Modifier.heightIn(max = 280.dp)) {
                if (state.body?.optJSONArray("items").objects().isEmpty() && !state.loading) item { Text("Sin clientes coincidentes") }
                items(state.body?.optJSONArray("items").objects(), key = { it.optInt("idServicio") }) { row -> ListItem(headlineContent = { Text(row.text("nombre")) }, supportingContent = { Text(row.text("ip")) }, modifier = Modifier.clickable { choose(row) }) }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cancelar") } })
}
