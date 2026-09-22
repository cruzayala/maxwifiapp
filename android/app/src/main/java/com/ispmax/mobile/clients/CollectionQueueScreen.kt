package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import com.ispmax.mobile.ui.InvoiceDocumentDialog
import com.ispmax.mobile.ui.PhoneLinks
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.net.URLEncoder

/**
 * Cola de cobranza: los mismos morosos y el mismo orden que la pantalla web. Cada
 * tarjeta trae el recordatorio de WhatsApp ya escrito con la deuda real, el cobro y
 * el aviso o corte, para trabajar la lista sin abrir cada expediente.
 */
@Composable internal fun CollectionQueueScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String, capabilities: JSONObject?, onClient: (Int) -> Unit) {
    val context = LocalContext.current
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    var service by rememberSaveable { mutableStateOf("") }
    var manage by rememberSaveable { mutableStateOf("") }
    var sort by rememberSaveable { mutableStateOf("priority") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var paymentId by rememberSaveable { mutableIntStateOf(0) }
    var documentId by rememberSaveable { mutableIntStateOf(0) }
    var serviceFor by rememberSaveable { mutableIntStateOf(0) }
    var notice by rememberSaveable { mutableStateOf<String?>(null) }
    val canPay = capabilities?.optBoolean("paymentsWrite") == true
    val canManage = capabilities?.optBoolean("clientServiceActions") == true
    val path = "/collections/queue?q=${URLEncoder.encode(query, "UTF-8")}&service=$service&manage=$manage&sort=$sort&page=$page&pageSize=30"
    LaunchedEffect(search) { if (search != query) { delay(350); query = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    val summary = state.body?.optJSONObject("summary")
    val list = rememberLazyListState()
    LaunchedEffect(query, service, manage, sort, page) { list.scrollToItem(0) }

    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(money(summary?.optDouble("debt") ?: 0.0), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = IspRed)
                Text("${summary?.optInt("debtors") ?: 0} clientes deben · ${summary?.optInt("invoices") ?: 0} facturas", style = MaterialTheme.typography.bodySmall)
            }
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar cola") }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            QueueMetric("Sin gestionar", summary?.optInt("unmanaged") ?: 0, IspAmber, Modifier.weight(1f))
            QueueMetric("Con aviso", summary?.optInt("withNotice") ?: 0, IspBlue, Modifier.weight(1f))
            QueueMetric("Cortados", summary?.optInt("cut") ?: 0, IspRed, Modifier.weight(1f))
        }
        Text("Cartera al dia entre activos: ${summary?.optDouble("onTimePercent") ?: 100.0}% · ${summary?.optInt("withService") ?: 0} aun con servicio",
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Nombre, usuario, telefono o IP") },
            leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth(),
            trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar busqueda") } })
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf("" to "Todos", "activo" to "Con servicio", "suspendido" to "Suspendidos", "otro" to "Otros").forEach { (value, label) ->
                FilterChip(service == value, { service = value; page = 1 }, label = { Text(label) })
            }
            VerticalDivider(Modifier.height(32.dp).padding(horizontal = 2.dp))
            listOf("pending" to "Sin gestionar", "aviso" to "Con aviso", "corte" to "Cortados").forEach { (value, label) ->
                FilterChip(manage == value, { manage = if (manage == value) "" else value; page = 1 }, label = { Text(label) })
            }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Orden", style = MaterialTheme.typography.labelMedium)
            listOf("priority" to "Prioridad", "amount" to "Mayor deuda", "invoices" to "Mas facturas", "name" to "Nombre").forEach { (value, label) ->
                AssistChip(onClick = { sort = value; page = 1 }, label = { Text(label, fontWeight = if (sort == value) FontWeight.Bold else FontWeight.Normal) },
                    leadingIcon = if (sort == value) ({ Icon(Icons.Outlined.Check, null, Modifier.size(16.dp)) }) else null)
            }
        }
        ReadStatus(state) { vm.load(path, true) }
        notice?.let { Notice(it, true) }
        LazyColumn(Modifier.weight(1f).testTag("collection-queue"), state = list, verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("Nadie debe con estos filtros") }
            items(rows, key = { it.optInt("idServicio") }) { row ->
                DebtorCard(row, canPay = canPay, canManage = canManage,
                    onWhatsapp = { if (!PhoneLinks.openWhatsapp(context, row.text("phone", ""), row.text("message", ""))) notice = "El cliente no tiene un telefono valido para WhatsApp" },
                    onCall = { if (!PhoneLinks.openDialer(context, row.text("phone", ""))) notice = "El cliente no tiene un telefono valido" },
                    onPay = { paymentId = row.optInt("oldestInvoiceId") },
                    onManage = { serviceFor = row.optInt("idServicio") },
                    onOpen = { onClient(row.optInt("idServicio")) })
            }
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
                    Text("Pagina $page · ${state.body?.optInt("total") ?: 0} en la lista", style = MaterialTheme.typography.labelLarge)
                    IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
                }
            }
        }
    }
    if (paymentId > 0) PaymentScreen(paymentId, vm, onDocument = { documentId = paymentId; paymentId = 0 }, close = { paymentId = 0; vm.load(path, true) })
    if (documentId > 0) InvoiceDocumentDialog(documentId, vm, pages) { documentId = 0 }
    if (serviceFor > 0) ClientServiceDialog(serviceFor, role, vm, pages) { serviceFor = 0; vm.load(path, true) }
}

@Composable private fun QueueMetric(label: String, value: Int, color: Color, modifier: Modifier) {
    OutlinedCard(modifier) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text("$value", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = color)
            Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}

@Composable private fun DebtorCard(row: JSONObject, canPay: Boolean, canManage: Boolean, onWhatsapp: () -> Unit, onCall: () -> Unit, onPay: () -> Unit, onManage: () -> Unit, onOpen: () -> Unit) {
    val risk = row.optString("risk")
    val riskColor = when (risk) { "alto" -> IspRed; "medio" -> IspAmber; else -> IspGreen }
    val management = row.optString("management")
    val phone = row.text("phone", "")
    val hasPhone = PhoneLinks.international(phone) != null
    OutlinedCard(onClick = onOpen, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(15.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(row.text("name"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(listOf(row.text("plan", ""), row.text("zone", ""), row.text("ip", "")).filter(String::isNotBlank).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(money(row.optDouble("debt")), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = IspRed)
                    Text("${row.optInt("invoiceCount")} factura(s)", style = MaterialTheme.typography.labelSmall)
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                QueueTag("${row.optInt("overdueDays")} dias · riesgo $risk", riskColor)
                QueueTag(row.text("service"), if (row.optString("serviceKind") == "activo") IspGreen else IspAmber)
                QueueTag(when (management) { "corte" -> "Internet cortado"; "aviso" -> "Aviso de pago activo"; else -> "Sin gestionar" },
                    when (management) { "corte" -> IspRed; "aviso" -> IspBlue; else -> MaterialTheme.colorScheme.onSurfaceVariant })
            }
            if (hasPhone) Text(PhoneLinks.format(phone), style = MaterialTheme.typography.bodySmall)
            else Text("Sin telefono registrado", style = MaterialTheme.typography.bodySmall, color = IspAmber)
            // Dos filas: contacto arriba, cobro y corte abajo; asi caben en cualquier telefono.
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(onClick = onWhatsapp, enabled = hasPhone, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Chat, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("WhatsApp", maxLines = 1) }
                OutlinedButton(onClick = onCall, enabled = hasPhone, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Call, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Llamar", maxLines = 1) }
            }
            if ((canPay && row.optInt("oldestInvoiceId") > 0) || canManage) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (canPay && row.optInt("oldestInvoiceId") > 0) Button(onClick = onPay, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.Payments, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Cobrar", maxLines = 1) }
                if (canManage) OutlinedButton(onClick = onManage, modifier = Modifier.weight(1f)) { Icon(Icons.Outlined.WifiOff, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Aviso o corte", maxLines = 1) }
            }
        }
    }
}

@Composable private fun QueueTag(text: String, color: Color) {
    Surface(color = color.copy(alpha = .10f), contentColor = color, shape = RoundedCornerShape(50)) {
        Text(text, Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelMedium, maxLines = 1)
    }
}
