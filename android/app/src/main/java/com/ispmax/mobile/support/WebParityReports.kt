package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/** Campos minimos de cada cliente para los reportes (nada sensible se conserva). */
private data class ReportClient(val id: Int, val name: String, val phone: String, val ip: String, val status: String, val invoices: String,
    val plan: String, val zone: String, val price: Double, val cut: String, val installed: Long?, val cancelled: Long?)

private fun moneyValue(value: String): Double = value.replace(Regex("[^0-9.,-]"), "").replace(",", "").toDoubleOrNull() ?: 0.0

private fun reportDate(value: String): Long? {
    if (value.isBlank()) return null
    val parts = value.trim().split("/")
    return runCatching {
        if (parts.size == 3) Calendar.getInstance().apply { clear(); set(parts[2].take(4).toInt(), parts[1].toInt() - 1, parts[0].toInt()) }.timeInMillis
        else SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(value.take(10))!!.time
    }.getOrNull()
}

/**
 * Reportes de cartera de la web (/reports) que Android no tenia: clientes por estado, planes,
 * zonas, morosos, altas y bajas del periodo, calidad de datos y exportaciones CSV. La facturacion
 * por mes y la comparacion de periodos ya estan en "Reporte de facturacion".
 */
@Composable
fun WebParityReportsScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    var clients by remember { mutableStateOf<List<ReportClient>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var months by rememberSaveable { mutableIntStateOf(12) }
    var view by rememberSaveable { mutableStateOf("resumen") }
    LaunchedEffect(reload) {
        error = null
        try {
            clients = vm.web("GET", "/db/clients?limit=100000").optJSONArray("items").objects().map { c ->
                ReportClient(c.optInt("idServicio"), c.text("aliasNombre", c.text("nombre", "Sin nombre")), c.text("aliasTelefono", c.text("telefono", "")), c.text("ip", ""),
                    c.text("estado", ""), c.text("estadoFacturas", ""), c.text("planInternetName", ""), c.text("zonaNombre", ""), moneyValue(c.text("precioPlan", "")),
                    c.text("fechaCorte", ""), reportDate(c.text("fechaInstalacion", "")), reportDate(c.text("fechaCancelacion", "")))
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) { error = "No fue posible preparar los reportes. ${e.message ?: "Revisa la conexion con el servidor."}" }
    }
    val all = clients.orEmpty()
    val active = all.filter { it.status.equals("activo", true) }
    val morosos = active.filter { it.invoices.lowercase().contains("pendiente") }
    val start = if (months == 0) null else Calendar.getInstance().apply { set(Calendar.DAY_OF_MONTH, 1); add(Calendar.MONTH, -months + 1); set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0) }.timeInMillis
    fun inside(value: Long?) = value != null && (start == null || value >= start) && value <= System.currentTimeMillis()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        WebHeader("Reportes de cartera", "Calculado con los ${all.size} clientes guardados", clients == null && error == null, refresh = { reload++ })
        error?.let { Notice(it, true); TextButton(onClick = { reload++ }) { Text("Reintentar") } }
        if (clients == null && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
            listOf("resumen" to "Resumen", "planes" to "Planes", "zonas" to "Zonas", "morosos" to "Morosos", "datos" to "Calidad de datos").forEach { (key, label) -> FilterChip(view == key, { view = key }, label = { Text(label) }) }
        }
        if (clients != null) when (view) {
            "resumen" -> {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(7.dp)) {
                    listOf(3 to "3 meses", 6 to "6 meses", 12 to "12 meses", 0 to "Todo").forEach { (value, label) -> FilterChip(months == value, { months = value }, label = { Text(label) }) }
                }
                val monthly = active.sumOf { it.price }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebKpi("Clientes activos", "${active.size} de ${all.size}", Modifier.weight(1f), IspGreen)
                    WebKpi("Ingreso mensual estimado", money(monthly), Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebKpi("Morosos", "${morosos.size}", Modifier.weight(1f), IspRed)
                    WebKpi("Altas", "${all.count { inside(it.installed) }}", Modifier.weight(1f), IspBlue)
                    WebKpi("Bajas", "${all.count { inside(it.cancelled) }}", Modifier.weight(1f), IspAmber)
                }
                Text("Altas y bajas: ${if (months == 0) "todo el historial" else "ultimos $months meses"}. Facturado y cobrado: ver Cobros > Reporte de facturacion.", style = MaterialTheme.typography.labelSmall)
                WebSection("Clientes por estado") {
                    all.groupBy { it.status.ifBlank { "Sin estado" } }.entries.sortedByDescending { it.value.size }.forEach { (status, list) ->
                        val pct = list.size * 100f / all.size.coerceAtLeast(1)
                        Row(verticalAlignment = Alignment.CenterVertically) { Text(status, Modifier.width(110.dp), maxLines = 1); LinearProgressIndicator(progress = { pct / 100 }, modifier = Modifier.weight(1f)); Text("  ${list.size} (%.0f%%)".format(pct), style = MaterialTheme.typography.labelMedium) }
                    }
                    Text("${all.count { it.status.equals("gratis", true) }} clientes con servicio gratis", style = MaterialTheme.typography.bodySmall)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Resumen ejecutivo CSV", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                    ExportButton(listOf("Ingreso mensual estimado (clientes activos)" to "%.2f".format(monthly), "Clientes activos" to "${active.size}", "Clientes totales" to "${all.size}", "Clientes morosos" to "${morosos.size}",
                        "Altas del periodo" to "${all.count { inside(it.installed) }}", "Bajas del periodo" to "${all.count { inside(it.cancelled) }}").map { (k, v) -> JSONObject().put("Indicador", k).put("Valor", v) }, "reporte_ejecutivo")
                }
            }
            "planes" -> {
                val rows = active.groupBy { it.plan.ifBlank { "Sin plan" } }.map { (plan, list) -> JSONObject().put("Plan", plan).put("Clientes activos", list.size).put("% de activos", "%.1f".format(list.size * 100.0 / active.size.coerceAtLeast(1))).put("Precio promedio", "%.2f".format(list.sumOf { it.price } / list.size)).put("Ingreso mensual", "%.2f".format(list.sumOf { it.price })) }
                    .sortedByDescending { it.optString("Ingreso mensual").toDouble() }
                ReportTable("Planes de clientes activos", rows, "reporte_planes") { row -> "${row.optInt("Clientes activos")} activos (${row.optString("% de activos")}%) · promedio ${money(row.optString("Precio promedio").toDouble())} · ${money(row.optString("Ingreso mensual").toDouble())}/mes" }
            }
            "zonas" -> {
                val rows = all.groupBy { it.zone.ifBlank { "Sin zona" } }.map { (zone, list) -> val act = list.filter { it.status.equals("activo", true) }
                    JSONObject().put("Zona", zone).put("Clientes", list.size).put("Activos", act.size).put("Morosos", act.count { it.invoices.lowercase().contains("pendiente") }).put("Ingreso mensual activo", "%.2f".format(act.sumOf { it.price })) }
                    .sortedByDescending { it.optString("Ingreso mensual activo").toDouble() }
                ReportTable("Zonas", rows, "reporte_zonas") { row -> "${row.optInt("Clientes")} clientes · ${row.optInt("Activos")} activos · ${row.optInt("Morosos")} morosos · ${money(row.optString("Ingreso mensual activo").toDouble())}/mes" }
            }
            "morosos" -> {
                val rows = morosos.sortedBy { it.name }.map { JSONObject().put("Nombre", it.name).put("Telefono", it.phone).put("Plan", it.plan).put("Precio", "%.2f".format(it.price)).put("Fecha de corte", it.cut).put("IP", it.ip) }
                ReportTable("Clientes activos con factura pendiente", rows, "morosos") { row -> "${row.optString("Telefono").ifBlank { "sin telefono" }} · ${row.optString("Plan")} · ${money(row.optString("Precio").toDouble())} · corte ${row.optString("Fecha de corte")}" }
            }
            else -> WebSection("Calidad de datos", "Fichas que conviene completar en WispHub") {
                listOf("Sin telefono" to all.count { it.phone.isBlank() }, "Sin IP" to all.count { it.ip.isBlank() }, "Sin plan" to all.count { it.plan.isBlank() }, "Sin zona" to all.count { it.zone.isBlank() }).forEach { (label, count) ->
                    Row { Text(label, Modifier.weight(1f)); Text("$count", fontWeight = FontWeight.Bold, color = if (count > 0) IspAmber else IspGreen) }
                }
            }
        }
    }
}

@Composable
private fun ReportTable(title: String, rows: List<JSONObject>, file: String, subtitle: (JSONObject) -> String) {
    WebSection(title) {
        Row(verticalAlignment = Alignment.CenterVertically) { Text("${rows.size} filas", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium); ExportButton(rows, file) }
        if (rows.isEmpty()) EmptyState("Sin datos")
        rows.take(300).forEach { row ->
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(row.optString(row.keys().next()), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle(row), style = MaterialTheme.typography.bodySmall)
            }
            HorizontalDivider()
        }
        if (rows.size > 300) Text("Se muestran 300; el CSV incluye todas.", style = MaterialTheme.typography.labelSmall)
    }
}
