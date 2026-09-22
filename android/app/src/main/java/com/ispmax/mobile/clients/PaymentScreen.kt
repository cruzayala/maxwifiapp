package com.ispmax.mobile

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.ui.ReliefIcon
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDateTime
import java.util.UUID

@Composable internal fun PaymentScreen(invoiceId: Int, vm: MainViewModel, requestedOperation: String? = null, onDocument: () -> Unit, close: () -> Unit) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var options by remember { mutableStateOf<JSONObject?>(null) }
    var operation by remember { mutableStateOf<JSONObject?>(null) }
    var draft by remember { mutableStateOf<JSONObject?>(null) }
    var amount by rememberSaveable(invoiceId) { mutableStateOf("") }
    var date by rememberSaveable(invoiceId) { mutableStateOf(LocalDateTime.now().withSecond(0).withNano(0).toString()) }
    var methodId by rememberSaveable(invoiceId) { mutableIntStateOf(0) }
    var methodMenu by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(true) }
    var attempted by remember { mutableStateOf(false) }
    var notFound by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }

    suspend fun receive(row: JSONObject) {
        require(row.optInt("invoiceId") == invoiceId) { "La respuesta corresponde a otra factura" }
        operation = row; notFound = false
        if (requestedOperation != null) return
        val saved = draft ?: JSONObject()
        saved.put("operationId", row.getString("id")).put("attempted", true)
        vm.savePaymentDraft(invoiceId, saved); draft = saved; attempted = true
    }
    suspend fun recover() {
        if (requestedOperation != null) { receive(vm.verifyPayment(requestedOperation)); return }
        val saved = vm.paymentDraft(invoiceId); draft = saved; attempted = saved?.optBoolean("attempted") == true
        if (attempted) {
            val operationId = saved?.optString("operationId").orEmpty()
            if (operationId.isNotBlank()) receive(vm.verifyPayment(operationId))
            else try { receive(vm.paymentRequest(saved!!.getString("key"))) }
            catch (e: ApiFailure) { if (e.code == "REQUEST_NOT_FOUND") { notFound = true; error = "La solicitud no llego al servidor. Puedes reintentar la misma solicitud." } else throw e }
        } else {
            options = vm.paymentOptions(invoiceId)
            options?.optJSONObject("activeOperation")?.let { receive(it) }
            if (amount.isBlank()) amount = options?.optJSONObject("invoice")?.optString("balance").orEmpty()
        }
    }
    fun action(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch { try { block() } catch (e: Exception) {
            if (e is CancellationException) throw e
            error = e.message ?: "No se pudo consultar el pago"
            if (e is ApiFailure && e.code in listOf("INVALID_PAYMENT", "INVALID_BALANCE", "STALE_INVOICE", "INVOICE_VERSION_REQUIRED") && draft != null) {
                draft = JSONObject(draft.toString()).put("notSubmitted", true)
                vm.savePaymentDraft(invoiceId, draft!!)
            }
        } finally { busy = false } }
    }
    LaunchedEffect(invoiceId) { try { recover() } catch (e: Exception) { if (e is CancellationException) throw e; error = e.message } finally { busy = false } }
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = { if (!busy) close() }) {
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar pago") }
                    Column(Modifier.weight(1f)) { Text("Registrar pago", style = MaterialTheme.typography.titleLarge); Text("Factura #$invoiceId", style = MaterialTheme.typography.bodySmall) }
                    ReliefIcon(Icons.Outlined.Payments, size = 40.dp)
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider()
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("payment-error")) }
                    AnimatedContent(targetState = operation?.optString("state") ?: if (attempted) "recovery" else "form", label = "payment-state") { state ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            val row = operation
                            if (row != null) {
                                Text(when (state) { "confirmed" -> "Pago confirmado"; "confirmed_external" -> "Confirmado en WispHub"; "rejected" -> "Solicitud rechazada"; else -> "Pendiente de confirmacion" }, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                                Text(row.text("clientName")); Text(money(row.optDouble("amount")), style = MaterialTheme.typography.headlineMedium)
                                Text(row.text("paymentMethodName"))
                                listOf("Solicitud guardada" to true, "Confirmado por WispHub" to (state in listOf("confirmed_external", "confirmed")), "Importes verificados y recibo guardado" to (state == "confirmed")).forEach { (label, done) ->
                                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) { Icon(if (done) Icons.Outlined.CheckCircle else Icons.Outlined.Schedule, null, tint = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant); Text(label, Modifier.weight(1f)) }
                                }
                                if (state != "confirmed") Text(if (state == "uncertain") "No se pudo confirmar la respuesta. Requiere conciliacion; no registres otro cobro." else if (state == "rejected") "WispHub no confirmo este pago como aplicado." else "Espera la confirmacion y consulta el estado. No se enviara otro cobro.", style = MaterialTheme.typography.bodyMedium)
                                if (row.optBoolean("canVerify")) Button(onClick = { action { receive(vm.verifyPayment(row.getString("id"))) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text("Verificar pago") }
                                if (state == "confirmed") Button(onClick = onDocument, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.ReceiptLong, null); Spacer(Modifier.width(8.dp)); Text("Ver documento") }
                                if (requestedOperation == null && (state == "confirmed" || state == "rejected" && !row.optBoolean("canVerify"))) OutlinedButton(onClick = { action { vm.discardPaymentDraft(invoiceId); operation = null; draft = null; attempted = false; amount = ""; methodId = 0; recover() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Consultar saldo restante") }
                            } else if (attempted) {
                                Text("Solicitud guardada", style = MaterialTheme.typography.titleMedium)
                                draft?.optJSONObject("body")?.let { Text(money(it.optDouble("amount"))) }
                                if (draft?.optBoolean("notSubmitted") == true) OutlinedButton(onClick = { action { vm.discardPaymentDraft(invoiceId); draft = null; attempted = false; amount = ""; recover() } }, enabled = !busy) { Text("Corregir solicitud no enviada") }
                                else Button(onClick = { action { if (notFound) receive(vm.submitPayment(invoiceId, draft!!.getJSONObject("body"), draft!!.getString("key"))) else recover() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text(if (notFound) "Reintentar misma solicitud" else "Consultar solicitud") }
                            } else if (options?.optJSONObject("invoice") != null) {
                                val invoice = options!!.getJSONObject("invoice")
                                Text(options!!.text("clientName"), style = MaterialTheme.typography.titleMedium)
                                Text("Saldo verificado", style = MaterialTheme.typography.labelLarge)
                                Text(money(invoice.optDouble("balance")), style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                                HorizontalDivider()
                                OutlinedTextField(amount, { amount = it }, enabled = !busy, singleLine = true, label = { Text("Importe recibido") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), leadingIcon = { Icon(Icons.Outlined.Payments, null) }, modifier = Modifier.fillMaxWidth())
                                val methods = options!!.optJSONArray("methods").objects()
                                Box {
                                    OutlinedButton(onClick = { methodMenu = true }, enabled = !busy && methods.isNotEmpty(), modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.AccountBalanceWallet, null); Spacer(Modifier.width(8.dp)); Text(methods.firstOrNull { it.optInt("id") == methodId }?.text("nombre") ?: "Forma de pago", Modifier.weight(1f)); Icon(Icons.Outlined.ExpandMore, null) }
                                    DropdownMenu(methodMenu, { methodMenu = false }, modifier = Modifier.heightIn(max = 280.dp)) { methods.forEach { m -> DropdownMenuItem(text = { Text(m.text("nombre")) }, onClick = { methodId = m.optInt("id"); methodMenu = false }) } }
                                }
                                if (methods.isEmpty()) Text("No hay formas de pago sincronizadas.", color = MaterialTheme.colorScheme.error)
                                OutlinedTextField(date.replace('T', ' '), {}, readOnly = true, enabled = !busy, singleLine = true, label = { Text("Fecha y hora") }, supportingText = { Text("Hora del dispositivo") }, trailingIcon = { IconButton(onClick = {
                                    val current = runCatching { LocalDateTime.parse(date) }.getOrDefault(LocalDateTime.now())
                                    android.app.DatePickerDialog(context, { _, year, month, day ->
                                        android.app.TimePickerDialog(context, { _, hour, minute -> date = LocalDateTime.of(year, month + 1, day, hour, minute).toString() }, current.hour, current.minute, true).show()
                                    }, current.year, current.monthValue - 1, current.dayOfMonth).show()
                                }, enabled = !busy) { Icon(Icons.Outlined.CalendarMonth, "Elegir fecha y hora") } }, modifier = Modifier.fillMaxWidth())
                                Button(onClick = { try { paymentAmount(amount, invoice.getString("balance")); paymentDate(date); error = null; confirm = true } catch (e: Exception) { error = e.message } }, enabled = !busy && methodId > 0 && invoice.optDouble("balance") > 0, modifier = Modifier.fillMaxWidth()) { Text("Revisar pago") }
                            } else if (!busy) OutlinedButton(onClick = { action { recover() } }) { Text("Consultar factura") }
                        }
                    }
                }
            }
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { confirm = false }, title = { Text("Confirmar pago") }, text = { Text("${options?.text("clientName")}\nRD$ $amount\nFactura #$invoiceId") }, dismissButton = { TextButton(onClick = { confirm = false }) { Text("Volver") } }, confirmButton = { TextButton(onClick = {
        confirm = false
        action {
            val invoice = options!!.getJSONObject("invoice")
            val body = JSONObject().put("amount", paymentAmount(amount, invoice.getString("balance")).toPlainString()).put("paymentMethodId", methodId).put("paidAt", paymentDate(date)).put("invoiceVersion", invoice.getString("version"))
            val saved = JSONObject().put("key", UUID.randomUUID().toString()).put("body", body).put("attempted", true)
            vm.savePaymentDraft(invoiceId, saved); draft = saved; attempted = true
            receive(vm.submitPayment(invoiceId, body, saved.getString("key")))
        }
    }) { Text("Confirmar y enviar") } })
}
