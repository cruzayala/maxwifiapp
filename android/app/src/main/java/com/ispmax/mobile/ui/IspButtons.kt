package com.ispmax.mobile

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ButtonElevation
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Button as M3Button
import androidx.compose.material3.FilledTonalButton as M3FilledTonalButton
import androidx.compose.material3.OutlinedButton as M3OutlinedButton
import androidx.compose.material3.TextButton as M3TextButton

/*
 * Botones al estilo Android 15 para toda la app. Estas funciones tienen el mismo nombre y
 * parametros que las de Material 3 y viven en el paquete de las pantallas, asi que Kotlin
 * las prefiere sobre `androidx.compose.material3.*`: cada boton existente toma la forma de
 * pildora, 48 dp de alto para el dedo y un rebote suave al presionarlo.
 */

private val Padding = PaddingValues(horizontal = 22.dp, vertical = 12.dp)
private val TextPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)

@Composable private fun pressScale(source: MutableInteractionSource): Modifier {
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.95f else 1f, spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessMedium), label = "boton")
    return Modifier.graphicsLayer { scaleX = scale; scaleY = scale }
}

@Composable fun Button(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.shape, colors: ButtonColors = ButtonDefaults.buttonColors(),
    elevation: ButtonElevation? = ButtonDefaults.buttonElevation(defaultElevation = 1.dp, pressedElevation = 0.dp),
    border: BorderStroke? = null, contentPadding: PaddingValues = Padding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    M3Button(onClick, modifier.heightIn(min = 48.dp).then(pressScale(source)), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable fun FilledTonalButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.filledTonalShape, colors: ButtonColors = ButtonDefaults.filledTonalButtonColors(),
    elevation: ButtonElevation? = ButtonDefaults.filledTonalButtonElevation(),
    border: BorderStroke? = null, contentPadding: PaddingValues = Padding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    M3FilledTonalButton(onClick, modifier.heightIn(min = 48.dp).then(pressScale(source)), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable fun OutlinedButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.outlinedShape, colors: ButtonColors = ButtonDefaults.outlinedButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = ButtonDefaults.outlinedButtonBorder(enabled),
    contentPadding: PaddingValues = Padding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    M3OutlinedButton(onClick, modifier.heightIn(min = 48.dp).then(pressScale(source)), enabled, shape, colors, elevation, border, contentPadding, source, content)
}

@Composable fun TextButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    shape: Shape = ButtonDefaults.textShape, colors: ButtonColors = ButtonDefaults.textButtonColors(),
    elevation: ButtonElevation? = null, border: BorderStroke? = null, contentPadding: PaddingValues = TextPadding,
    interactionSource: MutableInteractionSource? = null, content: @Composable RowScope.() -> Unit,
) {
    val source = interactionSource ?: remember { MutableInteractionSource() }
    M3TextButton(onClick, modifier.heightIn(min = 44.dp).then(pressScale(source)), enabled, shape, colors, elevation, border, contentPadding, source, content)
}
