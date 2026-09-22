package com.ispmax.mobile

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalContext
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.PhoneLinks
import kotlinx.coroutines.delay
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsappScreen(vm: MainViewModel, pages: Map<String, PageState>, onClient: (Int) -> Unit = {}) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val statusPath = "/whatsapp/status"
    LaunchedEffect(Unit) { vm.load(statusPath, true) }
    val status = pages[statusPath]?.body
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("WhatsApp", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(if (status?.text("status") == "connected") "Conectado y listo" else "Estado: ${status?.text("status", "consultando")}", color = if (status?.text("status") == "connected") IspGreen else MaterialTheme.colorScheme.onSurfaceVariant) }
            IconButton(onClick = { vm.load(statusPath, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar estado") }
        }
        PrimaryTabRow(tab) { listOf("Historial", "Nuevo", "Plantillas", "Bot").forEachIndexed { index, label -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label) }) } }
        when (tab) { 0 -> WhatsappHistory(vm, pages); 1 -> WhatsappComposer(vm, pages, status?.optBoolean("canSend") == true); 2 -> WhatsappTemplates(vm, pages); else -> WhatsappBot(vm, pages, onClient) }
    }
}

@Composable
private fun WhatsappHistory(vm: MainViewModel, pages: Map<String, PageState>) {
    var query by rememberSaveable { mutableStateOf("") }; var page by rememberSaveable { mutableIntStateOf(1) }
    val path = "/whatsapp/history?q=${URLEncoder.encode(query, "UTF-8")}&page=$page&pageSize=50"; LaunchedEffect(path) { vm.load(path) }; val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(query, { query = it; page = 1 }, label = { Text("Cliente, telefono o mensaje") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) { if (rows.isEmpty() && !state.loading) item { EmptyState("No hay mensajes registrados") }; items(rows, key = { it.optInt("id") }) { row -> OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("clientName", row.text("phone")), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("message")}\n${row.text("createdAt")}", maxLines = 3) }, leadingContent = { Icon(Icons.Outlined.Chat, null, tint = IspGreen) }, trailingContent = { StatusBadge(row.text("status")) }) } } }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { IconButton(onClick = { page-- }, enabled = page > 1) { Icon(Icons.Outlined.ChevronLeft, "Anterior") }; Text("${state.body?.optInt("total") ?: 0} mensajes", style = MaterialTheme.typography.bodySmall); IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true) { Icon(Icons.Outlined.ChevronRight, "Siguiente") } }
    }
}

@Composable
private fun WhatsappComposer(vm: MainViewModel, pages: Map<String, PageState>, connected: Boolean) {
    var clientQuery by rememberSaveable { mutableStateOf("") }; var selectedJson by rememberSaveable { mutableStateOf<String?>(null) }; var message by rememberSaveable { mutableStateOf("") }; var key by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }; var attempted by rememberSaveable { mutableStateOf(false) }; var confirm by rememberSaveable { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }; var result by rememberSaveable { mutableStateOf<String?>(null) }; var error by rememberSaveable { mutableStateOf<String?>(null) }
    val path = "/clients?q=${URLEncoder.encode(clientQuery, "UTF-8")}&page=1&pageSize=20"; val scope = rememberCoroutineScope(); val selected = selectedJson?.let { JSONObject(it) }
    LaunchedEffect(Unit) { vm.whatsappDraft()?.let { draft -> selectedJson = draft.optString("client").takeIf { it.isNotBlank() }; message = draft.optString("message"); key = draft.optString("key", key); attempted = draft.optBoolean("attempted") } }
    LaunchedEffect(clientQuery) { if (clientQuery.length >= 2 && selected == null) vm.load(path, true) }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (!connected) Notice("WhatsApp no esta conectado en el servidor. El borrador se conserva, pero no se enviara.", true)
        if (selected == null) {
            OutlinedTextField(clientQuery, { clientQuery = it }, label = { Text("Buscar cliente") }, leadingIcon = { Icon(Icons.Outlined.PersonSearch, null) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
            val rows = pages[path]?.body?.optJSONArray("items").objects()
            LazyColumn(Modifier.weight(1f)) { items(rows, key = { it.optInt("idServicio") }) { row -> ListItem(headlineContent = { Text(row.text("aliasNombre", row.text("nombre"))) }, supportingContent = { Text(row.text("telefono", "Sin telefono")) }, modifier = Modifier.clickable { selectedJson = row.toString(); clientQuery = "" }) } }
        } else {
            OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(selected.text("aliasNombre", selected.text("nombre")), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(selected.text("telefono", "Telefono no disponible")) }, trailingContent = { IconButton(onClick = { if (!attempted) selectedJson = null }) { Icon(Icons.Outlined.Close, "Cambiar cliente") } }) }
            OutlinedTextField(message, { if (!attempted) message = it.take(2000) }, label = { Text("Mensaje") }, supportingText = { Text("${message.length}/2000") }, minLines = 5, modifier = Modifier.fillMaxWidth(), enabled = !attempted)
            Spacer(Modifier.weight(1f))
            result?.let { Notice(it) }; error?.let { Notice(it, true) }
            Button(onClick = { scope.launch { vm.saveWhatsappDraft(JSONObject().put("client", selectedJson).put("message", message).put("key", key).put("attempted", attempted)); confirm = true } }, enabled = connected && !busy && message.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Send, null); Spacer(Modifier.width(8.dp)); Text(if (attempted) "Consultar el mismo envio" else "Revisar y enviar") }
        }
    }
    if (confirm && selected != null) AlertDialog(onDismissRequest = { if (!busy) confirm = false }, title = { Text("Enviar a ${selected.text("aliasNombre", selected.text("nombre"))}") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(message); Notice("Se enviara una sola vez. Un resultado incierto quedara en revision y no se repetira automaticamente.") } }, confirmButton = { Button(enabled = !busy, onClick = { scope.launch { busy = true; error = null; try { attempted = true; vm.saveWhatsappDraft(JSONObject().put("client", selectedJson).put("message", message).put("key", key).put("attempted", true)); val response = vm.sendWhatsapp(JSONObject().put("idServicio", selected.optInt("idServicio")).put("message", message), key); result = when (response.text("state")) { "sent" -> "Mensaje enviado y registrado"; "failed" -> "No enviado: ${response.text("error")}"; else -> "Envio pendiente de revision; no se repetira" }; if (response.text("state") == "sent") { message = ""; attempted = false; key = UUID.randomUUID().toString(); vm.discardWhatsappDraft() } } catch (e: Exception) { error = e.message } finally { busy = false; confirm = false } } }) { Text("Enviar") } }, dismissButton = { TextButton(onClick = { confirm = false }, enabled = !busy) { Text("Cancelar") } })
}

@Composable
private fun WhatsappTemplates(vm: MainViewModel, pages: Map<String, PageState>) {
    val path = "/whatsapp/templates?page=1&pageSize=100"; LaunchedEffect(Unit) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val rows = state.body?.optJSONArray("items").objects()
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { item { ReadStatus(state) { vm.load(path, true) } }; if (rows.isEmpty() && !state.loading) item { EmptyState("No hay plantillas") }; items(rows, key = { it.optInt("id") }) { row -> OutlinedCard(Modifier.fillMaxWidth()) { ListItem(headlineContent = { Text(row.text("name"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("category")} · ${row.optInt("useCount")} usos\n${row.text("content")}", maxLines = 4) }, leadingContent = { Icon(Icons.Outlined.Description, null, tint = IspGreen) }) } } }
}

@Composable
private fun WhatsappBot(vm: MainViewModel, pages: Map<String, PageState>, onClient: (Int) -> Unit) {
    val context = LocalContext.current
    var search by rememberSaveable { mutableStateOf("") }
    var query by rememberSaveable { mutableStateOf("") }
    val statusPath = "/whatsapp/bot"
    val conversationsPath = "/whatsapp/bot/conversations?limit=50&q=${URLEncoder.encode(query, "UTF-8")}"
    LaunchedEffect(Unit) { vm.load(statusPath, true) }
    LaunchedEffect(search) { if (search != query) { delay(350); query = search } }
    LaunchedEffect(conversationsPath) { vm.load(conversationsPath, true) }
    val state = pages[statusPath] ?: PageState(loading = true)
    val status = state.body
    val conversations = pages[conversationsPath]?.body?.optJSONArray("items").objects()
    val scope = rememberCoroutineScope()
    var requested by remember { mutableStateOf<Boolean?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var conversation by rememberSaveable { mutableStateOf<String?>(null) }
    LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            ReadStatus(state) { vm.load(statusPath, true); vm.load(conversationsPath, true) }
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(if (status?.optBoolean("enabled") == true) "Bot activo" else "Bot inactivo", fontWeight = FontWeight.Bold) },
                    supportingContent = { Text(if (status?.optBoolean("waConnected") == true) "WhatsApp conectado" else "WhatsApp no conectado") },
                    leadingContent = { Icon(Icons.Outlined.SmartToy, null, tint = if (status?.optBoolean("enabled") == true) IspGreen else MaterialTheme.colorScheme.onSurfaceVariant) },
                    trailingContent = {
                        Switch(checked = status?.optBoolean("enabled") == true, onCheckedChange = { requested = it }, enabled = status?.optBoolean("canManage") == true && !busy)
                    }
                )
            }
        }
        item {
            val stats = status?.optJSONObject("stats")
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BotMetric("Recibidos", stats?.optInt("incoming") ?: 0, Modifier.weight(1f))
                BotMetric("Respuestas", stats?.optInt("outgoing") ?: 0, Modifier.weight(1f))
                BotMetric("Chats", stats?.optInt("conversations") ?: 0, Modifier.weight(1f))
            }
            error?.let { Notice(it, true) }
            Text("Conversaciones recientes", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 10.dp))
            OutlinedTextField(search, { search = it }, singleLine = true, label = { Text("Buscar por nombre o numero") },
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar busqueda") } })
        }
        if (conversations.isEmpty() && pages[conversationsPath]?.loading != true) item { EmptyState(if (query.isBlank()) "Todavia no hay conversaciones del bot" else "Ninguna conversacion coincide con \"$query\"") }
        items(conversations, key = { it.text("phone") }) { row ->
            OutlinedCard(Modifier.fillMaxWidth()) {
                ListItem(
                    headlineContent = { Text(row.text("clientName", row.text("phone")), fontWeight = FontWeight.SemiBold) },
                    supportingContent = { Text("${row.text("lastMessage")}\n${row.optInt("messageCount")} mensajes · ${row.text("lastAt")}", maxLines = 3) },
                    leadingContent = { Icon(Icons.Outlined.Forum, null, tint = IspGreen) }
                )
                // Desde la conversacion se llega al cliente o se sigue el chat en WhatsApp.
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { conversation = row.text("phone", "") }, enabled = row.text("phone", "").isNotBlank()) {
                        Icon(Icons.Outlined.Forum, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Ver conversacion")
                    }
                    if (row.optInt("idServicio") > 0) OutlinedButton(onClick = { onClient(row.optInt("idServicio")) }) {
                        Icon(Icons.Outlined.Person, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Expediente")
                    }
                    if (PhoneLinks.international(row.text("phone", "")) != null) FilledTonalButton(onClick = { PhoneLinks.openWhatsapp(context, row.text("phone", ""), null) }) {
                        Icon(Icons.Outlined.Chat, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Seguir en WhatsApp")
                    }
                }
            }
        }
    }
    conversation?.let { phone -> WebParityBotConversation(phone, vm, pages) { conversation = null } }
    requested?.let { enabled ->
        AlertDialog(onDismissRequest = { if (!busy) requested = null }, title = { Text(if (enabled) "Activar bot" else "Desactivar bot") },
            text = { Text(if (enabled) "El bot empezara a responder cuando WhatsApp este conectado." else "El bot dejara de responder automaticamente; el historial se conserva.") },
            confirmButton = { Button(onClick = { scope.launch { busy = true; error = null; try { vm.toggleWhatsappBot(enabled, UUID.randomUUID().toString()); requested = null } catch (failure: Exception) { error = failure.message } finally { busy = false } } }, enabled = !busy) { Text("Confirmar") } },
            dismissButton = { TextButton(onClick = { requested = null }, enabled = !busy) { Text("Cancelar") } })
    }
}

@Composable
private fun BotMetric(label: String, value: Int, modifier: Modifier = Modifier) {
    Surface(modifier, shape = MaterialTheme.shapes.small, color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.padding(10.dp)) { Text(value.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(label, style = MaterialTheme.typography.labelSmall) }
    }
}
