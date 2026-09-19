package com.ispmax.mobile

import android.app.DatePickerDialog
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.net.URLDecoder
import java.net.URLEncoder
import java.time.LocalDate

@Composable internal fun CollectionFilters(invoice: Boolean, current: String, apply: (String) -> Unit, close: () -> Unit) {
    val values = remember(current) { current.split('&').filter { '=' in it }.associate { it.substringBefore('=') to URLDecoder.decode(it.substringAfter('='), "UTF-8") } }
    var zone by rememberSaveable { mutableStateOf(values["zone"] ?: "") }
    var method by rememberSaveable { mutableStateOf(values["method"] ?: "") }
    var plan by rememberSaveable { mutableStateOf(values["plan"] ?: "") }
    var from by rememberSaveable { mutableStateOf(values["from"] ?: "") }
    var to by rememberSaveable { mutableStateOf(values["to"] ?: "") }
    var dateField by rememberSaveable { mutableStateOf(values["dateField"] ?: "issued") }
    var missingIp by rememberSaveable { mutableStateOf(values["missingIp"] == "true") }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    fun chooseDate(value: String, set: (String) -> Unit) {
        val day = runCatching { LocalDate.parse(value) }.getOrDefault(LocalDate.now())
        DatePickerDialog(context, { _, y, m, d -> set(LocalDate.of(y, m + 1, d).toString()) }, day.year, day.monthValue - 1, day.dayOfMonth).show()
    }
    AlertDialog(onDismissRequest = close, title = { Text(if (invoice) "Filtros de facturas" else "Filtros de clientes") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(zone, { zone = it }, label = { Text("Zona exacta") }, singleLine = true)
            if (invoice) {
                OutlinedTextField(method, { method = it }, label = { Text("Forma de pago exacta") }, singleLine = true)
                Text("Filtrar por fecha de", style = MaterialTheme.typography.labelLarge)
                listOf("issued" to "Emision", "due" to "Vencimiento", "paid" to "Pago").forEach { (value, label) ->
                    Row { RadioButton(dateField == value, { dateField = value }); TextButton(onClick = { dateField = value }) { Text(label) } }
                }
                OutlinedButton(onClick = { chooseDate(from) { from = it } }) { Icon(Icons.Outlined.CalendarMonth, null); Spacer(Modifier.width(6.dp)); Text(from.ifBlank { "Desde" }) }
                OutlinedButton(onClick = { chooseDate(to) { to = it } }) { Icon(Icons.Outlined.CalendarMonth, null); Spacer(Modifier.width(6.dp)); Text(to.ifBlank { "Hasta" }) }
                if (from.isNotBlank() || to.isNotBlank()) TextButton(onClick = { from = ""; to = "" }) { Text("Quitar fechas") }
            } else {
                OutlinedTextField(plan, { plan = it }, label = { Text("Plan exacto") }, singleLine = true)
                Row { Checkbox(missingIp, { missingIp = it }); TextButton(onClick = { missingIp = !missingIp }) { Text("Solo clientes sin IP") } }
            }
            error?.let { Notice(it, true) }
        }
    }, confirmButton = { TextButton(onClick = {
        if (from.isNotBlank() && to.isNotBlank() && from > to) error = "La fecha final debe ser posterior a la inicial"
        else {
            val fields = linkedMapOf("zone" to zone.trim())
            if (invoice) fields.putAll(mapOf("method" to method.trim(), "from" to from, "to" to to, "dateField" to dateField))
            else { fields["plan"] = plan.trim(); if (missingIp) fields["missingIp"] = "true" }
            apply(fields.filterValues { it.isNotBlank() }.entries.joinToString("") { "&${it.key}=${URLEncoder.encode(it.value, "UTF-8")}" })
        }
    }) { Text("Aplicar filtros") } }, dismissButton = { TextButton(onClick = close) { Text("Cancelar") } })
}
