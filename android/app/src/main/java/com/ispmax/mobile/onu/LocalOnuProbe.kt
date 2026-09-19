package com.ispmax.mobile.onu

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Inet4Address

data class LocalLink(val network: Network, val name: String, val addresses: List<Pair<String, Int>>, val gateway: String?)
data class ProbeResult(val target: String, val httpStatus: String, val identity: OnuFingerprint)
class LocalOnuProbe(context: Context) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    fun links(): List<LocalLink> = connectivity.allNetworks.mapNotNull { network ->
        val capabilities = connectivity.getNetworkCapabilities(network) ?: return@mapNotNull null
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) return@mapNotNull null
        val properties = connectivity.getLinkProperties(network) ?: return@mapNotNull null
        val addresses = properties.linkAddresses.filter { it.address is Inet4Address }.map { it.address.hostAddress!! to it.prefixLength }
        LocalLink(network, properties.interfaceName ?: "LAN", addresses, properties.routes.firstOrNull { it.isDefaultRoute && it.gateway is Inet4Address }?.gateway?.hostAddress)
    }
    suspend fun probe(link: LocalLink, target: String): ProbeResult = withContext(Dispatchers.IO) {
        require(link.addresses.any { isLocalTarget(target, it.first, it.second) }) { "La IP debe estar en la misma subred local del telefono. Revisa la configuracion de WiFi o Ethernet." }
        link.network.socketFactory.createSocket().use { socket ->
            socket.soTimeout = 3500
            socket.connect(InetSocketAddress(target, 80), 3500)
            socket.getOutputStream().write("GET / HTTP/1.0\r\nHost: $target\r\nAccept: text/html\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII))
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            val deadline = System.nanoTime() + 8_000_000_000L
            while (output.size() < 262144 && System.nanoTime() < deadline) {
                val count = socket.getInputStream().read(buffer, 0, minOf(buffer.size, 262144 - output.size()))
                if (count < 0) break
                output.write(buffer, 0, count)
            }
            val raw = output.toString("UTF-8")
            require(raw.startsWith("HTTP/")) { "La respuesta no corresponde a un panel HTTP" }
            ProbeResult(target, raw.lineSequence().first().take(80), fingerprint(raw.substringAfter("\r\n\r\n", "")))
        }
    }
}
