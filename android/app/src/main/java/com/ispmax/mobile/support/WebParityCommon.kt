package com.ispmax.mobile

import com.ispmax.mobile.data.WEB_PREFIX
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/*
 * Utilidades compartidas por las pantallas "WebParity": usan las mismas rutas que la web
 * (vm.load("web:/...") y vm.web(...)) con la sesion movil y las mismas reglas de rol.
 */

/** Igual que hasAnyRole de la web: admin y super_admin siempre; el resto solo si esta en la lista. */
internal const val WEB_UNCERTAIN = "El servidor no respondio a tiempo. La operacion puede seguir en curso: revisa el resultado antes de repetirla."

internal fun webCan(role: String, vararg allowed: String) = role == "admin" || role == "super_admin" || role in allowed
internal fun webAdmin(role: String) = role == "admin" || role == "super_admin"
internal fun webPath(path: String) = WEB_PREFIX + path

/** Vuelve a leer las pantallas moviles (/mobile/v1) abiertas cuyas rutas empiezan con [prefixes]. */
internal fun MainViewModel.reloadMobile(pages: Map<String, PageState>, vararg prefixes: String) {
    pages.keys.filter { key -> !key.startsWith(WEB_PREFIX) && prefixes.any { key.startsWith(it) } }.forEach { load(it, true) }
}
internal fun webEncode(value: String): String = URLEncoder.encode(value, "UTF-8")
internal fun PageState?.webItems(): List<JSONObject> = this?.body?.optJSONArray("items").objects()
internal fun JSONObject.stringList(key: String): List<String> = optJSONArray(key)?.let { array -> (0 until array.length()).map { array.optString(it) } } ?: emptyList()

/** La web considera fallida una respuesta con `ok:false`, `success:false` o `error`. */
internal fun JSONObject.serverRejected(): String? = when {
    has("error") && !isNull("error") && optString("error").isNotBlank() -> optString("error")
    has("ok") && !optBoolean("ok") -> optString("message").ifBlank { "El servidor no confirmo la operacion" }
    has("success") && !optBoolean("success") -> optString("message").ifBlank { "El servidor no confirmo la operacion" }
    else -> null
}

class PendingWebAction(val title: String, val text: String, val confirmLabel: String, val danger: Boolean, val action: suspend () -> String?)

/** Estado de una accion: ocupado, error, mensaje confirmado y confirmacion previa (como confirm() en la web). */
@Stable
class WebActions internal constructor(private val scope: CoroutineScope) {
    var busy by mutableStateOf(false); private set
    var error by mutableStateOf<String?>(null)
    var message by mutableStateOf<String?>(null)
    var pending by mutableStateOf<PendingWebAction?>(null)

    /** Ejecuta; [action] devuelve el mensaje de exito solo cuando el servidor lo confirma. */
    fun run(action: suspend () -> String?) {
        if (busy) return
        scope.launch {
            busy = true; error = null; message = null
            try { message = action() }
            catch (e: CancellationException) { throw e }
            catch (e: java.io.InterruptedIOException) { error = WEB_UNCERTAIN }
            catch (e: Exception) { error = e.message ?: "No se pudo completar la operacion" }
            finally { busy = false }
        }
    }
    fun confirm(title: String, text: String, confirmLabel: String = "Confirmar", danger: Boolean = false, action: suspend () -> String?) {
        pending = PendingWebAction(title, text, confirmLabel, danger, action)
    }
    fun clear() { error = null; message = null }
}

@Composable internal fun rememberWebActions(): WebActions {
    val scope = rememberCoroutineScope()
    return remember { WebActions(scope) }
}

/** Mensajes y dialogo de confirmacion de [actions]. */
@Composable internal fun WebActionFeedback(actions: WebActions) {
    if (actions.busy) LinearProgressIndicator(Modifier.fillMaxWidth())
    actions.message?.let { WebSuccess(it) }
    actions.error?.let { Notice(it, true) }
    actions.pending?.let { pending ->
        AlertDialog(onDismissRequest = { if (!actions.busy) actions.pending = null },
            icon = { Icon(if (pending.danger) Icons.Outlined.WarningAmber else Icons.Outlined.HelpOutline, null, tint = if (pending.danger) IspRed else IspGreen) },
            title = { Text(pending.title) }, text = { Text(pending.text) },
            confirmButton = {
                Button(onClick = { actions.pending = null; actions.run(pending.action) }, enabled = !actions.busy,
                    colors = if (pending.danger) ButtonDefaults.buttonColors(containerColor = IspRed) else ButtonDefaults.buttonColors()) { Text(pending.confirmLabel) }
            },
            dismissButton = { TextButton(onClick = { actions.pending = null }) { Text("Cancelar") } })
    }
}

@Composable internal fun WebSuccess(text: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Surface(color = IspGreen.copy(alpha = .10f), contentColor = IspGreen, shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxWidth()) {
            Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.CheckCircle, null, Modifier.size(20.dp)); Text(text, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable internal fun WebHeader(title: String, subtitle: String? = null, loading: Boolean = false, refresh: (() -> Unit)? = null, actions: @Composable RowScope.() -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        actions()
        if (refresh != null) IconButton(onClick = refresh, enabled = !loading) { Icon(Icons.Outlined.Refresh, "Actualizar") }
    }
}

@Composable internal fun WebSection(title: String, subtitle: String? = null, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}

@Composable internal fun WebKpi(label: String, value: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurface) {
    OutlinedCard(modifier) {
        Column(Modifier.padding(11.dp)) {
            Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = color, maxLines = 1)
            Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
        }
    }
}

@Composable internal fun WebValue(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable internal fun WebSwitchRow(title: String, subtitle: String? = null, checked: Boolean, enabled: Boolean = true, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (!subtitle.isNullOrBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = checked, onCheckedChange = change, enabled = enabled)
    }
}
