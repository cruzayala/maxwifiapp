package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.net.URLEncoder

@Composable
fun TicketsScreen(vm: MainViewModel, pages: Map<String, PageState>, canWrite: Boolean) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var status by rememberSaveable { mutableStateOf("") }
    var priority by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var selected by rememberSaveable { mutableIntStateOf(0) }
    var editor by rememberSaveable { mutableIntStateOf(-1) }
    val path = "/tickets?q=${URLEncoder.encode(query, "UTF-8")}&status=${URLEncoder.encode(status, "UTF-8")}&priority=${URLEncoder.encode(priority, "UTF-8")}&page=$page&pageSize=30"
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    val summary = state.body?.optJSONObject("summary")
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("${state.body?.optInt("total") ?: 0} tickets", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("Espejo WispHub · ${state.body?.text("syncedAt", "Sin sincronizar")}", style = MaterialTheme.typography.bodySmall) }
            if (canWrite) FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.Add, "Crear ticket") }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar tickets") }
        }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar ticket") }, placeholder = { Text("Asunto, cliente o tecnico") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val statuses = linkedSetOf("").apply { summary?.optJSONObject("byStatus")?.keys()?.forEachRemaining { add(it) } }
            statuses.forEach { value -> FilterChip(status == value, { status = value; page = 1 }, label = { Text(if (value.isBlank()) "Todos" else value) }) }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val priorities = linkedSetOf("").apply { summary?.optJSONObject("byPriority")?.keys()?.forEachRemaining { add(it) } }
            priorities.forEach { value -> FilterChip(priority == value, { priority = value; page = 1 }, label = { Text(if (value.isBlank()) "Toda prioridad" else value) }) }
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay tickets con estos filtros") }
            items(rows, key = { it.optInt("idTicket") }) { row ->
                OutlinedCard(onClick = { selected = row.optInt("idTicket") }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.text("asunto", "Ticket #${row.optInt("idTicket")}"), fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text("${row.text("cliente", "Sin cliente")} · ${row.text("asignado", "Sin asignar")}") },
                        leadingContent = { Icon(Icons.Outlined.ConfirmationNumber, null) },
                        trailingContent = { Column(horizontalAlignment = Alignment.End) { StatusBadge(row.text("estado")); Text(row.text("prioridad"), style = MaterialTheme.typography.labelSmall) } },
                    )
                }
            }
        }
        SupportPager(page, state.body?.optBoolean("hasMore") == true, state.loading, { page-- }, { page++ })
    }
    if (selected > 0) TicketDetail(selected, vm, pages, canWrite, { editor = selected }) { selected = 0 }
    if (editor >= 0) TicketEditor(editor, vm, pages) { editor = -1; selected = 0; vm.load(path, true) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TicketDetail(id: Int, vm: MainViewModel, pages: Map<String, PageState>, canWrite: Boolean, edit: () -> Unit, close: () -> Unit) {
    val path = "/tickets/$id"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    ModalBottomSheet(onDismissRequest = close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(.86f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Ticket #$id", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge); IconButton(onClick = close) { Icon(Icons.Outlined.Close, "Cerrar ticket") } }
            ReadStatus(state) { vm.load(path, true) }
            state.body?.let { row ->
                Text(row.text("asunto"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { StatusBadge(row.text("estado")); AssistChip({}, label = { Text(row.text("prioridad")) }) }
                Text("Cliente: ${row.text("cliente", "Sin cliente")}")
                Text("Asignado: ${row.text("asignado", "Sin asignar")}")
                Text("Creado: ${row.text("fechaCreacion")}")
                Text("Actualizado: ${row.text("fechaActualizacion")}")
                HorizontalDivider(); Text("Descripcion", style = MaterialTheme.typography.titleMedium)
                Text(row.text("descripcion", "Sin descripcion"))
                row.optJSONObject("client")?.let { client ->
                    HorizontalDivider(); Text("Servicio relacionado", style = MaterialTheme.typography.titleMedium)
                    Text(client.text("nombre"), fontWeight = FontWeight.SemiBold); Text("${client.text("ip")} · ${client.text("telefono")}"); StatusBadge(client.text("estado"))
                }
                Notice("Este expediente refleja WispHub. Una edicion solo se confirma despues de leer nuevamente el ticket.")
            }
        }
        if (canWrite && state.body != null) Button(onClick = edit, modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text("Editar o cerrar ticket") }
    }
}

@Composable
fun PlansScreen(vm: MainViewModel, pages: Map<String, PageState>, onPlanClients: (String) -> Unit = {}) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    val path = "/plans?q=${URLEncoder.encode(query, "UTF-8")}"
    LaunchedEffect(search) { delay(300); query = search }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    val summary = state.body?.optJSONObject("summary")
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("${state.body?.optInt("total") ?: 0} planes", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("${summary?.optInt("active") ?: 0} servicios activos", style = MaterialTheme.typography.bodySmall) }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar planes") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            PlanMetric("Clientes", summary?.optInt("clients")?.toString() ?: "0", Modifier.weight(1f))
            PlanMetric("Entra al mes", money(summary?.optDouble("expectedMonthly") ?: 0.0), Modifier.weight(1f))
            PlanMetric("Por revisar", summary?.optInt("toReview")?.toString() ?: "0", Modifier.weight(1f))
        }
        OutlinedTextField(search, { search = it }, label = { Text("Buscar plan") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay planes disponibles") }
            items(rows, key = { it.optInt("id") }) { plan ->
                OutlinedCard(Modifier.fillMaxWidth()) { Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Speed, null); Spacer(Modifier.width(10.dp)); Text(plan.text("nombre"), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text("${plan.optInt("clientCount")} clientes", style = MaterialTheme.typography.labelLarge) }
                    LinearProgressIndicator(progress = { if ((summary?.optInt("clients") ?: 0) > 0) plan.optInt("clientCount").toFloat() / summary!!.optInt("clients") else 0f }, modifier = Modifier.fillMaxWidth())
                    Text("${plan.optInt("activeCount")} activos · ${money(plan.optDouble("expectedMonthly"))}/mes", style = MaterialTheme.typography.bodyMedium)
                    val min = plan.optDouble("observedPriceMin"); val max = plan.optDouble("observedPriceMax")
                    val typical = plan.optDouble("typicalPrice", max)
                    Text(if (min == max) "Precio ${money(typical)}" else "Precio de la mayoria ${money(typical)} (hay de ${money(min)} a ${money(max)})", style = MaterialTheme.typography.bodySmall)
                    if (plan.optDouble("averagePerActive") > 0) Text("Promedio por cliente activo ${money(plan.optDouble("averagePerActive"))}", style = MaterialTheme.typography.bodySmall)
                    plan.optJSONArray("review").let { review -> (0 until (review?.length() ?: 0)).map { review!!.optString(it) } }.forEach { reason ->
                        Surface(color = com.ispmax.mobile.ui.IspAmber.copy(alpha = .1f), contentColor = com.ispmax.mobile.ui.IspAmber, shape = MaterialTheme.shapes.small) { Text("Revisar: $reason", Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelMedium) }
                    }
                    if (plan.optInt("clientCount") > 0) TextButton(onClick = { onPlanClients(plan.optString("nombre")) }, contentPadding = PaddingValues(0.dp)) { Text("Ver clientes de este plan") }
                    Text(plan.text("tipo", "Simple Queue"), style = MaterialTheme.typography.labelSmall)
                } }
            }
        }
    }
}

@Composable
private fun PlanMetric(label: String, value: String, modifier: Modifier) {
    OutlinedCard(modifier) { Column(Modifier.padding(12.dp)) { Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.labelSmall) } }
}

@Composable
private fun SupportPager(page: Int, hasMore: Boolean, busy: Boolean, previous: () -> Unit, next: () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = previous, enabled = page > 1 && !busy) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
        Text("Pagina $page", style = MaterialTheme.typography.labelLarge)
        IconButton(onClick = next, enabled = hasMore && !busy) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
    }
}
