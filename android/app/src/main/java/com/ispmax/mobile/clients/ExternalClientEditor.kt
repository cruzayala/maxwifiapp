package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.data.ApiFailure
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

private val externalProfileFields = linkedMapOf(
    "displayName" to "Nombre completo", "phone" to "Telefono", "nationalId" to "Cedula o documento",
    "email" to "Correo", "address" to "Direccion", "city" to "Ciudad o localidad",
)
private val externalServiceFields = linkedMapOf(
    "ip" to "Direccion IP", "macCpe" to "MAC CPE", "lanInterface" to "Interfaz LAN",
    "onuSerial" to "Serial ONU", "wifiSsid" to "Nombre WiFi", "comments" to "Comentarios",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExternalClientEditor(id: Int, initialSection: String, vm: MainViewModel, close: () -> Unit) {
    var section by rememberSaveable(id) { mutableStateOf(initialSection) }
    var sourceRaw by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var formRaw by rememberSaveable(id) { mutableStateOf<String?>(null) }
    var wifiPassword by rememberSaveable(id) { mutableStateOf("") }
    var key by rememberSaveable(id) { mutableStateOf(UUID.randomUUID().toString()) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var attempted by rememberSaveable(id) { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun load() {
        scope.launch {
            loading = true; error = null
            try {
                val result = vm.externalClientForEdit(id)
                sourceRaw = result.toString(); formRaw = result.toString(); wifiPassword = ""; attempted = false; key = UUID.randomUUID().toString()
            } catch (e: Exception) { if (e is CancellationException) throw e else error = e.message }
            finally { loading = false }
        }
    }
    LaunchedEffect(id) { load() }
    val source = sourceRaw?.let(::JSONObject)
    val form = formRaw?.let(::JSONObject)
    fun update(field: String, value: String) {
        val current = form ?: return
        current.getJSONObject(section).put(field, value)
        formRaw = current.toString(); key = UUID.randomUUID().toString(); attempted = false; error = null
    }
    fun changes(): JSONObject {
        val result = JSONObject(); val current = form?.optJSONObject(section); val original = source?.optJSONObject(section)
        val fields = if (section == "profile") externalProfileFields.keys else externalServiceFields.keys
        fields.forEach { field -> if (current?.optString(field, "") != original?.optString(field, "")) result.put(field, current?.optString(field, "") ?: "") }
        if (section == "service" && wifiPassword.isNotBlank()) result.put("wifiPassword", wifiPassword)
        return result
    }
    fun submit() {
        val base = source ?: return
        val changed = changes()
        if (changed.length() == 0) { error = "No hay cambios para guardar"; return }
        scope.launch {
            busy = true; error = null; attempted = true
            try {
                val result = vm.changeExternalClient(id, section, changed, key, base.getString("version"))
                val refreshed = result.getJSONObject("client")
                sourceRaw = refreshed.toString(); formRaw = refreshed.toString(); wifiPassword = ""; attempted = false
                close()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = e.message
                if (e is ApiFailure && e.code == "STALE_EXTERNAL_CLIENT") attempted = false
                if (e !is IOException || e is ApiFailure && e.status in 400..499 && e.code != "STALE_EXTERNAL_CLIENT") attempted = false
            } finally { busy = false }
        }
    }

    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(
                title = { Column { Text("Editar cliente"); Text("WispHub en vivo · #$id", style = MaterialTheme.typography.labelSmall) } },
                navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } },
                actions = { IconButton(onClick = { load() }, enabled = !loading && !busy) { Icon(Icons.Outlined.Refresh, "Volver a leer WispHub") } },
            ) }, bottomBar = {
                Surface(shadowElevation = 8.dp) { Button(onClick = ::submit, enabled = !loading && !busy && form != null, modifier = Modifier.fillMaxWidth().padding(16.dp)) {
                    Icon(Icons.Outlined.CloudDone, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Verificando en WispHub..." else if (attempted) "Reintentar la misma operacion" else "Guardar y verificar")
                } }
            }) { padding ->
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        listOf("profile" to "Datos", "service" to "Servicio").forEachIndexed { index, option ->
                            SegmentedButton(selected = section == option.first, onClick = { section = option.first; error = null }, shape = SegmentedButtonDefaults.itemShape(index, 2), enabled = !busy) { Text(option.second) }
                        }
                    }
                    if (loading) { LinearProgressIndicator(Modifier.fillMaxWidth()); Text("Consultando WispHub...") }
                    error?.let { Notice(it, true) }
                    if (attempted) Notice("No se recibio una confirmacion final. Reintentar conserva la misma clave y no crea otra operacion.")
                    form?.let { data ->
                        Text(if (section == "profile") "Identidad comercial" else "Datos tecnicos del servicio", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                        val fields = if (section == "profile") externalProfileFields else externalServiceFields
                        fields.forEach { (field, label) ->
                            val keyboard = when (field) { "phone" -> KeyboardType.Phone; "email" -> KeyboardType.Email; "ip" -> KeyboardType.Decimal; else -> KeyboardType.Text }
                            OutlinedTextField(data.getJSONObject(section).optString(field), { update(field, it) }, label = { Text(label) }, enabled = !busy, singleLine = field !in listOf("address", "comments"), minLines = if (field in listOf("address", "comments")) 2 else 1, keyboardOptions = KeyboardOptions(keyboardType = keyboard), modifier = Modifier.fillMaxWidth())
                        }
                        if (section == "service") {
                            OutlinedTextField(wifiPassword, { wifiPassword = it.take(64); key = UUID.randomUUID().toString(); attempted = false; error = null }, label = { Text("Nueva clave WiFi") }, supportingText = { Text(if (data.getJSONObject("service").optBoolean("wifiPasswordConfigured")) "Ya existe una clave. Deja este campo vacio para conservarla." else "Introduce entre 8 y 63 caracteres.") }, visualTransformation = PasswordVisualTransformation(), enabled = !busy, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
                            Notice("Cambiar IP, serial ONU o WiFi puede afectar el servicio. ISP Max relee WispHub antes de mostrar exito.")
                        } else Notice("Estos son datos reales de WispHub. El expediente local permanece disponible para alias y notas internas.")
                    }
                }
            }
        }
    }
}
