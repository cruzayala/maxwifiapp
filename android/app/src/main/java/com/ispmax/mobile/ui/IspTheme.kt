package com.ispmax.mobile.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Modo de color actual; los colores de estado se aclaran en modo oscuro para mantener el contraste. */
internal object IspPalette { @Volatile var dark = false }

// Colores de estado. En modo oscuro usan el tono claro de la misma familia.
val IspGreen: Color get() = if (IspPalette.dark) Color(0xFF6DD5AB) else Color(0xFF0B6B52)
val IspBlue: Color get() = if (IspPalette.dark) Color(0xFF9DC3FF) else Color(0xFF2458B0)
val IspAmber: Color get() = if (IspPalette.dark) Color(0xFFF2BD63) else Color(0xFF9A5B00)
val IspRed: Color get() = if (IspPalette.dark) Color(0xFFFFB3AE) else Color(0xFFB3261E)

// Paleta tonal Material You a partir del verde de la marca (#0B6B52), igual que la web.
private val light = lightColorScheme(
    primary = Color(0xFF0B6B52), onPrimary = Color.White,
    primaryContainer = Color(0xFFA6F2D2), onPrimaryContainer = Color(0xFF002117),
    secondary = Color(0xFF4B635A), onSecondary = Color.White,
    secondaryContainer = Color(0xFFCDE9DC), onSecondaryContainer = Color(0xFF072019),
    tertiary = Color(0xFF3F6374), onTertiary = Color.White,
    tertiaryContainer = Color(0xFFC3E8FC), onTertiaryContainer = Color(0xFF001F2A),
    error = Color(0xFFB3261E), onError = Color.White,
    errorContainer = Color(0xFFF9DEDC), onErrorContainer = Color(0xFF410E0B),
    background = Color(0xFFF4FAF6), onBackground = Color(0xFF161D1A),
    surface = Color(0xFFF4FAF6), onSurface = Color(0xFF161D1A),
    surfaceVariant = Color(0xFFDBE5DE), onSurfaceVariant = Color(0xFF3F4944),
    outline = Color(0xFF6F7973), outlineVariant = Color(0xFFD0DAD3),
    surfaceTint = Color(0xFF0B6B52),
    inverseSurface = Color(0xFF2B322E), inverseOnSurface = Color(0xFFECF2ED), inversePrimary = Color(0xFF8AD6B7),
    surfaceBright = Color(0xFFF4FAF6), surfaceDim = Color(0xFFD5DBD7),
    surfaceContainerLowest = Color.White, surfaceContainerLow = Color(0xFFEEF4F0),
    surfaceContainer = Color(0xFFE8EFEA), surfaceContainerHigh = Color(0xFFE3E9E4),
    surfaceContainerHighest = Color(0xFFDDE4DF),
)

private val dark = darkColorScheme(
    primary = Color(0xFF8AD6B7), onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF00513E), onPrimaryContainer = Color(0xFFA6F2D2),
    secondary = Color(0xFFB2CCC1), onSecondary = Color(0xFF1E352D),
    secondaryContainer = Color(0xFF344C43), onSecondaryContainer = Color(0xFFCDE9DC),
    tertiary = Color(0xFFA7CCE0), onTertiary = Color(0xFF0B3544),
    tertiaryContainer = Color(0xFF264B5C), onTertiaryContainer = Color(0xFFC3E8FC),
    error = Color(0xFFFFB4AB), onError = Color(0xFF690005),
    errorContainer = Color(0xFF8C1D18), onErrorContainer = Color(0xFFF9DEDC),
    background = Color(0xFF0E1512), onBackground = Color(0xFFDDE4DF),
    surface = Color(0xFF0E1512), onSurface = Color(0xFFDDE4DF),
    surfaceVariant = Color(0xFF3F4944), onSurfaceVariant = Color(0xFFBFC9C2),
    outline = Color(0xFF89938D), outlineVariant = Color(0xFF3F4944),
    surfaceTint = Color(0xFF8AD6B7),
    inverseSurface = Color(0xFFDDE4DF), inverseOnSurface = Color(0xFF2B322E), inversePrimary = Color(0xFF0B6B52),
    surfaceBright = Color(0xFF343B37), surfaceDim = Color(0xFF0E1512),
    surfaceContainerLowest = Color(0xFF09100D), surfaceContainerLow = Color(0xFF161D1A),
    surfaceContainer = Color(0xFF1A211E), surfaceContainerHigh = Color(0xFF252B28),
    surfaceContainerHighest = Color(0xFF2F3633),
)

/** Esquinas amplias como en Android 15: tarjetas de 20 dp, hojas y dialogos de 28 dp. */
val IspShapes = Shapes(
    extraSmall = RoundedCornerShape(12.dp), small = RoundedCornerShape(14.dp),
    medium = RoundedCornerShape(20.dp), large = RoundedCornerShape(24.dp), extraLarge = RoundedCornerShape(28.dp),
)

@Composable fun IspTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    IspPalette.dark = darkTheme
    val base = Typography()
    MaterialTheme(colorScheme = if (darkTheme) dark else light, shapes = IspShapes,
        typography = Typography(
            displayLarge = base.displayLarge.copy(letterSpacing = 0.sp),
            displayMedium = base.displayMedium.copy(letterSpacing = 0.sp),
            displaySmall = base.displaySmall.copy(letterSpacing = 0.sp),
            headlineLarge = base.headlineLarge.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            headlineMedium = base.headlineMedium.copy(fontSize = 28.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            titleLarge = base.titleLarge.copy(fontSize = 22.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            titleSmall = base.titleSmall.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            bodyLarge = base.bodyLarge.copy(letterSpacing = 0.sp),
            bodyMedium = base.bodyMedium.copy(letterSpacing = 0.sp),
            bodySmall = base.bodySmall.copy(letterSpacing = 0.sp),
            labelLarge = base.labelLarge.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            labelMedium = base.labelMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
            labelSmall = base.labelSmall.copy(letterSpacing = 0.sp)), content = content)
}
