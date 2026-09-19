package com.ispmax.mobile
import com.ispmax.mobile.ui.IspPrimaryButton as Button

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable fun MobileSessionsScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    LaunchedEffect(Unit) { vm.load("/sessions", true) }
    val state = pages["/sessions"] ?: PageState(loading = true)
    var filter by rememberSaveable { mutableStateOf("active") }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val rows = state.body?.optJSONArray("items").objects().filter { filter.isBlank() || it.optString("status") == filter }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Sesiones moviles", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            IconButton(onClick = { vm.load("/sessions", true) }, enabled = !state.loading && !busy) { Icon(Icons.Outlined.Refresh, "Actualizar sesiones") }
        }
        OptionField("Estado", filter, linkedMapOf("active" to "Activas", "revoked" to "Revocadas", "expired" to "Vencidas", "" to "Todas")) { filter = it }
        ReadStatus(state) { vm.load("/sessions", true) }
        Text("${rows.size} visibles · Ultimas 100 sesiones", style = MaterialTheme.typography.labelMedium)
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("Sin sesiones para este filtro") }
            items(rows, key = { it.getString("id") }) { row ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(row.text("deviceName"), style = MaterialTheme.typography.titleMedium)
                        Text(row.text("username"))
                        Text(if (row.optBoolean("current")) "Este dispositivo" else "Creada: ${row.text("createdAt").take(10)}", style = MaterialTheme.typography.bodySmall)
                        Text("Ultima renovacion: ${row.text("lastSeenAt")}", style = MaterialTheme.typography.bodySmall)
                        Text("Vence: ${row.text("expiresAt").take(10)}", style = MaterialTheme.typography.bodySmall)
                        if (row.optString("status") == "active" && row.optBoolean("canRevoke")) TextButton(onClick = { selected = row.toString(); error = null }, enabled = !busy && state.error == null) {
                            Icon(Icons.Outlined.PhonelinkErase, null); Spacer(Modifier.width(8.dp)); Text(if (row.optBoolean("current")) "Cerrar esta sesion" else "Revocar acceso")
                        }
                    }
                }
            }
        }
    }
    selected?.let { json -> val row = JSONObject(json)
        AlertDialog(onDismissRequest = { if (!busy) selected = null }, title = { Text("Revocar sesion") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${row.text("username")} · ${row.text("deviceName")}")
                Text("Este acceso dejara de funcionar en el servidor. Para volver a entrar se necesitara iniciar sesion.")
                error?.let { Notice(it, true) }
            }
        }, confirmButton = { Button(enabled = !busy, onClick = { scope.launch {
            busy = true; error = null
            try { if (row.optBoolean("current")) vm.logout() else vm.revokeSession(row.getString("id")); selected = null }
            catch (e: Exception) { error = e.message } finally { busy = false }
        } }) { Icon(Icons.Outlined.PhonelinkErase, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(if (busy) "Revocando..." else "Revocar sesion") } }, dismissButton = { TextButton(onClick = { selected = null }, enabled = !busy) { Text("Cancelar") } })
    }
}
