package com.ispmax.mobile

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
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
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/**
 * Acciones del expediente web que faltaban en Android, en el mismo orden de permisos que la web:
 * piloto del portal de pago (administradores), activar (cobranza) o suspender (administradores)
 * el servicio en WispHub, ping WispHub (tecnicos), monitoreo de pago/consumo (tecnicos),
 * actividad web (administradores) y gastos ligados al cliente (administradores).
 * Marcar moroso / cortar / reactivar siguen en "Administrar servicio" (API movil idempotente).
 */
@Composable
fun WebParityClientActions(id: Int, vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    val client = pages["/clients/$id"]?.body?.optJSONObject("client")
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (webAdmin(role)) PaymentPilotSection(id, vm, pages, client)
        if (webCan(role, "cobranza")) WisphubServiceSection(id, vm, pages, role, client)
        if (webCan(role, "tecnico")) WisphubPingSection(id, vm, client)
        if (webCan(role, "tecnico")) ClientMetricsSection(id, vm, pages)
        if (webAdmin(role)) WebActivitySection(id, vm, pages)
        if (webAdmin(role)) ClientExpensesSection(id, vm, pages)
    }
}

private fun clientName(client: JSONObject?, id: Int) = client?.text("aliasNombre", client.text("nombre", "Cliente #$id")) ?: "Cliente #$id"

@Composable
private fun PaymentPilotSection(id: Int, vm: MainViewModel, pages: Map<String, PageState>, client: JSONObject?) {
    val path = webPath("/clients-actions/states")
    LaunchedEffect(id) { vm.load(path, true) }
    val row = pages[path].webItems().firstOrNull { it.optInt("idServicio") == id }
    val enabled = row?.optBoolean("paymentPilotEnabled") == true
    val crm = row?.text("crmAction", "").orEmpty()
    val actions = rememberWebActions()
    val name = clientName(client, id)
    WebSection("Portal de pago (piloto)", "Con el piloto activo se puede desactivar el servicio mostrando solamente la pagina de pago.") {
        ReadStatus(pages[path] ?: PageState(loading = true)) { vm.load(path, true) }
        if (crm.isNotBlank()) Notice("Estado de cobro actual: ${if (crm == "block") "servicio desactivado con portal" else "marcado como moroso"} · ${row?.text("crmActionReason", "") ?: ""}")
        WebSwitchRow(if (enabled) "Piloto habilitado" else "Piloto deshabilitado", row?.text("paymentPilotEnabledAt", "")?.takeIf { enabled && it.isNotBlank() }?.let { "Desde $it" }, enabled, pages[path]?.body != null && !actions.busy) { next ->
            actions.confirm(if (next) "Habilitar piloto del portal" else "Deshabilitar piloto del portal",
                if (next) "¿Habilitar el piloto del portal de pago para $name? Un administrador podra desactivar su servicio mostrandole solo el portal de pago." else "¿Deshabilitar el piloto del portal de pago para $name?",
                if (next) "Habilitar" else "Deshabilitar", danger = next) {
                val result = vm.web("PATCH", "/clients-actions/$id/payment-pilot", JSONObject().put("enabled", next).put("confirmation", if (next) "HABILITAR PORTAL" else "DESHABILITAR PORTAL"), path)
                result.serverRejected()?.let { throw IllegalStateException(it) }
                if (!result.optBoolean("ok") || result.optBoolean("paymentPilotEnabled") != next) throw IllegalStateException("El servidor no confirmo el cambio del piloto")
                vm.reloadMobile(pages, "/clients/$id")
                if (next) "Piloto habilitado para este cliente" else "Piloto deshabilitado para este cliente"
            }
        }
        WebActionFeedback(actions)
    }
}

@Composable
private fun WisphubServiceSection(id: Int, vm: MainViewModel, pages: Map<String, PageState>, role: String, client: JSONObject?) {
    val actions = rememberWebActions()
    val estado = client?.text("estado", "").orEmpty().lowercase()
    val name = clientName(client, id)
    WebSection("Servicio en WispHub", "Envia la orden a WispHub. Despues sincroniza la cartera para ver el nuevo estado.") {
        Text("Estado registrado: ${client?.text("estado") ?: "consultando"}", style = MaterialTheme.typography.bodySmall)
        WebActionFeedback(actions)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (estado != "activo") Button(onClick = {
                actions.confirm("Activar servicio", "¿Activar el servicio de internet de $name? Se enviara la orden de activacion a WispHub.", "Activar") {
                    val result = wisphubCall(vm, "/api/clientes/activar/", JSONObject().put("servicios", JSONArray().put(id)), "activar")
                    result.serverRejected()?.let { throw IllegalStateException("No se pudo activar: $it") }
                    vm.reloadMobile(pages, "/clients/$id")
                    "WispHub acepto la activacion de $name. Sincronice la cartera para ver el nuevo estado."
                }
            }, enabled = !actions.busy && client != null) { Icon(Icons.Outlined.PlayCircleOutline, null); Spacer(Modifier.width(6.dp)); Text("Activar servicio") }
            if (estado == "activo" && webAdmin(role)) OutlinedButton(onClick = {
                actions.confirm("Suspender servicio", "¿Suspender el servicio de internet de $name? El cliente se quedara sin internet hasta que se active de nuevo.", "Suspender", danger = true) {
                    val result = wisphubCall(vm, "/api/clientes/desactivar/", JSONObject().put("servicios", JSONArray().put(id)), "suspender")
                    result.serverRejected()?.let { throw IllegalStateException("No se pudo suspender: $it") }
                    vm.reloadMobile(pages, "/clients/$id")
                    "WispHub acepto la suspension de $name. Sincronice la cartera para ver el nuevo estado."
                }
            }, enabled = !actions.busy && client != null) { Icon(Icons.Outlined.PauseCircleOutline, null, tint = IspRed); Spacer(Modifier.width(6.dp)); Text("Suspender servicio") }
        }
        if (estado == "activo" && !webAdmin(role)) Text("Solo un administrador puede suspender el servicio.", style = MaterialTheme.typography.labelSmall)
    }
}

/** Llamada al proxy WispHub con el mensaje de la web cuando WispHub rechaza sin detalle. */
private suspend fun wisphubCall(vm: MainViewModel, path: String, body: JSONObject, verb: String): JSONObject = try {
    vm.web("POST", path, body)
} catch (e: ApiFailure) {
    throw IllegalStateException(if (e.status == 403) "Tu usuario no tiene permiso para $verb este servicio." else "No se pudo $verb: ${e.message ?: "WispHub no respondio"}")
}

@Composable
private fun WisphubPingSection(id: Int, vm: MainViewModel, client: JSONObject?) {
    val actions = rememberWebActions()
    var detail by remember { mutableStateOf<String?>(null) }
    WebSection("Ping desde WispHub", "WispHub hace ping al equipo del cliente desde su router. Para la prueba desde el MikroTik usa \"Probar enlace\".") {
        WebActionFeedback(actions)
        detail?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
        OutlinedButton(onClick = {
            actions.run {
                detail = null
                val started = wisphubCall(vm, "/api/clientes/$id/ping/", JSONObject(), "hacer ping a")
                val taskId = started.optString("task_id")
                if (taskId.isBlank()) { detail = started.toString(2).take(1200); return@run "Ping enviado: WispHub respondio" }
                // Igual que la herramienta de ping de la web: se consulta la tarea hasta 12 veces.
                repeat(12) {
                    delay(2_500)
                    val task = vm.web("GET", "/api/tasks/$taskId/").optJSONObject("task") ?: return@repeat
                    when (task.optString("status")) {
                        "SUCCESS" -> {
                            val results = task.optJSONArray("result").objects()
                            val summary = results.firstOrNull { it.has("ping-exitoso") }?.optString("ping-exitoso")
                            detail = results.joinToString("\n") { it.toString() }.take(1200).ifBlank { null }
                            if (summary != null && summary.split(" de ").firstOrNull()?.trim() == "0") throw IllegalStateException("Sin respuesta: $summary paquetes. Verifique que el equipo este encendido y conectado.")
                            return@run if (summary != null) "Responde: $summary paquetes" else "Ping completado en WispHub"
                        }
                        "FAILURE" -> throw IllegalStateException("El equipo del cliente no respondio. Verifique que este encendido y conectado.")
                    }
                }
                throw IllegalStateException("WispHub no termino el ping a tiempo. Intente de nuevo.")
            }
        }, enabled = !actions.busy && client?.text("ip", "")?.isNotBlank() == true) { Icon(Icons.Outlined.NetworkPing, null); Spacer(Modifier.width(6.dp)); Text(if (actions.busy) "Esperando a WispHub..." else "Hacer ping") }
    }
}

private val factorLabels = mapOf("factura_pendiente" to "Factura pendiente", "factura_vencida" to "Factura vencida", "al_dia" to "Pagos al dia",
    "bloqueado_admin" to "Bloqueado por administracion", "marcado_moroso" to "Marcado como moroso", "servicio_suspendido" to "Servicio suspendido en WispHub",
    "cliente_retirado" to "Cliente retirado", "servicio_activo" to "Servicio activo", "saldo_pendiente" to "Saldo pendiente")
private fun factorLabel(key: String): String = factorLabels[key] ?: Regex("(\\d+)").find(key)?.let { if (key.contains("mes")) "Debe ${it.value} ${if (it.value == "1") "mes" else "meses"} de plan" else null } ?: key.replace('_', ' ')

private val tierLabels = mapOf("EXCELENTE" to ("Excelente" to IspGreen), "BUENO" to ("Bueno" to IspGreen), "REGULAR" to ("Regular" to IspAmber), "RIESGO" to ("Riesgo" to IspAmber), "CRITICO" to ("Critico" to IspRed),
    "INTENSIVO" to ("Intensivo" to IspAmber), "NORMAL" to ("Normal" to IspGreen), "BAJO" to ("Bajo" to IspBlue), "INACTIVO" to ("Inactivo" to IspBlue))

@Composable
private fun ClientMetricsSection(id: Int, vm: MainViewModel, pages: Map<String, PageState>) {
    val path = webPath("/metrics/$id")
    // La web actualiza cada 30 segundos mientras el expediente esta abierto.
    LaunchedEffect(id) { while (true) { vm.load(path, true); delay(30_000) } }
    val state = pages[path] ?: PageState(loading = true)
    val m = state.body
    WebSection("Estado de cuenta y consumo", m?.text("metricsUpdatedAt", "")?.takeIf { it.isNotBlank() }?.let { "Actualizado $it" }) {
        ReadStatus(state) { vm.load(path, true) }
        if (m != null) {
            val credit = tierLabels[m.text("creditTier", "")]
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (m.isNull("creditScore")) "—" else m.optInt("creditScore").toString(), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold, color = credit?.second ?: MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.width(12.dp))
                Column { Text("Puntuacion de pago", style = MaterialTheme.typography.labelMedium); Text(credit?.first ?: "Sin datos", fontWeight = FontWeight.SemiBold, color = credit?.second ?: MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            m.optJSONArray("creditFactors").objects().forEach { factor ->
                val impact = factor.optInt("impact")
                Row { Text(factorLabel(factor.optString("key")), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall); Text((if (impact > 0) "+" else "") + impact, color = if (impact < 0) IspRed else IspGreen, style = MaterialTheme.typography.labelMedium) }
            }
            HorizontalDivider()
            val consumption = tierLabels[m.text("consumptionTier", "")]
            Text("Consumo de internet: ${consumption?.first ?: "Sin datos"}", fontWeight = FontWeight.SemiBold, color = consumption?.second ?: MaterialTheme.colorScheme.onSurfaceVariant)
            if (!m.isNull("consumptionMb30d") && m.has("consumptionMb30d")) {
                val mb = m.optDouble("consumptionMb30d")
                Text("${if (mb >= 1024) "%.1f GB".format(mb / 1024) else "%.0f MB".format(mb)} en los ultimos 30 dias" + if (!m.isNull("consumptionPct") && m.has("consumptionPct")) " (%.1f%% del plan)".format(m.optDouble("consumptionPct")) else "", style = MaterialTheme.typography.bodySmall)
                if (!m.isNull("consumptionPct") && m.has("consumptionPct")) LinearProgressIndicator(progress = { (m.optDouble("consumptionPct") / 100).toFloat().coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth(), color = consumption?.second ?: IspGreen)
            } else Text("Sin datos de consumo: el cliente no tiene IP asignada o su limite de velocidad no esta registrado en el MikroTik.", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun WebActivitySection(id: Int, vm: MainViewModel, pages: Map<String, PageState>) {
    var days by rememberSaveable(id) { mutableIntStateOf(7) }
    val path = webPath("/web-activity/$id?days=$days")
    LaunchedEffect(path) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    val body = state.body
    WebSection("Actividad web", if (days == 1) "Hoy" else "Ultimos $days dias") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { listOf(1 to "Hoy", 7 to "7 dias", 30 to "30 dias").forEach { (value, label) -> FilterChip(days == value, { days = value }, label = { Text(label) }) } }
        ReadStatus(state) { vm.load(path, true) }
        if (body != null) {
            if (body.optInt("totalQueries") == 0) {
                Text("No hay actividad web registrada en este periodo.", fontWeight = FontWeight.SemiBold)
                Text("Normalmente ocurre cuando el equipo del cliente no usa el MikroTik como servidor DNS. Un tecnico puede activarlo: /ip dns set allow-remote-requests=yes y entregar el MikroTik como DNS por DHCP.", style = MaterialTheme.typography.bodySmall)
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebKpi("Consultas", "%,d".format(body.optInt("totalQueries")), Modifier.weight(1f))
                    WebKpi("Sitios distintos", "%,d".format(body.optInt("totalDomains")), Modifier.weight(1f))
                }
                Text("Sitios mas visitados", fontWeight = FontWeight.SemiBold)
                body.optJSONArray("topDomains").objects().take(20).forEach { row ->
                    Row { Text(row.text("domain"), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall, color = IspGreen); Text("%,d".format(row.optInt("queryCount")), style = MaterialTheme.typography.labelMedium) }
                }
            }
        }
    }
}

@Composable
private fun ClientExpensesSection(id: Int, vm: MainViewModel, pages: Map<String, PageState>) {
    val equipmentPath = webPath("/clients/$id/equipment")
    val expensesPath = webPath("/expenses?clientId=$id&limit=50")
    LaunchedEffect(id) { vm.load(equipmentPath, true); vm.load(expensesPath, true) }
    val equipment = pages[equipmentPath].webItems()
    val expenses = pages[expensesPath].webItems()
    val equipmentCost = equipment.sumOf { it.optDouble("unitCost", 0.0).takeIf { v -> !v.isNaN() } ?: 0.0 }
    val expenseTotal = expenses.sumOf { it.optDouble("amount", 0.0).takeIf { v -> !v.isNaN() } ?: 0.0 }
    WebSection("Costo del cliente", "Equipos asignados y gastos registrados a su nombre") {
        ReadStatus(pages[expensesPath] ?: PageState(loading = true)) { vm.load(expensesPath, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WebKpi("Equipos", money(equipmentCost), Modifier.weight(1f))
            WebKpi("Gastos", money(expenseTotal), Modifier.weight(1f))
            WebKpi("Total", money(equipmentCost + expenseTotal), Modifier.weight(1f))
        }
        if (expenses.isEmpty() && pages[expensesPath]?.body != null) Text("Sin gastos registrados para este cliente.", style = MaterialTheme.typography.bodySmall)
        expenses.forEach { row ->
            Row { Column(Modifier.weight(1f)) { Text(row.text("description"), style = MaterialTheme.typography.bodySmall); Text("${row.text("expenseDate", "").take(10)} · ${row.text("category")}", style = MaterialTheme.typography.labelSmall) }; Text(money(row.optDouble("amount", 0.0)), style = MaterialTheme.typography.labelMedium) }
        }
    }
}
