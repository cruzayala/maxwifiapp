package com.ispmax.mobile

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CardElevation
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.dp
import androidx.compose.material3.OutlinedCard as M3OutlinedCard

/*
 * Tarjetas al estilo Android 15: superficie clara que se despega del fondo tonal, esquinas
 * de 20 dp y un borde muy suave. Mismo nombre y parametros que Material 3 (ver IspButtons.kt).
 */

@Composable private fun cardColors() = CardDefaults.outlinedCardColors(containerColor = com.ispmax.mobile.ui.ispCardColor())
@Composable private fun cardBorder() = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.6f))

@Composable fun OutlinedCard(
    modifier: Modifier = Modifier, shape: Shape = CardDefaults.outlinedShape, colors: CardColors = cardColors(),
    elevation: CardElevation = CardDefaults.outlinedCardElevation(), border: BorderStroke = cardBorder(),
    content: @Composable ColumnScope.() -> Unit,
) = M3OutlinedCard(modifier, shape, colors, elevation, border, content)

@Composable fun OutlinedCard(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, shape: Shape = CardDefaults.outlinedShape,
    colors: CardColors = cardColors(), elevation: CardElevation = CardDefaults.outlinedCardElevation(),
    border: BorderStroke = cardBorder(), interactionSource: MutableInteractionSource? = null,
    content: @Composable ColumnScope.() -> Unit,
) = M3OutlinedCard(onClick, modifier, enabled, shape, colors, elevation, border, interactionSource, content)
