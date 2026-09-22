package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.util.Locale

/** Veredicto en lenguaje simple, igual que la web: que le pasa al enlace de este cliente. */
internal fun linkVerdict(result: JSONObject): Pair<String, String> {
    val queue = result.optJSONObject("queue") ?: JSONObject()
    val ping = result.optJSONObject("ping") ?: JSONObject()
    val presence = result.optJSONObject("presence") ?: JSONObject()
    val traffic = result.optJSONObject("traffic") ?: JSONObject()
    val received = ping.optInt("received", 0)
    return when {
        queue.optBoolean("disabled") -> "error" to "Servicio pausado: la cola del cliente esta deshabilitada en el MikroTik."
        received == 0 && !presence.optBoolean("inArp") -> "error" to "El equipo del cliente no responde ni aparece en la red. Revise que este encendido y conectado."
        received == 0 -> "warn" to "El equipo esta en la red pero no responde al ping (puede tener el ping bloqueado)."
        ping.optDouble("lossPercent", 0.0) >= 20 -> "warn" to "Hay perdida de paquetes (${ping.optDouble("lossPercent").toInt()}%). Revise la senal optica o el cableado."
        queue.optLong("maxDownloadBps") > 0 && traffic.optLong("avgDownloadBps") >= queue.optLong("maxDownloadBps") * 0.9 -> "warn" to "El cliente esta usando casi todo su plan en este momento; la lentitud puede ser por consumo propio."
        else -> "ok" to "Todo normal: el equipo responde y la cola esta activa."
    }
}

internal fun mbps(bps: Long) = if (bps <= 0) "0 Mbps" else String.format(Locale.US, "%.1f Mbps", bps / 1_000_000.0)

/** Mide desde el MikroTik lo que recibe el cliente: cola, trafico real, ping y presencia en la red. */
@Composable internal fun LinkTestDialog(id: Int, vm: MainViewModel, close: () -> Unit) {
    var result by remember { mutableStateOf<JSONObject?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(true) }
    var attempt by remember { mutableIntStateOf(0) }
    LaunchedEffect(attempt) {
        busy = true; error = null; result = null
        try { result = vm.linkTest(id) } catch (cancel: CancellationException) { throw cancel } catch (failure: Exception) { error = failure.message ?: "No se pudo hacer la prueba" }
        busy = false
    }
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text("Prueba del enlace") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (busy) Row(verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.5.dp); Spacer(Modifier.width(12.dp))
                Text("Midiendo desde el MikroTik durante unos 8 segundos…")
            }
            error?.let { Notice(it, true) }
            result?.let { data ->
                val (tone, verdict) = linkVerdict(data)
                val color: Color = when (tone) { "ok" -> IspGreen; "warn" -> IspAmber; else -> IspRed }
                Surface(color = color.copy(alpha = .1f), contentColor = color, shape = MaterialTheme.shapes.medium) {
                    Text(verdict, Modifier.padding(12.dp), fontWeight = FontWeight.SemiBold)
                }
                val queue = data.optJSONObject("queue") ?: JSONObject()
                val traffic = data.optJSONObject("traffic") ?: JSONObject()
                val ping = data.optJSONObject("ping") ?: JSONObject()
                val presence = data.optJSONObject("presence") ?: JSONObject()
                LinkRow("Plan permitido", "${mbps(queue.optLong("maxDownloadBps"))} bajada · ${mbps(queue.optLong("maxUploadBps"))} subida")
                LinkRow("Uso real (${traffic.optInt("seconds")} s)", "${mbps(traffic.optLong("avgDownloadBps"))} bajada · ${mbps(traffic.optLong("avgUploadBps"))} subida")
                LinkRow("Ping", "${ping.optInt("received")}/${ping.optInt("sent", 5)} respuestas" + (if (ping.has("avgMs")) " · ${ping.optDouble("avgMs")} ms" else ""))
                LinkRow("En la red", if (presence.optBoolean("inArp")) "Si · ${presence.text("macAddress")} en ${presence.text("interface")}" else "No aparece en la tabla ARP")
                LinkRow("Cola", queue.text("name"))
                Text("Prueba de solo lectura: no cambia la cola ni genera trafico artificial.", style = MaterialTheme.typography.labelSmall)
            }
        }
    }, confirmButton = { TextButton(onClick = { attempt++ }, enabled = !busy) { Text("Repetir") } },
        dismissButton = { TextButton(onClick = close, enabled = !busy) { Text("Cerrar") } })
}

@Composable private fun LinkRow(label: String, value: String) {
    Column { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, style = MaterialTheme.typography.bodyMedium) }
}
