package com.ispmax.mobile.ui

import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

val IspGreen = Color(0xFF007A56)
val IspBlue = Color(0xFF2464BD)
val IspAmber = Color(0xFFA55E00)
val IspRed = Color(0xFFBA3544)
private val colors = lightColorScheme(primary = IspGreen, onPrimary = Color.White,
    primaryContainer = Color(0xFFDDF3E9), onPrimaryContainer = Color(0xFF00533B),
    secondary = IspBlue, secondaryContainer = Color(0xFFE5EEFC),
    background = Color(0xFFF5F7F8), surface = Color.White,
    surfaceContainer = Color(0xFFF0F3F5), surfaceVariant = Color(0xFFF0F3F5),
    onSurface = Color(0xFF18282D), onSurfaceVariant = Color(0xFF52646B),
    outlineVariant = Color(0xFFDCE4E7), error = IspRed)

@Composable fun IspTheme(content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(colorScheme = colors,
        shapes = Shapes(extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(6.dp),
            medium = RoundedCornerShape(8.dp), large = RoundedCornerShape(8.dp)),
        typography = Typography(
            displayLarge = base.displayLarge.copy(letterSpacing = 0.sp),
            displayMedium = base.displayMedium.copy(letterSpacing = 0.sp),
            displaySmall = base.displaySmall.copy(letterSpacing = 0.sp),
            headlineLarge = base.headlineLarge.copy(letterSpacing = 0.sp),
            headlineMedium = base.headlineMedium.copy(fontSize = 26.sp, letterSpacing = 0.sp),
            headlineSmall = base.headlineSmall.copy(letterSpacing = 0.sp),
            titleLarge = base.titleLarge.copy(fontSize = 22.sp, letterSpacing = 0.sp),
            titleMedium = base.titleMedium.copy(letterSpacing = 0.sp),
            titleSmall = base.titleSmall.copy(letterSpacing = 0.sp),
            bodyLarge = base.bodyLarge.copy(letterSpacing = 0.sp),
            bodyMedium = base.bodyMedium.copy(letterSpacing = 0.sp),
            bodySmall = base.bodySmall.copy(letterSpacing = 0.sp),
            labelMedium = base.labelMedium.copy(letterSpacing = 0.sp),
            labelSmall = base.labelSmall.copy(letterSpacing = 0.sp),
            labelLarge = base.labelLarge.copy(letterSpacing = 0.sp)), content = content)
}
