package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspGreen
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Mismo orden de roles que la web (auth.service hasRole) y el servidor (ROLE_HIERARCHY). */
internal fun tr069RoleLevel(role: String?) = when (role) { "super_admin" -> 4; "admin" -> 3; "tecnico", "cobranza" -> 2; "viewer" -> 1; else -> 0 }
internal fun tr069HasRole(role: String?, required: String) = tr069RoleLevel(role) >= when (required) { "super_admin" -> 4; "admin" -> 3; "tecnico", "cobranza" -> 2; "viewer" -> 1; else -> 99 }
internal fun tr069Encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

private val tr069Zone: ZoneId = runCatching { ZoneId.of("America/Santo_Domingo") }.getOrDefault(ZoneId.systemDefault())
private fun parseInstant(value: String?): Instant? = value?.takeIf { it.isNotBlank() && it != "null" }?.let { runCatching { Instant.parse(it) }.getOrNull() }

/** Fecha corta como la web (es-DO, dateStyle short + timeStyle short). */
internal fun tr069Date(value: String?, fallback: String = "--"): String =
    parseInstant(value)?.let { DateTimeFormatter.ofPattern("dd/MM/yy HH:mm", Locale("es", "DO")).withZone(tr069Zone).format(it) } ?: fallback
internal fun tr069DateSeconds(value: String?, fallback: String = "Sin registro"): String =
    parseInstant(value)?.let { DateTimeFormatter.ofPattern("dd/MM/yy HH:mm:ss", Locale("es", "DO")).withZone(tr069Zone).format(it) } ?: fallback
internal fun tr069Time(value: String?): String =
    parseInstant(value)?.let { DateTimeFormatter.ofPattern("HH:mm:ss", Locale("es", "DO")).withZone(tr069Zone).format(it) } ?: "--:--"
internal fun tr069EpochMillis(value: String?): Long? = parseInstant(value)?.toEpochMilli()

/** Texto opcional: null si falta o es JSON null. */
internal fun JSONObject.trText(key: String): String? = if (!has(key) || isNull(key)) null else optString(key).takeIf { it.isNotBlank() }
internal fun JSONObject.trPath(dotted: String): Any? {
    var value: Any? = this
    for (key in dotted.split('.')) {
        value = when (value) {
            is JSONObject -> if (value.isNull(key)) null else value.opt(key)
            is JSONArray -> key.toIntOrNull()?.let { if (it in 0 until value.length()) value.opt(it) else null }
            else -> null
        }
        if (value == null || value == JSONObject.NULL) return null
    }
    return value
}
internal fun JSONObject.trPathText(dotted: String, fallback: String = "--"): String =
    trPath(dotted)?.toString()?.takeIf { it.isNotBlank() && it != "null" } ?: fallback
internal fun JSONArray?.trStrings(): List<String> = if (this == null) emptyList() else (0 until length()).mapNotNull { if (isNull(it)) null else opt(it)?.toString() }

@Composable internal fun Tr069Banner(text: String, error: Boolean, onDismiss: () -> Unit) {
    val color = if (error) MaterialTheme.colorScheme.errorContainer else IspGreen.copy(alpha = .12f)
    Row(Modifier.fillMaxWidth().background(color, MaterialTheme.shapes.small).padding(start = 12.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.CheckCircle, null, tint = if (error) MaterialTheme.colorScheme.error else IspGreen, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(8.dp))
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Cerrar", Modifier.size(18.dp)) }
    }
}

@Composable internal fun Tr069Fact(label: String, value: String, modifier: Modifier = Modifier, mono: Boolean = false) {
    Column(modifier.padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, fontFamily = if (mono) FontFamily.Monospace else null)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun Tr069Dropdown(label: String, options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { if (enabled) open = it }, modifier = modifier) {
        OutlinedTextField(
            value = options.firstOrNull { it.first == selected }?.second ?: selected, onValueChange = {}, readOnly = true, enabled = enabled,
            label = { Text(label) }, trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(open) }, singleLine = true,
            modifier = Modifier.menuAnchor(MenuAnchorType.PrimaryNotEditable).fillMaxWidth(),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (value, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { onSelect(value); open = false }) }
        }
    }
}

@Composable internal fun Tr069Check(label: String, checked: Boolean, onChange: (Boolean) -> Unit, enabled: Boolean = true) {
    Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(checked, onChange, enabled = enabled); Text(label, style = MaterialTheme.typography.bodyMedium) }
}

/** Confirmacion simple (equivale a window.confirm de la web). */
@Composable internal fun Tr069Confirm(title: String, text: String, confirmLabel: String, danger: Boolean = false, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(onDismissRequest = onDismiss, title = { Text(title) }, text = { Text(text) },
        confirmButton = { Button(onClick = { onDismiss(); onConfirm() }, colors = if (danger) ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error) else ButtonDefaults.buttonColors()) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancelar") } })
}
