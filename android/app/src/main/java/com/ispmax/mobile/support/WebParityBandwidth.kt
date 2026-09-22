package com.ispmax.mobile

import androidx.compose.foundation.clickable
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
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit
import kotlin.math.sqrt
import kotlin.random.Random

/** Resultado de la prueba de velocidad (mismos campos que guarda la web en /db/speedtests). */
private data class SpeedResult(val downloadMbps: Double, val uploadMbps: Double, val pingMs: Double, val jitterMs: Double)

private val speedHttp by lazy {
    OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(30, TimeUnit.SECONDS).writeTimeout(30, TimeUnit.SECONDS).callTimeout(60, TimeUnit.SECONDS).build()
}

/**
 * Misma prueba que BandwidthService de la web, contra Cloudflare y desde la conexion del telefono:
 * 8 lecturas de latencia (mediana y desviacion), descargas de 1/5/10/25 MB y subidas de 0.5/2/5 MB,
 * deteniendose cuando una medicion supera 3 segundos. No envia datos de ISP Max a Cloudflare.
 */
private suspend fun runSpeedTest(progress: (String, Float) -> Unit): SpeedResult = withContext(Dispatchers.IO) {
    progress("Midiendo latencia...", .1f)
    val pings = mutableListOf<Double>()
    repeat(8) {
        val t0 = System.nanoTime()
        runCatching { speedHttp.newCall(Request.Builder().url("https://www.cloudflare.com/cdn-cgi/trace?_=${System.currentTimeMillis()}").header("Cache-Control", "no-store").build()).execute().use { it.body?.bytes() } }
            .onSuccess { pings += (System.nanoTime() - t0) / 1e6 }
    }
    var ping = 0.0; var jitter = 0.0
    if (pings.isNotEmpty()) {
        val sorted = pings.sorted(); ping = sorted[sorted.size / 2]
        val mean = pings.average(); jitter = sqrt(pings.sumOf { (it - mean) * (it - mean) } / pings.size)
    }
    progress("Midiendo descarga...", .4f)
    var down = 0.0
    for ((index, size) in listOf(1_000_000, 5_000_000, 10_000_000, 25_000_000).withIndex()) {
        val elapsed = try {
            val t0 = System.nanoTime()
            speedHttp.newCall(Request.Builder().url("https://speed.cloudflare.com/__down?bytes=$size&_=${System.currentTimeMillis()}").header("Cache-Control", "no-store").build()).execute().use { response ->
                if (!response.isSuccessful) throw java.io.IOException("HTTP ${response.code}")
                val source = response.body!!.byteStream(); val buffer = ByteArray(64 * 1024); while (source.read(buffer) != -1) { /* leer completo */ }
            }
            (System.nanoTime() - t0) / 1e9
        } catch (e: Exception) { break }
        val mbps = size * 8 / (elapsed * 1_000_000); if (mbps > down) down = mbps
        progress("Descarga: %.1f Mbps".format(mbps), .4f + (index + 1) * .1f)
        if (elapsed > 3) break
    }
    progress("Midiendo subida...", .8f)
    var up = 0.0
    for ((index, size) in listOf(500_000, 2_000_000, 5_000_000).withIndex()) {
        val data = ByteArray(size).also { bytes -> var i = 0; while (i < size) { bytes[i] = Random.nextInt(256).toByte(); i += 256 } }
        val elapsed = try {
            val t0 = System.nanoTime()
            speedHttp.newCall(Request.Builder().url("https://speed.cloudflare.com/__up?_=${System.currentTimeMillis()}").post(data.toRequestBody("application/octet-stream".toMediaType())).build()).execute().use { it.body?.bytes() }
            (System.nanoTime() - t0) / 1e9
        } catch (e: Exception) { break }
        val mbps = size * 8 / (elapsed * 1_000_000); if (mbps > up) up = mbps
        progress("Subida: %.1f Mbps".format(mbps), .8f + (index + 1) * .05f)
        if (elapsed > 3) break
    }
    progress("Completado", 1f)
    if (down == 0.0 && up == 0.0 && pings.isEmpty()) throw java.io.IOException("Sin conexion")
    SpeedResult(down, up, ping, jitter)
}

/** "3300k/3300k" -> 3.3/3.3, "10M | 10M Fibra" -> 10/10 (speed-utils.ts de la web). */
internal fun parsePlanSpeed(name: String?): Pair<Double, Double>? {
    val values = Regex("(\\d+(?:[.,]\\d+)?)\\s*([kKmMgG])").findAll(name.orEmpty()).mapNotNull { match ->
        val n = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return@mapNotNull null
        when (match.groupValues[2].lowercase()) { "k" -> n / 1000; "g" -> n * 1000; else -> n }.takeIf { it > 0 }
    }.take(2).toList()
    return if (values.isEmpty()) null else values[0] to (values.getOrNull(1) ?: values[0])
}

/**
 * Ancho de banda (pagina web /bandwidth, tecnicos y administradores): prueba de velocidad desde
 * el telefono con veredicto contra el plan del cliente, guardado en el historial compartido con
 * la web y exportacion CSV. La prueba de enlace MikroTik sigue en el expediente ("Probar enlace").
 */
@Composable
fun WebParityBandwidthScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    if (!webCan(role, "tecnico")) { Box(Modifier.fillMaxSize().padding(24.dp)) { Notice("Solo tecnicos y administradores hacen pruebas de velocidad.", true) }; return }
    var clientJson by rememberSaveable { mutableStateOf<String?>(null) }
    var picker by rememberSaveable { mutableStateOf(false) }
    var phase by remember { mutableStateOf("") }
    var progress by remember { mutableFloatStateOf(0f) }
    var last by remember { mutableStateOf<Pair<SpeedResult, JSONObject?>?>(null) }
    var filter by rememberSaveable { mutableStateOf("") }
    val actions = rememberWebActions()
    val historyPath = webPath("/db/speedtests?limit=500")
    LaunchedEffect(Unit) { vm.load(historyPath, true) }
    val history = pages[historyPath].webItems()
    val client = clientJson?.let { JSONObject(it) }
    val plan = parsePlanSpeed(client?.text("planInternetName", ""))
    val shown = history.filter { filter.isBlank() || it.text("clientName", "").contains(filter, true) || it.text("clientIp", "").contains(filter) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(vertical = 12.dp)) {
        item { WebHeader("Prueba de velocidad", "Desde este telefono, conectado a la red del cliente") }
        item {
            WebSection("Cliente (opcional)", "Elija el cliente para comparar con su plan y guardar la prueba a su nombre.") {
                if (client == null) OutlinedButton(onClick = { picker = true }, enabled = !actions.busy) { Icon(Icons.Outlined.PersonSearch, null); Spacer(Modifier.width(6.dp)); Text("Elegir cliente") }
                else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(client.text("aliasNombre", client.text("nombre")), fontWeight = FontWeight.SemiBold); Text("${client.text("ip", "sin IP")} · ${client.text("planInternetName", "sin plan")}", style = MaterialTheme.typography.bodySmall) }
                        IconButton(onClick = { clientJson = null; last = null }, enabled = !actions.busy) { Icon(Icons.Outlined.Close, "Quitar cliente") }
                    }
                    plan?.let { Text("Plan del cliente: %.1f Mbps de bajada / %.1f Mbps de subida. Al terminar vera si cumple.".format(it.first, it.second), style = MaterialTheme.typography.labelSmall) }
                }
                Notice("Para una medicion real use la red WiFi o el cable del cliente y desconecte los demas equipos.")
                if (actions.busy) { LinearProgressIndicator(progress = { progress }, modifier = Modifier.fillMaxWidth()); Text(phase, style = MaterialTheme.typography.bodySmall) }
                actions.message?.let { WebSuccess(it) }; actions.error?.let { Notice(it, true) }
                Button(onClick = {
                    actions.run {
                        last = null
                        val result = try { runSpeedTest { text, pct -> phase = text; progress = pct } } catch (e: Exception) { throw IllegalStateException("La prueba no pudo completarse. Revise la conexion a Internet e intente de nuevo.") }
                        val body = JSONObject().put("downloadMbps", result.downloadMbps).put("uploadMbps", result.uploadMbps).put("pingMs", result.pingMs).put("jitterMs", result.jitterMs)
                        if (client != null) body.put("idServicio", client.optInt("idServicio")).put("clientName", client.text("nombre", "")).put("clientIp", client.text("ip", ""))
                        val saved = vm.web("POST", "/db/speedtests", body, historyPath)
                        saved.serverRejected()?.let { throw IllegalStateException("La prueba termino pero no se guardo: $it") }
                        if (!saved.has("id")) throw IllegalStateException("La prueba termino pero el servidor no confirmo el guardado")
                        last = result to client
                        "Prueba completada: bajada %.1f Mbps, subida %.1f Mbps".format(result.downloadMbps, result.uploadMbps)
                    }
                }, enabled = !actions.busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Speed, null); Spacer(Modifier.width(8.dp)); Text(if (actions.busy) phase.ifBlank { "Preparando..." } else if (history.isEmpty()) "Iniciar prueba" else "Iniciar otra prueba") }
                last?.let { (result, forClient) -> SpeedVerdict(result, forClient) }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Historial (${shown.size})", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                IconButton(onClick = { vm.load(historyPath, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar historial") }
                ExportButton(shown.map { row -> JSONObject().put("Fecha", row.text("createdAt", "")).put("Cliente", row.text("clientName", "General")).put("IP", row.text("clientIp", "")).put("Bajada Mbps", "%.2f".format(row.optDouble("downloadMbps", 0.0))).put("Subida Mbps", "%.2f".format(row.optDouble("uploadMbps", 0.0))).put("Ping ms", "%.0f".format(row.optDouble("pingMs", 0.0))).put("Jitter ms", "%.1f".format(row.optDouble("jitterMs", 0.0))) }, "pruebas-velocidad")
            }
            OutlinedTextField(filter, { filter = it }, singleLine = true, label = { Text("Buscar cliente o IP") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
            ReadStatus(pages[historyPath] ?: PageState(loading = true)) { vm.load(historyPath, true) }
        }
        if (shown.isEmpty() && pages[historyPath]?.loading != true) item { EmptyState("Sin pruebas registradas") }
        items(shown.take(200), key = { it.optInt("id") }) { row ->
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(headlineContent = { Text(row.text("clientName", "Prueba general"), fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("%.1f / %.1f Mbps · ping %.0f ms · jitter %.1f ms\n%s".format(row.optDouble("downloadMbps", 0.0), row.optDouble("uploadMbps", 0.0), row.optDouble("pingMs", 0.0), row.optDouble("jitterMs", 0.0), "${row.text("clientIp", "")} ${row.text("createdAt", "").take(16).replace('T', ' ')}")) },
                    leadingContent = { Icon(Icons.Outlined.Speed, null, tint = IspBlue) })
            }
        }
    }
    if (picker) SpeedClientPicker(vm, pages, { clientJson = it.toString(); picker = false; last = null }) { picker = false }
}

@Composable
private fun SpeedVerdict(result: SpeedResult, client: JSONObject?) {
    val plan = parsePlanSpeed(client?.text("planInternetName", ""))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        WebKpi("Bajada", "%.1f Mbps".format(result.downloadMbps), Modifier.weight(1f))
        WebKpi("Subida", "%.1f Mbps".format(result.uploadMbps), Modifier.weight(1f))
        WebKpi("Ping", "%.0f ms".format(result.pingMs), Modifier.weight(1f))
    }
    when {
        plan != null -> {
            val pct = result.downloadMbps / plan.first * 100
            val upPct = result.uploadMbps / plan.second * 100
            val (label, color) = when { pct >= 80 -> "Cumple" to IspGreen; pct >= 50 -> "Por debajo" to IspAmber; else -> "Muy por debajo" to IspRed }
            Text("$label: la descarga llego al %.0f%% del plan (subida %.0f%%)".format(pct, upPct), color = color, fontWeight = FontWeight.SemiBold)
            Text(if (pct >= 80) "El cliente recibe la velocidad contratada." else "Por debajo del 80 % del plan. Repita la prueba con cable y con los demas equipos desconectados; si sigue baja, revise la senal de la ONU y la cola del cliente.", style = MaterialTheme.typography.bodySmall)
        }
        client != null -> Text("No se pudo leer la velocidad del plan de ${client.text("nombre")} para compararla. Revise el nombre del plan en su ficha.", style = MaterialTheme.typography.bodySmall)
        else -> Text("Prueba general guardada. Para compararla con un plan, elija el cliente antes de iniciar la prueba.", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun SpeedClientPicker(vm: MainViewModel, pages: Map<String, PageState>, choose: (JSONObject) -> Unit, close: () -> Unit) {
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(search) { delay(300); query = search }
    // Lista movil existente (solo activos, como la web).
    val path = "/clients?q=${webEncode(query)}&status=Activo&page=1&pageSize=30"
    LaunchedEffect(path) { vm.load(path) }
    val rows = pages[path]?.body?.optJSONArray("items").objects()
    AlertDialog(onDismissRequest = close, title = { Text("Elegir cliente") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Nombre, IP o telefono") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth())
            ReadStatus(pages[path] ?: PageState(loading = true)) { vm.load(path, true) }
            LazyColumn(Modifier.heightIn(max = 380.dp)) {
                items(rows, key = { it.optInt("idServicio") }) { row ->
                    ListItem(headlineContent = { Text(row.text("aliasNombre", row.text("nombre"))) }, supportingContent = { Text("${row.text("ip", "sin IP")} · ${row.text("planInternetName", "sin plan")}") }, modifier = Modifier.clickable { choose(row) })
                }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cerrar") } })
}
