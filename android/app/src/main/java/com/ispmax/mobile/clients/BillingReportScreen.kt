package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspBlue
import java.time.YearMonth

@Composable internal fun BillingReportScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    var month by rememberSaveable { mutableStateOf(YearMonth.now().toString()) }
    var months by rememberSaveable { mutableIntStateOf(6) }
    val path = "/reports/billing?month=$month&months=$months"
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    val rows = body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Facturacion por emision", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar reporte") }
            ExportButton(rows, "Reporte-mensual")
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { month = YearMonth.parse(month).minusMonths(1).toString() }) { Icon(Icons.Outlined.ChevronLeft, "Mes anterior del reporte") }
            Text(month, style = MaterialTheme.typography.titleMedium)
            IconButton(onClick = { month = YearMonth.parse(month).plusMonths(1).toString() }) { Icon(Icons.Outlined.ChevronRight, "Mes siguiente del reporte") }
        }
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(3, 6, 12, 24).forEach { count -> FilterChip(months == count, { months = count }, label = { Text("$count meses") }) }
        }
        ReadStatus(state) { vm.load(path, true) }
        body?.optJSONObject("current")?.let { total ->
            Text(money(total.optDouble("billed")), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Text("${total.optInt("count")} facturas · Anuladas excluidas", style = MaterialTheme.typography.bodySmall)
            Text("Cobrado de esas facturas: ${money(total.optDouble("collected"))}", style = MaterialTheme.typography.bodySmall)
            Text("Saldo de esas facturas: ${money(total.optDouble("balance"))}", style = MaterialTheme.typography.bodySmall)
            val change = if (body.isNull("billedChangePercent")) "Sin base comparable" else "${body.optDouble("billedChangePercent")}% frente al periodo anterior"
            Text(change, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
        }
        HorizontalDivider()
        Text("Facturado y cobrado por mes de emision", style = MaterialTheme.typography.titleMedium)
        Text("El cobrado pertenece a esas facturas; no representa la fecha de entrada del dinero.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val maximum = rows.maxOfOrNull { maxOf(it.optDouble("billed"), it.optDouble("collected")) }?.coerceAtLeast(1.0) ?: 1.0
        rows.forEach { row -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(row.text("month"), style = MaterialTheme.typography.labelLarge)
            Box(Modifier.fillMaxWidth().height(8.dp).background(IspBlue.copy(alpha = .08f))) { Box(Modifier.fillMaxWidth((row.optDouble("billed") / maximum).toFloat().coerceIn(0f, 1f)).height(8.dp).background(IspBlue)) }
            Box(Modifier.fillMaxWidth().height(8.dp).background(IspGreen.copy(alpha = .08f))) { Box(Modifier.fillMaxWidth((row.optDouble("collected") / maximum).toFloat().coerceIn(0f, 1f)).height(8.dp).background(IspGreen)) }
            Text("Facturado ${money(row.optDouble("billed"))}", style = MaterialTheme.typography.bodySmall, color = IspBlue)
            Text("Cobrado ${money(row.optDouble("collected"))}", style = MaterialTheme.typography.bodySmall, color = IspGreen)
        } }
        if (body != null && rows.all { it.optInt("count") == 0 }) EmptyState("Sin facturas emitidas en este periodo")
    }
}
