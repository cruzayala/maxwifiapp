package com.ispmax.mobile.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable fun IspPrimaryButton(
    onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .975f else 1f, tween(120), label = "pulsacion")
    Button(onClick = onClick, enabled = enabled, interactionSource = interaction,
        shape = RoundedCornerShape(12.dp),
        elevation = ButtonDefaults.buttonElevation(defaultElevation = 3.dp, pressedElevation = 0.dp, disabledElevation = 0.dp),
        modifier = modifier.heightIn(min = 48.dp).graphicsLayer { scaleX = scale; scaleY = scale },
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp), content = content)
}

// Layered vector artwork stays sharp at every font scale and screen density.
@Composable fun ReliefIcon(icon: ImageVector, color: Color = IspGreen, size: Dp = 48.dp) {
    val shape = RoundedCornerShape(12.dp)
    Box(Modifier.size(size), contentAlignment = Alignment.Center) {
        Box(Modifier.matchParentSize().offset(y = 3.dp).background(color.copy(alpha = .23f), shape))
        Box(Modifier.matchParentSize().shadow(3.dp, shape)
            .background(Color.White, shape).background(color.copy(alpha = .09f), shape)
            .border(1.dp, Color.White.copy(alpha = .9f), shape), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = color.copy(alpha = .20f), modifier = Modifier.size(size * .55f).offset(y = 2.dp))
            Icon(icon, null, tint = color, modifier = Modifier.size(size * .55f))
        }
    }
}

@Composable fun NavigationGlyph(icon: ImageVector, label: String, selected: Boolean) {
    val scale by animateFloatAsState(if (selected) 1.10f else 1f, tween(180), label = "seleccion")
    Icon(icon, label, Modifier.size(24.dp).graphicsLayer { scaleX = scale; scaleY = scale })
}
