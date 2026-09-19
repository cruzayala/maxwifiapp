package com.ispmax.mobile

import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.data.IpRangeRules
import com.ispmax.mobile.data.LocalIpRange
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewClientEditor(vm: MainViewModel, pages: Map<String, PageState>, close: (Int?) -> Unit) {
    val plansPath = "/plans"
    val zonesPath = "/catalog/zones?pageSize=100"
    LaunchedEffect(Unit) { vm.load(plansPath, true); vm.load(zonesPath, true) }
    val plans = pages[plansPath]?.body?.optJSONArray("items").objects()
    val zones = pages[zonesPath]?.body?.optJSONArray("items").objects()
    val configuredRanges by vm.ipRanges.collectAsStateWithLifecycle()
    val activeRanges = configuredRanges.filter { it.active }.sortedBy { it.priority }
    var raw by rememberSaveable { mutableStateOf("{}") }
    var loaded by rememberSaveable { mutableStateOf(false) }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var picker by rememberSaveable { mutableStateOf("") }
    var ipamRaw by rememberSaveable { mutableStateOf<String?>(null) }
    var ipamBusy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) {
        val ranges = vm.ensureIpRanges()
        val preferred = ranges.filter { it.active }.minByOrNull { it.priority }?.cidr.orEmpty()
        raw = (vm.newClientDraft() ?: JSONObject().put("key", UUID.randomUUID().toString()).put("uploadMbps", "10").put("downloadMbps", "10").put("cidr", preferred).put("attempted", false)).toString()
        loaded = true
    }
    LaunchedEffect(raw, loaded) { if (loaded) { delay(250); vm.saveNewClientDraft(JSONObject(raw)) } }
    fun update(field: String, value: Any) {
        val current = JSONObject(raw)
        if (field in listOf("ip", "cidr") && current.text("reservationToken", "").isNotBlank()) {
            val token = current.text("reservationToken", "")
            current.remove("reservationToken"); current.remove("reservationExpiresAt")
            scope.launch { runCatching { vm.releaseIp(token, UUID.randomUUID().toString()) } }
        }
        raw = current.put(field, value).put("key", UUID.randomUUID().toString()).put("attempted", false).toString(); error = null
    }
    val form = JSONObject(raw)
    val attempted = form.optBoolean("attempted")
    val selectedRange = activeRanges.firstOrNull { it.cidr == form.text("cidr", "") }
    val canNext = when (step) {
        0 -> form.text("serviceName", "").isNotBlank()
        1 -> form.optInt("planId") > 0 && form.optInt("zoneId") > 0 && selectedRange != null && form.text("ip", "").isNotBlank() && form.text("reservationToken", "").isNotBlank() && form.text("uploadMbps", "").toDoubleOrNull()?.let { it > 0 } == true && form.text("downloadMbps", "").toDoubleOrNull()?.let { it > 0 } == true
        else -> true
    }
    fun submit() { scope.launch {
        busy = true; error = null
        try {
            val current = JSONObject(raw).put("attempted", true); raw = current.toString(); vm.saveNewClientDraft(current)
            val body = JSONObject(); listOf("serviceName", "phone", "nationalId", "email", "city", "address", "zoneId", "planId", "ip", "uploadMbps", "downloadMbps", "reservationToken").forEach { if (current.has(it)) body.put(it, current.opt(it)) }
            val result = vm.provisionClient(body, current.getString("key")); loaded = false; close(result.getJSONObject("client").getInt("idServicio"))
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = e.message
            if (e !is IOException || e is ApiFailure && e.status in 400..499) raw = JSONObject(raw).put("attempted", false).toString()
        } finally { busy = false }
    } }
    Dialog(onDismissRequest = { if (!busy) close(null) }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Column { Text("Nuevo cliente"); Text(listOf("Datos", "Servicio", "Confirmar")[step], style = MaterialTheme.typography.labelSmall) } }, navigationIcon = { IconButton(onClick = { if (step > 0 && !attempted) step-- else close(null) }, enabled = !busy) { Icon(if (step > 0) Icons.Outlined.ArrowBack else Icons.Outlined.Close, "Volver") } }) }, bottomBar = {
                Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (step < 2) Button(onClick = { step++ }, enabled = loaded && !busy && canNext && !attempted, modifier = Modifier.fillMaxWidth()) { Text("Continuar"); Spacer(Modifier.width(8.dp)); Icon(Icons.Outlined.ArrowForward, null) }
                    else Button(onClick = { submit() }, enabled = loaded && !busy && !attempted || loaded && !busy && attempted, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.PersonAdd, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Creando..." else if (attempted) "Reintentar la misma alta" else "Crear en WispHub y MikroTik") }
                }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(18.dp), verticalArrangement = Arrangement.spacedBy(13.dp)) {
                    LinearProgressIndicator(progress = { (step + 1) / 3f }, modifier = Modifier.fillMaxWidth())
                    error?.let { Notice(it, true) }
                    if (attempted) Notice("La respuesta del alta no se confirmo. Se conserva la misma solicitud para reanudar sin duplicar.")
                    when (step) {
                        0 -> {
                            Text("Identidad del servicio", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            NewClientField(form, "serviceName", "Nombre completo", loaded && !busy && !attempted, ::update)
                            NewClientField(form, "phone", "Telefono", loaded && !busy && !attempted, ::update, KeyboardType.Phone)
                            NewClientField(form, "nationalId", "Cedula o documento", loaded && !busy && !attempted, ::update)
                            NewClientField(form, "email", "Correo", loaded && !busy && !attempted, ::update, KeyboardType.Email)
                            NewClientField(form, "city", "Ciudad o localidad", loaded && !busy && !attempted, ::update)
                            NewClientField(form, "address", "Direccion", loaded && !busy && !attempted, ::update, multiline = true)
                        }
                        1 -> {
                            Text("Plan y red", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            OutlinedButton(onClick = { picker = "plan" }, enabled = loaded && !busy && !attempted, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Speed, null); Spacer(Modifier.width(8.dp)); Text(form.text("planName", "Seleccionar plan"), Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }
                            OutlinedButton(onClick = { picker = "zone" }, enabled = loaded && !busy && !attempted, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Place, null); Spacer(Modifier.width(8.dp)); Text(form.text("zoneName", "Seleccionar zona"), Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }
                            OutlinedButton(onClick = { picker = "range" }, enabled = loaded && !busy && !attempted && activeRanges.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.AccountTree, null); Spacer(Modifier.width(8.dp)); Text(selectedRange?.let { "${it.name}  ·  ${it.cidr}" } ?: "Seleccionar rango IP", Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }
                            OutlinedButton(onClick = { scope.launch { ipamBusy = true; error = null; try { val cidrs = JSONArray(); activeRanges.forEach { cidrs.put(it.cidr) }; require(cidrs.length() > 0) { "Configura al menos un rango IP activo" }; ipamRaw = vm.queryIpam(cidrs).toString(); picker = "ip" } catch (e: Exception) { error = e.message } finally { ipamBusy = false } } }, enabled = loaded && !busy && !attempted && !ipamBusy && activeRanges.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.TravelExplore, null); Spacer(Modifier.width(8.dp)); Text(if (ipamBusy) "Comprobando WispHub y MikroTik..." else "Recomendar IP disponible", Modifier.weight(1f)); Icon(Icons.Outlined.ChevronRight, null) }
                            NewClientField(form, "ip", "IP del cliente", loaded && !busy && !attempted, ::update)
                            if (selectedRange == null && form.text("cidr", "").isNotBlank()) Notice("El borrador usa ${form.text("cidr", "")}, pero ese segmento ya no esta activo. Selecciona otro rango antes de continuar.", true)
                            form.text("reservationToken", "").takeIf { it.isNotBlank() }?.let { AssistChip({}, label = { Text("IP reservada · vence ${expiryText(form.text("reservationExpiresAt", ""))}") }, leadingIcon = { Icon(Icons.Outlined.LockClock, null) }) }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Box(Modifier.weight(1f)) { NewClientField(form, "uploadMbps", "Subida Mbps", loaded && !busy && !attempted, ::update, KeyboardType.Decimal) }
                                Box(Modifier.weight(1f)) { NewClientField(form, "downloadMbps", "Bajada Mbps", loaded && !busy && !attempted, ::update, KeyboardType.Decimal) }
                            }
                            Notice("El servidor valida que la IP pertenezca a los rangos de clientes y que no exista en WispHub ni MikroTik.")
                        }
                        else -> {
                            Text("Revisar alta", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                            ReviewValue("Cliente", form.text("serviceName")); ReviewValue("Plan", form.text("planName")); ReviewValue("Zona", form.text("zoneName")); ReviewValue("IP", form.text("ip")); ReviewValue("Velocidad", "${form.text("uploadMbps")} / ${form.text("downloadMbps")} Mbps")
                            HorizontalDivider(); Notice("La operacion solo se mostrara completa cuando WispHub, la cola MikroTik y SQLite queden confirmados.")
                        }
                    }
                    if (loaded && !busy && !attempted) TextButton(onClick = { scope.launch { val token = JSONObject(raw).text("reservationToken", ""); if (token.isNotBlank()) runCatching { vm.releaseIp(token, UUID.randomUUID().toString()) }; vm.discardNewClientDraft(); loaded = false; close(null) } }) { Text("Descartar borrador") }
                }
            }
        }
    }
    if (picker in listOf("plan", "zone")) {
        val options = if (picker == "plan") plans else zones
        AlertDialog(onDismissRequest = { picker = "" }, title = { Text(if (picker == "plan") "Seleccionar plan" else "Seleccionar zona") }, text = {
            LazyColumn(Modifier.heightIn(max = 430.dp)) { items(options, key = { it.optInt("id") }) { row -> ListItem(headlineContent = { Text(row.text("nombre")) }, supportingContent = if (picker == "plan") ({ Text(row.text("tipo", "Simple Queue")) }) else null, modifier = Modifier.clickable {
                if (picker == "plan") { update("planId", row.optInt("id")); update("planName", row.text("nombre")); inferSpeed(row.text("nombre"))?.let { (up, down) -> update("uploadMbps", numberText(up)); update("downloadMbps", numberText(down)) } }
                else { update("zoneId", row.optInt("id")); update("zoneName", row.text("nombre")) }
                picker = ""
            }) } }
        }, confirmButton = { TextButton(onClick = { picker = "" }) { Text("Cancelar") } })
    }
    if (picker == "range") {
        AlertDialog(onDismissRequest = { picker = "" }, title = { Text("Seleccionar rango") }, text = {
            LazyColumn(Modifier.heightIn(max = 430.dp)) { items(activeRanges, key = LocalIpRange::id) { range ->
                ListItem(headlineContent = { Text(range.name, fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${range.cidr}  ·  VLAN ${range.vlan ?: "sin definir"}") }, leadingContent = { Icon(Icons.Outlined.AccountTree, null) }, trailingContent = { if (range.cidr == form.text("cidr", "")) Icon(Icons.Outlined.Check, null) }, modifier = Modifier.clickable { update("cidr", range.cidr); update("ip", ""); picker = "" })
            } }
        }, confirmButton = { TextButton(onClick = { picker = "" }) { Text("Cancelar") } })
    }
    if (picker == "ip") {
        val catalog = ipamRaw?.let(::JSONObject)
        val options = catalog?.optJSONArray("rows").objects().filter { row ->
            row.optJSONObject("reservation") == null && activeRanges.firstOrNull { it.cidr == row.text("cidr", "") }?.let { IpRangeRules.isAssignable(it, row.text("ip", "")) } == true
        }
        AlertDialog(onDismissRequest = { if (!ipamBusy) picker = "" }, title = { Text("IP disponibles") }, text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${catalog?.text("source", "Sin fuente")} · ${if (catalog?.optBoolean("stale") == true) "copia desactualizada" else "validacion en vivo"}", style = MaterialTheme.typography.bodySmall)
            if (catalog?.optBoolean("stale") == true) Notice("No se permite reservar desde datos desactualizados.", true)
            LazyColumn(Modifier.heightIn(max = 430.dp)) { items(options, key = { it.text("ip") }) { row ->
                ListItem(headlineContent = { Text(row.text("ip"), fontWeight = FontWeight.SemiBold) }, supportingContent = { Text("${row.text("cidr")} · ${row.text("availabilityConfidence", "verificada")}") }, leadingContent = { Icon(Icons.Outlined.Lan, null) }, modifier = Modifier.clickable(enabled = !ipamBusy && catalog?.optBoolean("stale") != true) {
                    scope.launch {
                        ipamBusy = true; error = null
                        try {
                            val current = JSONObject(raw)
                            val previousToken = current.text("reservationToken", "")
                            if (previousToken.isNotBlank() && current.text("ip", "") != row.text("ip")) runCatching { vm.releaseIp(previousToken, UUID.randomUUID().toString()) }
                            val reservationKey = if (current.text("ipReservationFor", "") == row.text("ip")) current.text("ipReservationKey", UUID.randomUUID().toString()) else UUID.randomUUID().toString()
                            raw = current.put("ipReservationFor", row.text("ip")).put("ipReservationKey", reservationKey).toString(); vm.saveNewClientDraft(JSONObject(raw))
                            val cidrs = JSONArray(); activeRanges.forEach { cidrs.put(it.cidr) }
                            val reservation = vm.reserveIp(JSONObject().put("ip", row.text("ip")).put("clientName", current.text("serviceName")).put("cidrs", cidrs), reservationKey)
                            raw = JSONObject(raw).put("cidr", row.text("cidr")).put("ip", reservation.text("ip")).put("reservationToken", reservation.text("token")).put("reservationExpiresAt", reservation.text("expiresAt")).put("key", UUID.randomUUID().toString()).toString()
                            picker = ""
                        } catch (e: Exception) { error = e.message; picker = "" } finally { ipamBusy = false }
                    }
                })
            } }
            if (options.isEmpty()) EmptyState("No hay direcciones disponibles en este rango")
        } }, confirmButton = { TextButton(onClick = { picker = "" }, enabled = !ipamBusy) { Text("Cerrar") } })
    }
}

@Composable
private fun NewClientField(form: JSONObject, field: String, label: String, enabled: Boolean, update: (String, Any) -> Unit, keyboard: KeyboardType = KeyboardType.Text, multiline: Boolean = false) {
    OutlinedTextField(form.text(field, ""), { update(field, it) }, label = { Text(label) }, enabled = enabled, singleLine = !multiline, minLines = if (multiline) 2 else 1, keyboardOptions = KeyboardOptions(keyboardType = keyboard), modifier = Modifier.fillMaxWidth())
}

@Composable
private fun ReviewValue(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) { Text(label, Modifier.weight(1f), color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, fontWeight = FontWeight.SemiBold) }
}

private fun inferSpeed(value: String): Pair<Double, Double>? {
    val matches = mutableListOf<Double>()
    for (match in Regex("(\\d+(?:[.,]\\d+)?)\\s*(g|gb|m|mb|k|kb)?", RegexOption.IGNORE_CASE).findAll(value).take(2)) {
        val number = match.groupValues[1].replace(',', '.').toDoubleOrNull() ?: return null
        matches += when (match.groupValues[2].lowercase()) { "g", "gb" -> number * 1000; "k", "kb" -> number / 1000; else -> number }
    }
    if (matches.isEmpty() || matches.any { it <= 0 }) return null
    return matches[0] to (matches.getOrNull(1) ?: matches[0])
}

private fun numberText(value: Double) = if (value % 1.0 == 0.0) value.toInt().toString() else value.toString()

private fun expiryText(value: String): String = runCatching {
    DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.of("America/Santo_Domingo")).format(Instant.parse(value))
}.getOrDefault("pronto")
