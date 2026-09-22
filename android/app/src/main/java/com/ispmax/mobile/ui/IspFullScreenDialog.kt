package com.ispmax.mobile.ui

import android.graphics.Rect
import android.view.ViewTreeObserver
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.DialogProperties

/**
 * Mensajes de la pantalla abierta (OLT, MikroTik). Los dialogos de pantalla completa tapan la
 * barra de mensajes de la pantalla, asi que tambien la muestran para que los errores se vean.
 */
object ScreenSnackbar {
    var host by mutableStateOf<SnackbarHostState?>(null)

    @Composable
    fun Register(state: SnackbarHostState) {
        DisposableEffect(state) {
            host = state
            onDispose { if (host === state) host = null }
        }
    }
}

/**
 * Dialogo a pantalla completa que termina donde termina el area visible del telefono.
 * La ventana del dialogo mide la pantalla entera aunque empieza bajo la barra de estado,
 * y los botones del pie quedaban detras de la barra de gestos. Se mide el area visible
 * real (sin barras del sistema ni teclado) y el contenido se ajusta a ella.
 */
@Composable
fun IspFullScreenDialog(onDismissRequest: () -> Unit, dismissOnClickOutside: Boolean = true, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onDismissRequest, properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = dismissOnClickOutside)) {
        val view = LocalView.current
        var visibleHeight by remember { mutableIntStateOf(0) }
        DisposableEffect(view) {
            val measure = ViewTreeObserver.OnGlobalLayoutListener {
                val frame = Rect(); view.getWindowVisibleDisplayFrame(frame)
                val origin = IntArray(2); view.getLocationOnScreen(origin)
                val height = frame.bottom - origin[1]
                if (height > 0 && height != visibleHeight) visibleHeight = height
            }
            view.viewTreeObserver.addOnGlobalLayoutListener(measure)
            measure.onGlobalLayout()
            onDispose { view.viewTreeObserver.removeOnGlobalLayoutListener(measure) }
        }
        val size = if (visibleHeight > 0) with(LocalDensity.current) { Modifier.fillMaxWidth().height(visibleHeight.toDp()) } else Modifier.fillMaxSize()
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopStart) {
            Surface(size, color = MaterialTheme.colorScheme.background) {
                Box(Modifier.fillMaxSize()) {
                    content()
                    ScreenSnackbar.host?.let { SnackbarHost(it, Modifier.align(Alignment.BottomCenter).padding(start = 12.dp, end = 12.dp, bottom = 84.dp)) }
                }
            }
        }
    }
}
