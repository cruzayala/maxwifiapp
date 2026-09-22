package com.ispmax.mobile.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Boton principal: pildora alta de 52 dp con un rebote suave al presionarla. */
@Composable fun IspPrimaryButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .95f else 1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium), label = "pulsacion")
    Button(onClick = onClick, enabled = enabled, interactionSource = interaction,
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 1.dp, pressedElevation = 0.dp, disabledElevation = 0.dp),
        modifier = modifier.heightIn(min = 52.dp).graphicsLayer { scaleX = scale; scaleY = scale },
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 14.dp), content = content)
}

/** Icono en un contenedor tonal, como los de Ajustes en Android 15. */
@Composable fun ReliefIcon(icon: ImageVector, color: Color = IspGreen, size: Dp = 48.dp) {
    Box(Modifier.size(size).background(color.copy(alpha = if (IspPalette.dark) .20f else .12f), RoundedCornerShape(size * .36f)), contentAlignment = Alignment.Center) {
        Icon(icon, null, tint = color, modifier = Modifier.size(size * .52f))
    }
}

@Composable fun NavigationGlyph(icon: ImageVector, label: String, selected: Boolean) {
    val scale by animateFloatAsState(if (selected) 1.08f else 1f, tween(180), label = "seleccion")
    Icon(icon, label, Modifier.size(24.dp).graphicsLayer { scaleX = scale; scaleY = scale })
}

/** Superficie de tarjetas y filas: blanca en modo claro, un tono mas clara que el fondo en modo oscuro. */
@Composable fun ispCardColor(): Color = if (IspPalette.dark) MaterialTheme.colorScheme.surfaceContainer else MaterialTheme.colorScheme.surfaceContainerLowest

/** Fondos suaves de estado que funcionan en modo claro y oscuro. */
object IspTint {
    val warning: Color get() = IspAmber.copy(alpha = if (IspPalette.dark) .16f else .10f)
    val success: Color get() = IspGreen.copy(alpha = if (IspPalette.dark) .16f else .09f)
    val danger: Color get() = IspRed.copy(alpha = if (IspPalette.dark) .16f else .08f)
}
