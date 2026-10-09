package com.ispmax.mobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.SystemUpdate
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.ispmax.mobile.ui.IspPrimaryButton
import java.io.File

/**
 * Aviso de version nueva en todas las pantallas. Descarga la APK publicada en el servidor,
 * comprueba su SHA-256 y abre el instalador de Android, que la instala encima sin perder
 * la sesion ni los datos (misma firma).
 */
@Composable
internal fun AppUpdateBanner(vm: MainViewModel) {
    val state by vm.update.collectAsStateWithLifecycle()
    val update = state.available ?: return
    val downloaded = state.file
    if (state.dismissed && downloaded == null && !state.downloading) return
    val context = LocalContext.current
    Surface(
        color = MaterialTheme.colorScheme.secondaryContainer,
        shape = MaterialTheme.shapes.large,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.SystemUpdate, null)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text("Nueva version ${update.version}", fontWeight = FontWeight.SemiBold)
                    Text(
                        when {
                            downloaded != null -> "Descargada. Toca Instalar para actualizar."
                            state.downloading -> "Descargando… ${(state.progress * 100).toInt()} %"
                            else -> "${(update.sizeBytes / 1_048_576).coerceAtLeast(1)} MB · se instala encima, sin perder la sesion"
                        },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
                if (!state.downloading) IconButton(onClick = vm::dismissUpdate) { Icon(Icons.Outlined.Close, "Ahora no") }
            }
            update.notes.take(4).forEach { Text("• $it", style = MaterialTheme.typography.bodySmall) }
            if (state.downloading) LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth())
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            when {
                downloaded != null -> IspPrimaryButton(onClick = { installApk(context, downloaded) }) { Text("Instalar") }
                !state.downloading -> IspPrimaryButton(onClick = vm::downloadUpdate) { Text(if (state.error != null) "Reintentar" else "Descargar e instalar") }
            }
        }
    }
}

/** La primera vez Android pide permitir que ISP Max instale su actualizacion; luego confirma la instalacion. */
internal fun installApk(context: Context, file: File) {
    if (!context.packageManager.canRequestPackageInstalls()) {
        context.startActivity(
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        return
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
    context.startActivity(
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
