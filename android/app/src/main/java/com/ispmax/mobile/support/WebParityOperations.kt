package com.ispmax.mobile

import com.ispmax.mobile.data.WEB_PREFIX
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import org.json.JSONObject

/**
 * Sincronizacion y mantenimiento: las mismas acciones que la web reparte entre Inicio, Clientes,
 * En vivo (sincronizar con WispHub), Facturas (historial), Tickets (sincronizar) e Incidencias (evaluar).
 */
@Composable
fun WebParityOperationsScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        WebHeader("Sincronizacion", "Traer datos de WispHub y revisar la red, igual que en la web")
        if (!webAdmin(role) && !webCan(role, "tecnico")) Notice("Tu usuario no tiene acciones de sincronizacion disponibles.")
        WebParitySyncCard(vm, pages, role)
        WebParityInvoiceHistorySync(vm, role)
        WebParityTicketsSync(vm, role)
        WebParityNocPanel(vm, pages, role)
    }
}

/** Sincronizacion general de clientes con WispHub (web: Inicio, Clientes y En vivo). Solo administradores. */
@Composable
fun WebParitySyncCard(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    if (!webAdmin(role)) return
    val path = webPath("/sync/status")
    LaunchedEffect(Unit) { vm.load(path, true) }
    val status = pages[path]?.body
    val actions = rememberWebActions()
    WebSection("Sincronizar con WispHub", "Actualiza clientes y facturas guardados. No borra registros.") {
        ReadStatus(pages[path] ?: PageState(loading = true)) { vm.load(path, true) }
        WebValue("Ultima sincronizacion", status?.text("lastSyncAt", "Nunca") ?: "Consultando")
        status?.optJSONObject("lastSyncResult")?.let { last ->
            Text("Ultimo resultado: ${last.optInt("updated")} clientes actualizados" + (if (last.optInt("errors") > 0) " · ${last.optInt("errors")} con errores" else ""), style = MaterialTheme.typography.bodySmall)
            last.optJSONObject("sources")?.optJSONObject("wisphub")?.let { source -> if (source.optString("error").isNotBlank()) Notice("WispHub: ${source.optString("error")}", true) }
        }
        WebActionFeedback(actions)
        OutlinedButton(onClick = {
            actions.run {
                try {
                    val result = vm.web("POST", "/sync/run", JSONObject(), path, WEB_PREFIX + "/db/stats")
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    vm.reloadMobile(pages, "/clients", "/overview", "/invoices")
                    val errors = result.optInt("errors")
                    "Sincronizacion completa: ${result.optInt("updated")} clientes actualizados" + if (errors > 0) ", $errors con errores" else ""
                } catch (e: java.io.InterruptedIOException) {
                    vm.load(path, true); throw IllegalStateException("La sincronizacion sigue en el servidor. Revisa la ultima sincronizacion en unos minutos antes de repetirla.")
                }
            }
        }, enabled = !actions.busy) { Icon(Icons.Outlined.CloudSync, null); Spacer(Modifier.width(6.dp)); Text(if (actions.busy) "Sincronizando..." else "Sincronizar ahora") }
    }
}

/** Importa el historial de facturas de WispHub (web: Facturas > Sincronizar). Solo administradores. */
@Composable
fun WebParityInvoiceHistorySync(vm: MainViewModel, role: String) {
    if (!webAdmin(role)) return
    val actions = rememberWebActions()
    var progress by remember { mutableStateOf<JSONObject?>(null) }
    var polling by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { vm.web("GET", "/db/invoices/sync-status") }.getOrNull()?.let { progress = it; polling = it.optBoolean("running") } }
    LaunchedEffect(polling) {
        if (!polling) return@LaunchedEffect
        val started = System.currentTimeMillis()
        while (polling && System.currentTimeMillis() - started < 15 * 60_000) {
            delay(1_500)
            val status = runCatching { vm.web("GET", "/db/invoices/sync-status") }.getOrNull() ?: continue
            progress = status
            if (!status.optBoolean("running")) {
                polling = false
                if (status.optString("error").isNotBlank()) actions.error = "La importacion termino con error: ${status.optString("error")}"
                else actions.message = "${status.optInt("saved")} facturas cargadas"
                vm.web("GET", "/db/invoices/sync-status") // lectura final confirmada
            }
        }
        polling = false
    }
    WebSection("Historial de facturas", "Trae desde WispHub todas las facturas, por periodos. Puede tardar varios minutos.") {
        progress?.let { status ->
            if (status.optBoolean("running")) {
                val total = status.optInt("windowsTotal").coerceAtLeast(1)
                LinearProgressIndicator(progress = { status.optInt("windowsCompleted").toFloat() / total }, modifier = Modifier.fillMaxWidth())
                Text("Importando historial ${status.optInt("windowsCompleted")}/${status.optInt("windowsTotal")} · ${status.optInt("fetched")} facturas", style = MaterialTheme.typography.bodySmall)
            } else if (status.has("through") && !status.isNull("through")) Text("Importado hasta ${status.text("through")}", style = MaterialTheme.typography.bodySmall)
        }
        WebActionFeedback(actions)
        OutlinedButton(onClick = {
            actions.run {
                val result = vm.web("POST", "/db/invoices/sync-history", JSONObject())
                result.serverRejected()?.let { throw IllegalStateException(it) }
                progress = result; polling = true
                if (result.optBoolean("started")) "Importacion iniciada en el servidor" else "Ya hay una importacion en curso; se muestra su avance"
            }
        }, enabled = !actions.busy && !polling) { Icon(Icons.Outlined.ReceiptLong, null); Spacer(Modifier.width(6.dp)); Text(if (polling) "Sincronizando..." else "Sincronizar facturas") }
    }
}

/**
 * Sincroniza los tickets de WispHub en ISP Max (web: Tickets > Sincronizar). Tecnicos y administradores.
 * [onDone] permite recargar la lista de tickets de la pantalla que lo contiene.
 */
@Composable
fun WebParityTicketsSync(vm: MainViewModel, role: String, onDone: () -> Unit = {}) {
    if (!webCan(role, "tecnico")) return
    val actions = rememberWebActions()
    WebSection("Tickets de WispHub", "Trae los tickets mas recientes de WispHub. Solo agrega y actualiza; nunca borra.") {
        WebActionFeedback(actions)
        OutlinedButton(onClick = { actions.run { syncWispHubTickets(vm).also { onDone() } } }, enabled = !actions.busy) {
            Icon(Icons.Outlined.ConfirmationNumber, null); Spacer(Modifier.width(6.dp)); Text(if (actions.busy) "Sincronizando..." else "Sincronizar tickets")
        }
    }
}

/** Igual que Tickets > Sincronizar en la web: lee /api/tickets/ de WispHub y lo guarda con /db/tickets/sync. */
internal suspend fun syncWispHubTickets(vm: MainViewModel): String {
    val remote = try { vm.web("GET", "/api/tickets/") } catch (e: com.ispmax.mobile.data.ApiFailure) {
        throw IllegalStateException(if (e.status == 401 || e.status == 403) "No se pudieron sincronizar los tickets. La cuenta de WispHub no tiene permiso para ver tickets." else "No se pudieron sincronizar los tickets. Revisa la conexion e intentalo de nuevo.")
    }
    val tickets = remote.optJSONArray("results") ?: throw IllegalStateException("WispHub no devolvio tickets")
    val saved = vm.web("POST", "/db/tickets/sync", JSONObject().put("tickets", tickets))
    saved.serverRejected()?.let { throw IllegalStateException(it) }
    if (!saved.optBoolean("ok")) throw IllegalStateException("El servidor no confirmo la sincronizacion de tickets")
    return "Tickets sincronizados: ${saved.optInt("received")} recibidos, ${saved.optInt("created")} nuevos, ${saved.optInt("changed")} actualizados"
}

/**
 * Resumen NOC del panel web y el boton "Evaluar" de Incidencias (tecnicos y administradores).
 * Tambien puede insertarse arriba de la pantalla de incidencias.
 */
@Composable
fun WebParityNocPanel(vm: MainViewModel, pages: Map<String, PageState>, role: String, onIncidents: (() -> Unit)? = null) {
    if (!webCan(role, "tecnico")) return
    val path = webPath("/noc/summary")
    LaunchedEffect(Unit) { vm.load(path, true) }
    val summary = pages[path]?.body
    val actions = rememberWebActions()
    WebSection("Incidencias de red", summary?.optJSONObject("evaluator")?.let { ev -> if (ev.optBoolean("enabled")) "Evaluacion automatica activa · ultima ${ev.text("lastRunAt", "sin datos")}" else "Evaluacion automatica apagada" }) {
        ReadStatus(pages[path] ?: PageState(loading = true)) { vm.load(path, true) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            WebKpi("Activas", "${summary?.optInt("active") ?: 0}", Modifier.weight(1f), IspAmber)
            WebKpi("Criticas", "${summary?.optInt("critical") ?: 0}", Modifier.weight(1f), IspRed)
            WebKpi("Afectados", "${summary?.optInt("affectedClients") ?: 0}", Modifier.weight(1f))
        }
        Text("${summary?.optInt("open") ?: 0} abiertas · ${summary?.optInt("acknowledged") ?: 0} reconocidas · ${summary?.optInt("last24h") ?: 0} en 24 h", style = MaterialTheme.typography.bodySmall)
        WebActionFeedback(actions)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                actions.run {
                    val result = vm.web("POST", "/noc/evaluate", JSONObject(), path, WEB_PREFIX + "/noc")
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    vm.reloadMobile(pages, "/incidents", "/network/summary", "/overview")
                    "Evaluacion completa: ${result.optInt("created")} nuevos, ${result.optInt("resolved")} recuperados"
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.Radar, null); Spacer(Modifier.width(6.dp)); Text("Evaluar ahora") }
            if (onIncidents != null) TextButton(onClick = onIncidents) { Text("Ver incidencias") }
        }
    }
}

/**
 * Tarjetas del panel web que Android no tenia: incidencias, diferencias MikroTik/WispHub, calidad WAN
 * de 24 h y sincronizacion. Pensada para insertarse al final de la pantalla Inicio.
 */
@Composable
fun WebParityDashboardPanel(vm: MainViewModel, pages: Map<String, PageState>, role: String, onIncidents: (() -> Unit)? = null) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (webCan(role, "tecnico")) {
            val livePath = webPath("/mikrotik/clients-live")
            val wanPath = webPath("/network-audit/wan?hours=24&limit=160")
            LaunchedEffect(Unit) { vm.load(livePath, true); vm.load(wanPath, true) }
            val stats = pages[livePath]?.body?.optJSONObject("stats")
            val wan = pages[wanPath]?.body?.optJSONObject("summary")
            WebSection("Red en las ultimas 24 h") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebKpi("Diferencias MikroTik", stats?.optInt("differences")?.toString() ?: "--", Modifier.weight(1f), if ((stats?.optInt("differences") ?: 0) > 0) IspAmber else IspGreen)
                    WebKpi("Latencia WAN promedio", wan?.let { "%.1f ms".format(it.optDouble("avgPingMs", 0.0)) } ?: "--", Modifier.weight(1f))
                }
                pages[livePath]?.error?.let { Text("MikroTik: $it", style = MaterialTheme.typography.labelSmall, color = IspAmber) }
            }
            WebParityNocPanel(vm, pages, role, onIncidents)
        }
        WebParitySyncCard(vm, pages, role)
    }
}
