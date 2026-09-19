package com.ispmax.mobile.onu

data class OnuFingerprint(val family: String, val model: String?, val authenticated: Boolean = false, val serial: String? = null)

fun fingerprint(html: String): OnuFingerprint {
    val content = html.take(262144)
    val model = Regex("\\b(EG8141A5|F670L)\\b", RegexOption.IGNORE_CASE).find(content)?.value?.uppercase()
    val family = when {
        content.contains("txt_Username") && content.contains("loginbutton") -> "Huawei / Novatech"
        content.contains("Frm_Username") && content.contains("Frm_Password") -> "ZTE"
        else -> "Panel HTTP no identificado"
    }
    // A login fingerprint is not authenticated inventory or a verified GPON serial.
    return OnuFingerprint(family, model)
}

fun ipv4(value: String): Long? {
    val octets = value.split('.')
    if (octets.size != 4 || octets.any { !it.matches(Regex("0|[1-9][0-9]{0,2}")) || it.toInt() !in 0..255 }) return null
    return octets.fold(0L) { ip, octet -> (ip shl 8) or octet.toLong() }
}
fun isLocalTarget(target: String, source: String, prefix: Int): Boolean {
    val ip = ipv4(target) ?: return false
    val local = ipv4(source) ?: return false
    if (prefix !in 1..32) return false
    val private = (ip ushr 24 == 10L) || (ip ushr 20 == 0xAC1L) || (ip ushr 16 == 0xC0A8L) || (ip ushr 16 == 0xA9FEL)
    val mask = (0xFFFFFFFFL shl (32 - prefix)) and 0xFFFFFFFFL
    val hostMask = mask xor 0xFFFFFFFFL
    val host = ip and hostMask
    return private && ip != local && (ip and mask) == (local and mask) && host != hostMask && host != 0L
}
