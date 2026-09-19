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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.ReliefIcon
import com.ispmax.mobile.ui.InvoiceDocumentDialog
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.net.URLEncoder

@Composable internal fun PaymentRequestsScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var state by rememberSaveable { mutableStateOf("open") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var document by rememberSaveable { mutableIntStateOf(0) }
    val path = "/payments?state=$state&page=$page&q=${URLEncoder.encode(query, "UTF-8")}" 
    LaunchedEffect(search) { delay(300); if (query != search) { query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path, true) }
    val result = pages[path] ?: PageState(loading = true)
    val rows = result.body?.optJSONArray("items").objects()
    val labels = mapOf("pending" to "Pendiente", "uncertain" to "Respuesta incierta", "confirmed_external" to "Verificando factura", "confirmed" to "Confirmado", "rejected" to "Rechazado")
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Buscar solicitudes por cliente") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("open" to "Por verificar", "confirmed" to "Confirmadas", "rejected" to "Rechazadas", "all" to "Todas").forEach { (value, label) -> FilterChip(state == value, { state = value; page = 1 }, label = { Text(label) }) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) { Text("${result.body?.optInt("total") ?: 0} solicitudes", Modifier.weight(1f)); IconButton(onClick = { vm.load(path, true) }, enabled = !result.loading) { Icon(Icons.Outlined.Refresh, "Actualizar solicitudes") } }
        ReadStatus(result) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !result.loading && result.error == null) item { EmptyState("Sin solicitudes para estos filtros") }
            items(rows, key = { it.text("id") }) { row ->
                OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        ReliefIcon(if (row.text("state") == "confirmed") Icons.Outlined.CheckCircle else Icons.Outlined.Schedule, size = 40.dp)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(row.text("clientName"), fontWeight = FontWeight.SemiBold)
                            Text(money(row.optDouble("amount")), style = MaterialTheme.typography.titleMedium)
                            Text("Factura #${row.optInt("invoiceId")} · ${labels[row.text("state")] ?: "Sin estado"}", style = MaterialTheme.typography.bodySmall)
                            Text(row.text("createdAt").take(10), style = MaterialTheme.typography.labelSmall)
                        }
                        Icon(Icons.Outlined.ChevronRight, null)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !result.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
            Text("Pagina $page")
            IconButton(onClick = { page++ }, enabled = result.body?.optBoolean("hasMore") == true && !result.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
        }
    }
    selected?.let { json -> val row = JSONObject(json); PaymentScreen(row.optInt("invoiceId"), vm, requestedOperation = row.getString("id"), onDocument = { document = row.optInt("invoiceId"); selected = null }, close = { selected = null; vm.load(path, true) }) }
    if (document > 0) InvoiceDocumentDialog(document, vm, pages) { document = 0 }
}
