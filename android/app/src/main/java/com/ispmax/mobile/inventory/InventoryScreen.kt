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
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.LocalDate
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun InventoryScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var tab by rememberSaveable { mutableStateOf("equipment") }
    Column(Modifier.fillMaxSize()) {
        PrimaryTabRow(selectedTabIndex = listOf("equipment", "purchases", "types").indexOf(tab)) {
            Tab(tab == "equipment", { tab = "equipment" }, text = { Text("Equipos") }, icon = { Icon(Icons.Outlined.Router, null) })
            Tab(tab == "purchases", { tab = "purchases" }, text = { Text("Compras") }, icon = { Icon(Icons.Outlined.ShoppingCart, null) })
            Tab(tab == "types", { tab = "types" }, text = { Text("Tipos") }, icon = { Icon(Icons.Outlined.Category, null) })
        }
        when (tab) {
            "purchases" -> PurchaseList(vm, pages)
            "types" -> InventoryTypeList(vm, pages)
            else -> EquipmentScreen(vm, pages)
        }
    }
}

@Composable
private fun PurchaseList(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var editor by rememberSaveable { mutableStateOf(false) }
    var selected by rememberSaveable { mutableIntStateOf(0) }
    val path = "/inventory/purchases?q=${URLEncoder.encode(query, "UTF-8")}&page=$page&pageSize=30"
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(money(state.body?.optJSONObject("summary")?.optDouble("total", 0.0) ?: 0.0), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("${state.body?.optInt("total") ?: 0} compras registradas", style = MaterialTheme.typography.bodySmall)
            }
            FilledTonalIconButton(onClick = { editor = true }) { Icon(Icons.Outlined.AddShoppingCart, "Nueva compra") }
        }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar compra") }, placeholder = { Text("Proveedor, comprobante o nota") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Procedencia y gastos vinculados", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar compras") }
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay compras registradas") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.optInt("id") }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.text("supplier", "Compra #${row.optInt("id")}"), fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text("${row.text("invoiceRef", "Sin comprobante")} · ${row.text("purchasedAt").take(10)}\n${row.optJSONArray("items")?.length() ?: 0} articulos · ${row.optInt("equipmentCount")} equipos") },
                        leadingContent = { Icon(Icons.Outlined.ReceiptLong, null) },
                        trailingContent = { Text(money(row.optDouble("total")), fontWeight = FontWeight.Bold) },
                    )
                }
            }
        }
        InventoryPager(page, state.body?.optBoolean("hasMore") == true, state.loading, { page-- }, { page++ })
    }
    if (selected > 0) PurchaseDetail(selected, vm, pages) { selected = 0; vm.load(path, true) }
    if (editor) PurchaseEditor(vm, pages) { editor = false; vm.load(path, true) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PurchaseDetail(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = "/inventory/purchases/$id"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    var confirmDelete by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val key = rememberSaveable { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    ModalBottomSheet(onDismissRequest = { if (!busy) close() }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.9f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Compra #$id", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Cerrar compra") } }
            ReadStatus(state) { vm.load(path, true) }
            state.body?.let { row ->
                Text(row.text("supplier", "Proveedor no indicado"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text("Comprobante: ${row.text("invoiceRef", "Sin comprobante")}")
                Text("Fecha: ${row.text("purchasedAt").take(10)}")
                Text("Total: ${money(row.optDouble("total"))}", style = MaterialTheme.typography.titleLarge)
                if (!row.isNull("notes")) Text(row.text("notes"))
                HorizontalDivider(); Text("Articulos", style = MaterialTheme.typography.titleMedium)
                row.optJSONArray("items").objects().forEach { item ->
                    ListItem(headlineContent = { Text(item.optJSONObject("type")?.text("name") ?: "Tipo #${item.optInt("typeId")}") },
                        supportingContent = { Text("${item.optDouble("quantity")} ${item.optJSONObject("type")?.text("unit", "u")}") },
                        trailingContent = { Text(money(item.optDouble("subtotal"))) })
                }
                if (row.optInt("equipmentCount") > 0) Notice("Esta compra genero ${row.optInt("equipmentCount")} equipos. Su procedencia queda protegida y no se puede borrar.")
                row.optJSONObject("expense")?.let { Text("Gasto vinculado #${it.optInt("id")} · ${money(it.optDouble("amount"))}", style = MaterialTheme.typography.bodySmall) }
                error?.let { Notice(it, true) }
                if (row.optBoolean("canDelete")) {
                    if (!confirmDelete) TextButton(onClick = { confirmDelete = true }) { Icon(Icons.Outlined.DeleteOutline, null); Spacer(Modifier.width(8.dp)); Text("Eliminar compra") }
                    else Button(onClick = { scope.launch { busy = true; try { vm.deletePurchase(id, key, row.getString("version")); close() } catch (e: Exception) { error = e.message } finally { busy = false } } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (busy) "Eliminando..." else "Confirmar eliminacion") }
                }
            }
        }
    }
}

@Composable
private fun InventoryTypeList(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var editor by rememberSaveable { mutableIntStateOf(-1) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    val path = "/inventory/types?q=${URLEncoder.encode(query, "UTF-8")}&page=$page&pageSize=30"
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Catalogo de inventario", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("${state.body?.optInt("total") ?: 0} tipos", style = MaterialTheme.typography.bodySmall) }; FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.Add, "Nuevo tipo") } }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar tipo") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay tipos de inventario") }
            items(rows, key = { it.optInt("id") }) { row -> OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                ListItem(headlineContent = { Text(row.text("name"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${categoryLabels[row.text("category")] ?: row.text("category")} · ${unitLabels[row.text("unit")] ?: row.text("unit")}\n${row.optInt("equipmentCount")} equipos · ${row.optInt("purchaseCount")} compras") }, leadingContent = { Icon(Icons.Outlined.Category, null) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null) })
            } }
        }
        InventoryPager(page, state.body?.optBoolean("hasMore") == true, state.loading, { page-- }, { page++ })
    }
    selected?.let { TypeActions(JSONObject(it), vm, { editor = JSONObject(it).optInt("id"); selected = null }, { selected = null }) }
    if (editor >= 0) InventoryTypeEditor(editor, vm) { editor = -1; vm.load(path, true) }
}

@Composable
private fun TypeActions(row: JSONObject, vm: MainViewModel, edit: () -> Unit, close: () -> Unit) {
    var remove by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val key = rememberSaveable { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(row.text("name")) }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("${categoryLabels[row.text("category")]} · ${unitLabels[row.text("unit")]}")
        row.text("description", "").takeIf { it.isNotBlank() }?.let { Text(it) }
        Text("${row.optInt("equipmentCount")} equipos · ${row.optInt("purchaseCount")} compras")
        if (!row.optBoolean("canDelete")) Notice("Este tipo esta en uso y debe conservarse.")
        if (remove) Notice("Se eliminara solamente este tipo sin uso.")
        error?.let { Notice(it, true) }
    } }, confirmButton = { Button(enabled = !busy, onClick = { if (!remove) edit() else scope.launch { busy = true; try { vm.deleteInventoryType(row.optInt("id"), key, row.getString("version")); close() } catch (e: Exception) { error = e.message } finally { busy = false } } }) { Icon(if (remove) Icons.Outlined.DeleteOutline else Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text(if (remove) "Confirmar" else "Editar") } }, dismissButton = { Row { if (!remove && row.optBoolean("canDelete")) IconButton(onClick = { remove = true }) { Icon(Icons.Outlined.DeleteOutline, "Eliminar tipo") }; TextButton(onClick = { if (remove) remove = false else close() }) { Text(if (remove) "Volver" else "Cerrar") } } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InventoryTypeEditor(id: Int, vm: MainViewModel, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var categoryOpen by remember { mutableStateOf(false) }
    var unitOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) { try { raw = (if (id == 0) JSONObject().put("category", "otro").put("unit", "u") else vm.inventoryTypeForEdit(id)).put("key", UUID.randomUUID().toString()).toString(); loaded = true } catch (e: Exception) { error = e.message } }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    InventoryEditor(if (id == 0) "Nuevo tipo" else "Editar tipo", busy, close, { scope.launch { busy = true; error = null; try { val form = JSONObject(raw); val body = JSONObject(); listOf("name", "category", "unit", "description").forEach { body.put(it, form.opt(it)) }; vm.saveInventoryType(id, body, form.getString("key"), if (id == 0) null else form.getString("version")); close() } catch (e: Exception) { error = e.message } finally { busy = false } } }) {
        error?.let { Notice(it, true) }; val form = JSONObject(raw)
        OutlinedTextField(form.text("name", ""), { update("name", it) }, label = { Text("Nombre") }, enabled = loaded && !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
        Box { OutlinedButton(onClick = { categoryOpen = true }, enabled = loaded && !busy, modifier = Modifier.fillMaxWidth()) { Text(categoryLabels[form.text("category")] ?: "Categoria", Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }; DropdownMenu(categoryOpen, { categoryOpen = false }) { categoryLabels.forEach { (value, label) -> DropdownMenuItem({ Text(label) }, { update("category", value); categoryOpen = false }) } } }
        Box { OutlinedButton(onClick = { unitOpen = true }, enabled = loaded && !busy, modifier = Modifier.fillMaxWidth()) { Text(unitLabels[form.text("unit")] ?: "Unidad", Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }; DropdownMenu(unitOpen, { unitOpen = false }) { unitLabels.forEach { (value, label) -> DropdownMenuItem({ Text(label) }, { update("unit", value); unitOpen = false }) } } }
        OutlinedTextField(form.text("description", ""), { update("description", it) }, label = { Text("Descripcion") }, enabled = loaded && !busy, modifier = Modifier.fillMaxWidth(), minLines = 3)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PurchaseEditor(vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val typesPath = "/inventory/types?pageSize=100"
    LaunchedEffect(Unit) { vm.load(typesPath, true) }
    val types = pages[typesPath]?.body?.optJSONArray("items").objects()
    var raw by rememberSaveable { mutableStateOf("{}") }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var pickerIndex by rememberSaveable { mutableIntStateOf(-1) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        raw = (vm.purchaseDraft() ?: JSONObject().put("purchasedAt", LocalDate.now().toString()).put("createEquipment", true).put("key", UUID.randomUUID().toString()).put("items", JSONArray().put(JSONObject().put("quantity", "1").put("unitPrice", "0")))).toString(); loaded = true
    }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.savePurchaseDraft(JSONObject(raw)) } }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    fun updateItem(index: Int, field: String, value: Any) { val form = JSONObject(raw); form.getJSONArray("items").getJSONObject(index).put(field, value); raw = form.put("key", UUID.randomUUID().toString()).toString() }
    InventoryEditor("Registrar compra", busy, close, { scope.launch { busy = true; error = null; try {
        val form = JSONObject(raw); val body = JSONObject(); listOf("supplier", "invoiceRef", "purchasedAt", "notes", "createEquipment").forEach { body.put(it, form.opt(it)) }
        val resultItems = JSONArray(); form.getJSONArray("items").objects().forEach { source -> val item = JSONObject(); listOf("typeId", "quantity", "unitPrice", "notes", "brand", "model").forEach { if (source.has(it)) item.put(it, source.opt(it)) }; val serials = JSONArray(); source.text("serials", "").split(',', '\n').map { it.trim() }.filter { it.isNotBlank() }.forEach { serials.put(it) }; item.put("serials", serials); resultItems.put(item) }; body.put("items", resultItems)
        vm.createPurchase(body, form.getString("key")); loaded = false; close()
    } catch (e: Exception) { error = e.message } finally { busy = false } } }) {
        error?.let { Notice(it, true) }; val form = JSONObject(raw); val enabled = loaded && !busy
        OutlinedTextField(form.text("supplier", ""), { update("supplier", it) }, label = { Text("Proveedor") }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(form.text("invoiceRef", ""), { update("invoiceRef", it) }, label = { Text("Comprobante") }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(form.text("purchasedAt", ""), { update("purchasedAt", it) }, label = { Text("Fecha (AAAA-MM-DD)") }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(verticalAlignment = Alignment.CenterVertically) { Switch(form.optBoolean("createEquipment", true), { update("createEquipment", it) }, enabled = enabled); Spacer(Modifier.width(10.dp)); Text("Crear equipos unitarios en stock") }
        HorizontalDivider(); Text("Articulos", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        val itemRows = form.optJSONArray("items").objects()
        itemRows.forEachIndexed { index, item ->
            OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) { Text("Articulo ${index + 1}", Modifier.weight(1f), fontWeight = FontWeight.SemiBold); if (itemRows.size > 1) IconButton(onClick = { val next = JSONArray(); itemRows.forEachIndexed { i, row -> if (i != index) next.put(row) }; update("items", next) }) { Icon(Icons.Outlined.Close, "Quitar articulo") } }
                OutlinedButton(onClick = { pickerIndex = index }, enabled = enabled, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Category, null); Spacer(Modifier.width(8.dp)); Text(item.text("typeName", "Seleccionar tipo"), Modifier.weight(1f)) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(item.text("quantity", ""), { updateItem(index, "quantity", it) }, label = { Text("Cantidad") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = enabled, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(item.text("unitPrice", ""), { updateItem(index, "unitPrice", it) }, label = { Text("Precio unitario") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), enabled = enabled, singleLine = true, modifier = Modifier.weight(1f))
                }
                if (item.text("unit", "") == "u") {
                    OutlinedTextField(item.text("brand", ""), { updateItem(index, "brand", it) }, label = { Text("Marca") }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(item.text("model", ""), { updateItem(index, "model", it) }, label = { Text("Modelo") }, enabled = enabled, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(item.text("serials", ""), { updateItem(index, "serials", it) }, label = { Text("Seriales, uno por linea") }, enabled = enabled, modifier = Modifier.fillMaxWidth(), minLines = 2)
                }
            } }
        }
        OutlinedButton(onClick = { val next = form.getJSONArray("items"); next.put(JSONObject().put("quantity", "1").put("unitPrice", "0")); update("items", next) }, enabled = enabled && itemRows.size < 100, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(8.dp)); Text("Agregar articulo") }
        OutlinedTextField(form.text("notes", ""), { update("notes", it) }, label = { Text("Notas de la compra") }, enabled = enabled, modifier = Modifier.fillMaxWidth(), minLines = 3)
        val total = itemRows.sumOf { (it.optString("quantity").toDoubleOrNull() ?: 0.0) * (it.optString("unitPrice").toDoubleOrNull() ?: 0.0) }
        Text("Total: ${money(total)}", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        TextButton(onClick = { scope.launch { vm.discardPurchaseDraft(); loaded = false; close() } }, enabled = enabled) { Text("Descartar borrador") }
    }
    if (pickerIndex >= 0) AlertDialog(onDismissRequest = { pickerIndex = -1 }, title = { Text("Tipo de articulo") }, text = { LazyColumn(Modifier.heightIn(max = 420.dp)) { items(types, key = { it.optInt("id") }) { row -> ListItem(headlineContent = { Text(row.text("name")) }, supportingContent = { Text("${categoryLabels[row.text("category")]} · ${unitLabels[row.text("unit")]}") }, modifier = Modifier.clickable { updateItem(pickerIndex, "typeId", row.optInt("id")); updateItem(pickerIndex, "typeName", row.text("name")); updateItem(pickerIndex, "unit", row.text("unit")); pickerIndex = -1 }) } } }, confirmButton = { TextButton(onClick = { pickerIndex = -1 }) { Text("Cancelar") } })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun InventoryEditor(title: String, busy: Boolean, close: () -> Unit, save: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } }) }, bottomBar = { Button(onClick = save, enabled = !busy, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else "Guardar") } }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), content = content)
            }
        }
    }
}

@Composable
private fun InventoryPager(page: Int, hasMore: Boolean, busy: Boolean, previous: () -> Unit, next: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = previous, enabled = page > 1 && !busy) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
        Text("Pagina $page", style = MaterialTheme.typography.labelLarge)
        IconButton(onClick = next, enabled = hasMore && !busy) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
    }
}

private val categoryLabels = linkedMapOf("wifi" to "WiFi", "cable" to "Cable", "onu" to "ONU", "antena" to "Antena", "otro" to "Otro")
private val unitLabels = linkedMapOf("u" to "Unidad", "m" to "Metros", "kg" to "Kilogramos", "caja" to "Caja", "rollo" to "Rollo")
