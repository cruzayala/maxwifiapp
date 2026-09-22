package com.ispmax.mobile

import android.util.Base64
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

/**
 * WhatsApp (pagina web /whatsapp, cobranza y administradores): conexion con codigo QR,
 * conectar/desconectar (solo administradores), envio a cualquier numero con plantillas
 * rapidas y cobro masivo a morosos.
 */
@Composable
fun WebParityWhatsappScreen(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    if (!webCan(role, "cobranza")) { Box(Modifier.fillMaxSize().padding(24.dp)) { Notice("Solo cobranza y administradores usan WhatsApp.", true) }; return }
    var company by remember { mutableStateOf<Map<String, String>?>(null) }
    LaunchedEffect(Unit) { company = runCatching { loadWebSettings(vm) }.getOrNull() }
    val statusPath = webPath("/wa/status")
    val status = pages[statusPath]?.body?.optString("status").orEmpty()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        WebHeader("WhatsApp", "Conexion, envios y cobro masivo")
        WhatsappConnectionSection(vm, pages, role)
        WhatsappDirectSend(vm, status == "connected", company)
        WhatsappBulkMorosos(vm, pages, status == "connected", company)
    }
}

private fun waStatusText(status: String) = when (status) {
    "connected" -> "Conectado y listo para enviar"; "qr" -> "Esperando que escanees el QR"; "connecting" -> "Conectando..."
    "disconnected" -> "Desconectado"; "conflict" -> "Otra sesion de WhatsApp Web esta usando esta cuenta"
    "logged_out" -> "Sesion cerrada desde el telefono"; "" -> "Consultando..."; else -> "Error de conexion"
}

@Composable
private fun WhatsappConnectionSection(vm: MainViewModel, pages: Map<String, PageState>, role: String) {
    val path = webPath("/wa/status")
    // La web consulta cada 5 segundos; la respuesta (con el QR) solo vive en memoria.
    LaunchedEffect(Unit) { while (true) { vm.load(path, true); delay(5_000) } }
    val body = pages[path]?.body
    val status = body?.optString("status").orEmpty()
    val actions = rememberWebActions()
    val admin = webAdmin(role)
    WebSection("Conexion", waStatusText(status)) {
        pages[path]?.error?.let { Notice(it, true) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (status == "connected") Icons.Outlined.CheckCircle else Icons.Outlined.PhonelinkErase, null, tint = if (status == "connected") IspGreen else IspAmber)
            Spacer(Modifier.width(8.dp)); Text(waStatusLabel(status), fontWeight = FontWeight.SemiBold)
        }
        val qr = body?.optString("qrImage").orEmpty()
        if (status == "qr" && qr.startsWith("data:image/svg+xml;base64,")) {
            val modules = remember(qr) { parseQrSvg(qr) }
            if (modules != null) {
                Text("Abre WhatsApp en el telefono del negocio > Dispositivos vinculados > Vincular un dispositivo, y escanea este codigo.", style = MaterialTheme.typography.bodySmall)
                QrCanvas(modules)
            } else Notice("No se pudo dibujar el codigo QR. Abre la web para escanearlo.", true)
        }
        WebActionFeedback(actions)
        if (admin) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (status != "connected") Button(onClick = {
                actions.run {
                    val result = vm.web("POST", "/wa/connect", JSONObject(), path)
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    if (result.optString("status") == "already connected") "WhatsApp ya estaba conectado" else "Conectando WhatsApp... En unos segundos aparecera el codigo QR."
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.Link, null); Spacer(Modifier.width(6.dp)); Text("Conectar") }
            if (status != "disconnected" && status.isNotEmpty()) OutlinedButton(onClick = {
                actions.confirm("Desconectar WhatsApp", "Se cerrara la sesion y dejaran de enviarse los mensajes y avisos automaticos de cobro hasta que vuelvas a escanear el codigo QR.", "Desconectar", danger = true) {
                    val result = vm.web("POST", "/wa/disconnect", JSONObject(), path)
                    result.serverRejected()?.let { throw IllegalStateException(it) }
                    if (result.optString("status") !in listOf("disconnected", "disconnecting")) throw IllegalStateException("El servidor no confirmo la desconexion")
                    "WhatsApp desconectado"
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.LinkOff, null); Spacer(Modifier.width(6.dp)); Text("Desconectar") }
            OutlinedButton(onClick = {
                actions.confirm("Limpiar y reconectar", "Se borra la sesion guardada de WhatsApp y se genera un codigo QR nuevo. Hasta escanearlo no se enviaran mensajes.", "Limpiar y reconectar", danger = true) {
                    val off = vm.web("POST", "/wa/disconnect", JSONObject())
                    off.serverRejected()?.let { throw IllegalStateException(it) }
                    delay(1_500)
                    val on = vm.web("POST", "/wa/connect", JSONObject(), path)
                    on.serverRejected()?.let { throw IllegalStateException(it) }
                    "Generando codigo QR nuevo..."
                }
            }, enabled = !actions.busy) { Icon(Icons.Outlined.RestartAlt, null); Spacer(Modifier.width(6.dp)); Text("Limpiar y reconectar") }
        } else Text("Solo un administrador puede conectar o desconectar WhatsApp.", style = MaterialTheme.typography.labelSmall)
    }
}

/** Modulos oscuros del SVG que genera el servidor (M{x} {y}h1v1h-1z) y el tamano del lienzo. */
private class QrModules(val size: Int, val dark: List<Pair<Int, Int>>)

private fun parseQrSvg(dataUrl: String): QrModules? = runCatching {
    val svg = String(Base64.decode(dataUrl.substringAfter("base64,"), Base64.DEFAULT), Charsets.UTF_8)
    val size = Regex("viewBox=\"0 0 (\\d+) (\\d+)\"").find(svg)!!.groupValues[1].toInt()
    val dark = Regex("M(\\d+) (\\d+)h1v1h-1z").findAll(svg).map { it.groupValues[1].toInt() to it.groupValues[2].toInt() }.toList()
    if (size <= 0 || dark.isEmpty()) null else QrModules(size, dark)
}.getOrNull()

@Composable private fun QrCanvas(modules: QrModules) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(260.dp).background(Color.White)) {
            val cell = size.width / modules.size
            modules.dark.forEach { (x, y) -> drawRect(Color.Black, topLeft = Offset(x * cell, y * cell), size = Size(cell + 0.5f, cell + 0.5f)) }
        }
    }
}

@Composable
private fun WhatsappDirectSend(vm: MainViewModel, connected: Boolean, company: Map<String, String>?) {
    val actions = rememberWebActions()
    var phone by rememberSaveable { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    val name = company?.get("companyName").orEmpty(); val companyPhone = company?.get("companyPhone").orEmpty().ifBlank { "nuestra oficina" }
    // Mismas plantillas rapidas que la web.
    val templates = listOf(
        "Cobro" to "Estimado cliente de $name, le recordamos que su factura de internet se encuentra pendiente de pago. Favor comunicarse al $companyPhone para regularizar. Gracias.",
        "Aviso de corte" to "Aviso de $name: Su servicio de internet sera suspendido por falta de pago. Por favor realice su pago a la brevedad para evitar la interrupcion. Gracias.",
        "Reconexion" to "$name le informa: Su servicio de internet ha sido reconectado exitosamente. Gracias por su pago.",
        "Saludo" to "¡Saludos de $name! Esperamos que disfrute de nuestro servicio de internet. Para soporte contactenos al $companyPhone. Gracias por preferirnos.")
    WebSection("Enviar a un numero", "Para numeros que no estan en la ficha del cliente. Los envios a clientes tambien se hacen desde WhatsApp > Nuevo.") {
        if (!connected) Notice("WhatsApp no esta conectado; no se puede enviar.", true)
        OutlinedTextField(phone, { phone = it.filter { c -> c.isDigit() || c in "+- " }.take(20) }, label = { Text("Numero de telefono") }, placeholder = { Text("809-000-0000") }, singleLine = true, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            templates.forEach { (label, text) -> AssistChip(onClick = { message = text }, label = { Text(label) }, enabled = company != null) }
        }
        OutlinedTextField(message, { message = it.take(2000) }, label = { Text("Mensaje") }, minLines = 4, modifier = Modifier.fillMaxWidth(), supportingText = { Text("${message.length}/2000") })
        WebActionFeedback(actions)
        Button(onClick = {
            actions.confirm("Enviar WhatsApp", "Se enviara este mensaje a ${phone.trim()}. No se puede cancelar una vez enviado.", "Enviar") {
                val result = vm.web("POST", "/wa/send", JSONObject().put("phone", phone.trim()).put("message", message))
                result.serverRejected()?.let { throw IllegalStateException(it) }
                if (!result.optBoolean("success")) throw IllegalStateException("WhatsApp no confirmo el envio")
                val sentTo = phone.trim(); phone = ""; message = ""
                "Mensaje enviado a $sentTo"
            }
        }, enabled = connected && !actions.busy && phone.count(Char::isDigit) >= 7 && message.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Send, null); Spacer(Modifier.width(8.dp)); Text("Enviar WhatsApp") }
    }
}

@Composable
private fun WhatsappBulkMorosos(vm: MainViewModel, pages: Map<String, PageState>, connected: Boolean, company: Map<String, String>?) {
    val actions = rememberWebActions()
    // Solo los datos minimos para el envio; la lista completa de clientes no se guarda.
    var morosos by remember { mutableStateOf<List<JSONObject>?>(null) }
    var loadError by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var message by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(reload) {
        loadError = null
        try {
            morosos = vm.web("GET", "/db/clients?limit=100000").optJSONArray("items").objects()
                .filter { c -> c.text("estadoFacturas", "").lowercase().contains("pendiente") && c.text("telefono", "").length >= 7 && c.text("estado", "").equals("activo", true) }
                .map { c -> JSONObject().put("idServicio", c.optInt("idServicio")).put("nombre", c.text("nombre", "")).put("telefono", c.text("telefono", "")).put("precioPlan", c.text("precioPlan", "")) }
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { loadError = e.message }
    }
    LaunchedEffect(company) { if (message.isBlank() && company != null) message = "Estimado cliente de ${company["companyName"].orEmpty()}, le recordamos que su factura de internet se encuentra pendiente de pago. Por favor regularice su cuenta para evitar la suspension del servicio. Gracias." }
    val list = morosos.orEmpty()
    val eta = list.size * 2
    val etaText = if (eta < 60) "$eta segundos" else "${(eta + 59) / 60} minutos"
    WebSection("Cobro masivo a morosos", "Clientes activos con factura pendiente y telefono registrado") {
        loadError?.let { Notice(it, true); TextButton(onClick = { reload++ }) { Text("Reintentar") } }
        if (morosos == null && loadError == null) LinearProgressIndicator(Modifier.fillMaxWidth())
        Text("${list.size} clientes morosos con telefono", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = IspRed)
        OutlinedTextField(message, { message = it.take(1000) }, label = { Text("Mensaje de cobro") }, minLines = 4, modifier = Modifier.fillMaxWidth(), supportingText = { Text("Puedes usar {nombre} y {precio}") })
        Text("Se envia un mensaje cada 2 segundos para evitar bloqueos de WhatsApp. Tiempo aproximado: $etaText. Manten esta pantalla abierta.", style = MaterialTheme.typography.labelSmall)
        WebActionFeedback(actions)
        Button(onClick = {
            actions.confirm("Cobro masivo", "¿Enviar el mensaje de cobro por WhatsApp a ${list.size} clientes morosos? Los mensajes no se pueden cancelar una vez enviados. Tardara aproximadamente $etaText.", "Enviar a ${list.size}", danger = true) {
                val contacts = list.map { c -> JSONObject().put("phone", c.optString("telefono")).put("message", message.replace("{nombre}", c.optString("nombre")).replace("{precio}", c.optString("precioPlan"))) }
                var sent = 0; var processed = 0
                for (chunk in contacts.chunked(10)) {
                    val result = try { vm.web("POST", "/wa/send-bulk", JSONObject().put("contacts", JSONArray(chunk))) }
                    catch (e: java.io.InterruptedIOException) { throw IllegalStateException("$sent enviados confirmados. La tanda siguiente no respondio a tiempo: puede haberse enviado. No repitas el envio sin revisar el historial.") }
                    result.serverRejected()?.let { throw IllegalStateException("$sent enviados antes del error: $it") }
                    sent += result.optJSONArray("results").objects().count { it.optString("status") == "sent" }
                    processed += chunk.size
                }
                "$sent de ${contacts.size} mensajes enviados"
            }
        }, enabled = connected && !actions.busy && list.isNotEmpty() && message.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.Campaign, null); Spacer(Modifier.width(8.dp)); Text(if (actions.busy) "Enviando ${list.size} mensajes..." else "Enviar a ${list.size} morosos")
        }
        if (list.isEmpty() && morosos != null) Text("No hay clientes morosos con telefono registrado.", style = MaterialTheme.typography.labelSmall)
    }
}

/** Conversacion completa del bot con un numero (web: WhatsApp bot > conversacion). */
@Composable
fun WebParityBotConversation(phone: String, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = webPath("/wa/bot/conversation/${webEncode(phone)}")
    LaunchedEffect(phone) { while (true) { vm.load(path, true); delay(15_000) } }
    val state = pages[path] ?: PageState(loading = true)
    val messages = state.webItems()
    AlertDialog(onDismissRequest = close, title = { Text("Conversacion $phone") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ReadStatus(state) { vm.load(path, true) }
            if (messages.isEmpty() && !state.loading && state.error == null) EmptyState("Sin mensajes")
            LazyColumn(Modifier.heightIn(max = 440.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                items(messages, key = { it.optInt("id") }) { row ->
                    val incoming = row.optString("messageType") == "incoming"
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (incoming) Arrangement.Start else Arrangement.End) {
                        Surface(color = if (incoming) MaterialTheme.colorScheme.surfaceVariant else IspGreen.copy(alpha = .12f), shape = MaterialTheme.shapes.medium, modifier = Modifier.widthIn(max = 260.dp)) {
                            Column(Modifier.padding(10.dp)) {
                                Text(row.text("message", ""), style = MaterialTheme.typography.bodyMedium)
                                Text("${if (incoming) "Cliente" else "Bot"} · ${row.text("createdAt", "")}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
                }
            }
        }
    }, confirmButton = { TextButton(onClick = close) { Text("Cerrar") } })
}
