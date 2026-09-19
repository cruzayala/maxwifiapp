package com.ispmax.mobile.location

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import kotlin.coroutines.resume

fun hasLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

suspend fun captureCurrentLocation(context: Context): Location = withTimeout(20_000) {
    suspendCancellableCoroutine { continuation ->
        if (!hasLocationPermission(context)) {
            continuation.cancel(SecurityException("Permiso de ubicacion requerido"))
            return@suspendCancellableCoroutine
        }
        val manager = context.getSystemService(LocationManager::class.java)
        val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            .filter { runCatching { manager.isProviderEnabled(it) }.getOrDefault(false) }
        if (providers.isEmpty()) {
            continuation.cancel(IllegalStateException("Activa la ubicacion del telefono"))
            return@suspendCancellableCoroutine
        }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (continuation.isActive) continuation.resume(location)
                manager.removeUpdates(this)
            }
        }
        continuation.invokeOnCancellation { manager.removeUpdates(listener) }
        try {
            providers.forEach { manager.requestLocationUpdates(it, 0L, 0f, listener, Looper.getMainLooper()) }
        } catch (error: SecurityException) {
            continuation.cancel(error)
        }
    }
}
