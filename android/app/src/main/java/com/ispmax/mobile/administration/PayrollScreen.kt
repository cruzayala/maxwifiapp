package com.ispmax.mobile

import androidx.compose.foundation.clickable
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
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayrollScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var tab by rememberSaveable { mutableStateOf("payroll") }
    Column(Modifier.fillMaxSize()) {
        PrimaryTabRow(selectedTabIndex = if (tab == "payroll") 0 else 1) {
            Tab(selected = tab == "payroll", onClick = { tab = "payroll" }, text = { Text("Pagos") }, icon = { Icon(Icons.Outlined.Payments, null) })
            Tab(selected = tab == "employees", onClick = { tab = "employees" }, text = { Text("Empleados") }, icon = { Icon(Icons.Outlined.Badge, null) })
        }
        if (tab == "payroll") PayrollList(vm, pages) else EmployeeList(vm, pages)
    }
}

@Composable
private fun EmployeeList(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var active by rememberSaveable { mutableStateOf("all") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var editor by rememberSaveable { mutableIntStateOf(-1) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val path = "/employees?q=${URLEncoder.encode(query, "UTF-8")}&active=$active&page=$page&pageSize=30"
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${state.body?.optJSONObject("summary")?.optInt("active") ?: 0} activos", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Base mensual ${money(state.body?.optJSONObject("summary")?.optDouble("monthlyBase", 0.0) ?: 0.0)}", style = MaterialTheme.typography.bodySmall)
            }
            FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.PersonAdd, "Nuevo empleado") }
        }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar empleado") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(selected = active == "all", onClick = { active = "all"; page = 1 }, label = { Text("Todos") })
            FilterChip(selected = active == "true", onClick = { active = "true"; page = 1 }, label = { Text("Activos") })
            FilterChip(selected = active == "false", onClick = { active = "false"; page = 1 }, label = { Text("Inactivos") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar empleados") }
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay empleados para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.text("fullName"), fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text("${row.text("position", "Sin cargo")} · ${money(row.optDouble("baseSalary"))}\n${row.optJSONObject("_count")?.optInt("payroll") ?: 0} pagos registrados") },
                        leadingContent = { Icon(if (row.optBoolean("active")) Icons.Outlined.Person else Icons.Outlined.PersonOff, null) },
                        trailingContent = { StatusBadge(if (row.optBoolean("active")) "Activo" else "Inactivo") },
                    )
                }
            }
        }
        Pager(page, state.body?.optBoolean("hasMore") == true, state.loading, { page-- }, { page++ })
    }
    selected?.let { EmployeeActions(JSONObject(it), vm, { editor = JSONObject(it).optInt("id"); selected = null }, { selected = null }) }
    if (editor >= 0) EmployeeEditor(editor, vm) { editor = -1; vm.load(path, true) }
}

@Composable
private fun PayrollList(vm: MainViewModel, pages: Map<String, PageState>) {
    var status by rememberSaveable { mutableStateOf("") }
    var period by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var editor by rememberSaveable { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val path = "/payroll?status=$status&period=${URLEncoder.encode(period, "UTF-8")}&page=$page&pageSize=30"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    val summary = state.body?.optJSONObject("summary")
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(money(summary?.optJSONObject("paid")?.optDouble("amount", 0.0) ?: 0.0), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("Pagado · pendiente ${money(summary?.optJSONObject("pending")?.optDouble("amount", 0.0) ?: 0.0)}", style = MaterialTheme.typography.bodySmall)
            }
            FilledTonalIconButton(onClick = { editor = true }) { Icon(Icons.Outlined.AddCard, "Registrar nomina") }
        }
        OutlinedTextField(period, { period = it; page = 1 }, label = { Text("Buscar periodo") }, leadingIcon = { Icon(Icons.Outlined.DateRange, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = status == "", onClick = { status = ""; page = 1 }, label = { Text("Todas") })
            FilterChip(selected = status == "pending", onClick = { status = "pending"; page = 1 }, label = { Text("Pendientes") })
            FilterChip(selected = status == "paid", onClick = { status = "paid"; page = 1 }, label = { Text("Pagadas") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar nomina") }
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay registros de nomina") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.optJSONObject("employee")?.text("fullName") ?: "Empleado #${row.optInt("employeeId")}", fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text("${row.text("period")} · ${row.text("periodStart").take(10)} al ${row.text("periodEnd").take(10)}") },
                        trailingContent = { Column(horizontalAlignment = Alignment.End) { Text(money(row.optDouble("netAmount")), fontWeight = FontWeight.Bold); StatusBadge(row.text("status")) } },
                    )
                }
            }
        }
        Pager(page, state.body?.optBoolean("hasMore") == true, state.loading, { page-- }, { page++ })
    }
    selected?.let { PayrollActions(JSONObject(it), vm, { selected = null; vm.load(path, true) }, { selected = null }) }
    if (editor) PayrollEditor(vm, pages) { editor = false; vm.load(path, true) }
}

@Composable
private fun Pager(page: Int, hasMore: Boolean, busy: Boolean, previous: () -> Unit, next: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = previous, enabled = page > 1 && !busy) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
        Text("Pagina $page", style = MaterialTheme.typography.labelLarge)
        IconButton(onClick = next, enabled = hasMore && !busy) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
    }
}

@Composable
private fun EmployeeActions(row: JSONObject, vm: MainViewModel, edit: () -> Unit, close: () -> Unit) {
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var confirm by rememberSaveable { mutableStateOf(false) }
    val key = rememberSaveable { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(if (confirm) "Dar de baja" else row.text("fullName")) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(row.text("position", "Sin cargo")); Text("Salario base: ${money(row.optDouble("baseSalary"))}")
            row.text("phone", "").takeIf { it.isNotBlank() }?.let { Text("Telefono: $it") }
            if (confirm) Notice(if ((row.optJSONObject("_count")?.optInt("payroll") ?: 0) > 0) "Se desactivara; su historial de nomina se conserva." else "El registro se eliminara porque no tiene nomina.")
            error?.let { Notice(it, true) }
        }
    }, confirmButton = {
        Button(enabled = !busy, onClick = {
            if (!confirm) edit() else scope.launch { busy = true; try { vm.deleteEmployee(row.optInt("id"), key, row.getString("version")); close() } catch (e: Exception) { error = e.message } finally { busy = false } }
        }) { Icon(if (confirm) Icons.Outlined.PersonOff else Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text(if (confirm) "Confirmar baja" else "Editar") }
    }, dismissButton = { Row { if (!confirm && row.optBoolean("active")) IconButton(onClick = { confirm = true }) { Icon(Icons.Outlined.PersonOff, "Dar de baja") }; TextButton(onClick = { if (confirm) confirm = false else close() }) { Text("Cerrar") } } })
}

@Composable
private fun PayrollActions(row: JSONObject, vm: MainViewModel, changed: () -> Unit, close: () -> Unit) {
    var action by rememberSaveable { mutableStateOf("") }
    var method by rememberSaveable { mutableStateOf("transferencia") }
    var date by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val key = rememberSaveable(action) { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(if (action == "pay") "Confirmar pago" else if (action == "delete") "Eliminar registro" else row.text("period")) }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(row.optJSONObject("employee")?.text("fullName") ?: "Empleado #${row.optInt("employeeId")}")
            Text(money(row.optDouble("netAmount")), style = MaterialTheme.typography.titleLarge)
            StatusBadge(row.text("status"))
            if (action == "pay") {
                OutlinedTextField(date, { date = it }, label = { Text("Fecha (AAAA-MM-DD)") }, singleLine = true)
                OptionField("Forma", method, linkedMapOf("transferencia" to "Transferencia", "efectivo" to "Efectivo", "cheque" to "Cheque")) { method = it }
                Notice("El pago genera un gasto de nomina y conserva el historial.")
            }
            if (action == "delete") Notice("Solo se puede eliminar una nomina que no este pagada.")
            error?.let { Notice(it, true) }
        }
    }, confirmButton = {
        if (action == "delete" || row.optString("status") == "pending") Button(enabled = !busy, onClick = {
            if (action.isBlank()) action = "pay" else scope.launch { busy = true; error = null; try {
                if (action == "pay") vm.payPayroll(row.optInt("id"), JSONObject().put("paidAt", date).put("paymentMethod", method), key, row.getString("version"))
                else vm.deletePayroll(row.optInt("id"), key, row.getString("version")); changed()
            } catch (e: Exception) { error = e.message } finally { busy = false } }
        }) { Icon(if (action == "delete") Icons.Outlined.DeleteOutline else Icons.Outlined.DoneAll, null); Spacer(Modifier.width(8.dp)); Text(if (action == "pay") "Registrar pago" else if (action == "delete") "Eliminar" else "Marcar pagada") }
    }, dismissButton = { Row { if (row.optString("status") != "paid" && action.isBlank()) IconButton(onClick = { action = "delete" }) { Icon(Icons.Outlined.DeleteOutline, "Eliminar nomina") }; TextButton(onClick = { if (action.isNotBlank()) action = "" else close() }) { Text(if (action.isNotBlank()) "Volver" else "Cerrar") } } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EmployeeEditor(id: Int, vm: MainViewModel, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) {
        try {
            raw = (vm.employeeDraft(id) ?: if (id == 0) JSONObject().put("baseSalary", "0").put("active", true).put("key", UUID.randomUUID().toString()) else vm.employeeForEdit(id).put("key", UUID.randomUUID().toString())).toString()
            loaded = true
        } catch (e: Exception) { error = e.message }
    }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.saveEmployeeDraft(id, JSONObject(raw)) } }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    FullEditor(if (id == 0) "Nuevo empleado" else "Editar empleado", busy, close, {
        scope.launch { busy = true; error = null; try {
            val form = JSONObject(raw)
            val body = JSONObject()
            for (field in listOf("fullName", "documentId", "position", "email", "phone", "baseSalary", "hiredAt", "notes")) if (form.has(field)) body.put(field, form.opt(field))
            if (id > 0) body.put("active", form.optBoolean("active", true))
            vm.saveEmployee(id, body, form.getString("key"), if (id == 0) null else form.getString("version")); loaded = false; close()
        } catch (e: Exception) { error = e.message } finally { busy = false } }
    }) {
        if (!loaded && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        error?.let { Notice(it, true) }
        val form = JSONObject(raw)
        val enabled = loaded && !busy
        for ((field, label) in listOf("fullName" to "Nombre completo", "documentId" to "Cedula o documento", "position" to "Cargo", "phone" to "Telefono", "email" to "Correo", "baseSalary" to "Salario base", "hiredAt" to "Fecha de ingreso (AAAA-MM-DD)", "notes" to "Notas")) {
            OutlinedTextField(form.text(field, ""), { update(field, it) }, label = { Text(label) }, enabled = enabled, singleLine = field != "notes", modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = if (field == "baseSalary") KeyboardType.Decimal else KeyboardType.Text))
        }
        if (id > 0) Row(verticalAlignment = Alignment.CenterVertically) { Switch(form.optBoolean("active", true), { update("active", it) }, enabled = enabled); Spacer(Modifier.width(10.dp)); Text("Empleado activo") }
        TextButton(onClick = { scope.launch { vm.discardEmployeeDraft(id); loaded = false; close() } }, enabled = enabled) { Text("Descartar borrador") }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PayrollEditor(vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val employeesPath = "/employees?active=true&pageSize=100"
    LaunchedEffect(Unit) { vm.load(employeesPath, true) }
    val employees = pages[employeesPath]?.body?.optJSONArray("items").objects()
    var raw by rememberSaveable { mutableStateOf("{}") }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var picker by rememberSaveable { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val now = YearMonth.now()
        raw = (vm.payrollDraft(0) ?: JSONObject().put("period", now.toString()).put("periodStart", now.atDay(1).toString()).put("periodEnd", now.atEndOfMonth().toString()).put("baseAmount", "0").put("bonus", "0").put("deductions", "0").put("status", "pending").put("key", UUID.randomUUID().toString())).toString()
        loaded = true
    }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.savePayrollDraft(0, JSONObject(raw)) } }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    FullEditor("Registrar nomina", busy, close, {
        scope.launch { busy = true; error = null; try {
            val form = JSONObject(raw)
            val body = JSONObject()
            for (field in listOf("employeeId", "period", "periodStart", "periodEnd", "baseAmount", "bonus", "deductions", "status", "notes")) body.put(field, form.opt(field))
            vm.createPayroll(body, form.getString("key")); loaded = false; close()
        } catch (e: Exception) { error = e.message } finally { busy = false } }
    }) {
        val form = JSONObject(raw); val enabled = loaded && !busy
        error?.let { Notice(it, true) }
        OutlinedButton(onClick = { picker = true }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonSearch, null); Spacer(Modifier.width(8.dp)); Text(form.text("employeeName", "Seleccionar empleado"), Modifier.weight(1f)) }
        for ((field, label) in listOf("period" to "Periodo", "periodStart" to "Desde (AAAA-MM-DD)", "periodEnd" to "Hasta (AAAA-MM-DD)", "baseAmount" to "Monto base", "bonus" to "Bono", "deductions" to "Deducciones", "notes" to "Notas")) {
            OutlinedTextField(form.text(field, ""), { update(field, it) }, label = { Text(label) }, enabled = enabled, singleLine = field != "notes", modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = if (field in listOf("baseAmount", "bonus", "deductions")) KeyboardType.Decimal else KeyboardType.Text))
        }
        val net = form.optString("baseAmount").toDoubleOrNull().orZero() + form.optString("bonus").toDoubleOrNull().orZero() - form.optString("deductions").toDoubleOrNull().orZero()
        Text("Neto calculado: ${money(net)}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        TextButton(onClick = { scope.launch { vm.discardPayrollDraft(0); loaded = false; close() } }, enabled = enabled) { Text("Descartar borrador") }
    }
    if (picker) AlertDialog(onDismissRequest = { picker = false }, title = { Text("Seleccionar empleado") }, text = {
        LazyColumn(Modifier.heightIn(max = 360.dp)) { items(employees, key = { it.optInt("id") }) { row -> ListItem(headlineContent = { Text(row.text("fullName")) }, supportingContent = { Text(row.text("position", "Sin cargo")) }, modifier = Modifier.clickable { update("employeeId", row.optInt("id")); update("employeeName", row.text("fullName")); update("baseAmount", row.optDouble("baseSalary").toString()); picker = false }) } }
    }, confirmButton = { TextButton(onClick = { picker = false }) { Text("Cancelar") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FullEditor(title: String, busy: Boolean, close: () -> Unit, save: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!busy) close() }) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } }) }, bottomBar = {
                Button(onClick = save, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else "Guardar") }
            }) { padding -> Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content) }
        }
    }
}

private fun Double?.orZero() = this ?: 0.0
