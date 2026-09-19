package com.ispmax.mobile.data

data class Ipv4Cidr(val network: Long, val broadcast: Long, val prefix: Int) {
    val canonical: String get() = "${ipv4(network)}/$prefix"
    val addressCount: Long get() = broadcast - network + 1
    fun contains(address: Long) = address in network..broadcast
}

object IpRangeRules {
    const val MAX_RANGES = 16
    const val MAX_COMBINED_ADDRESSES = 65_536L

    fun defaultRange() = LocalIpRange(
        name = "Fibra principal",
        cidr = "192.168.16.0/24",
        vlan = 101,
        gateway = "192.168.16.1",
        dns = "8.8.8.8",
        usableStart = "192.168.16.2",
        usableEnd = "192.168.16.254",
        exclusions = "192.168.16.1",
        priority = 10,
        active = true
    )

    fun normalize(candidate: LocalIpRange, existing: List<LocalIpRange>): LocalIpRange {
        require(candidate.name.trim().length in 2..60) { "El nombre debe tener entre 2 y 60 caracteres" }
        val parsed = parseCidr(candidate.cidr)
        require(parsed.prefix in 16..30) { "El rango debe estar entre /16 y /30" }
        val gateway = candidate.gateway.trim().takeIf { it.isNotEmpty() }?.let(::parseIpv4)
        require(gateway == null || parsed.contains(gateway)) { "El gateway debe pertenecer al rango" }

        val defaultStart = parsed.network + 1
        val defaultEnd = parsed.broadcast - 1
        val start = candidate.usableStart.trim().takeIf { it.isNotEmpty() }?.let(::parseIpv4) ?: defaultStart
        val end = candidate.usableEnd.trim().takeIf { it.isNotEmpty() }?.let(::parseIpv4) ?: defaultEnd
        require(parsed.contains(start) && parsed.contains(end) && start <= end) { "El intervalo utilizable no pertenece al rango" }
        require(start > parsed.network && end < parsed.broadcast) { "No se puede asignar la direccion de red ni broadcast" }

        val dns = candidate.dns.split(',', ';', ' ', '\n').map(String::trim).filter(String::isNotEmpty)
        require(dns.isNotEmpty() && dns.size <= 3) { "Indica entre uno y tres servidores DNS" }
        dns.forEach(::parseIpv4)

        val exclusions = candidate.exclusions.split(',', ';', '\n').map(String::trim).filter(String::isNotEmpty)
        exclusions.forEach { token ->
            val bounds = token.split('-', limit = 2).map(String::trim)
            val first = parseIpv4(bounds[0])
            val last = if (bounds.size == 2) parseIpv4(bounds[1]) else first
            require(first <= last && parsed.contains(first) && parsed.contains(last)) { "La exclusion $token no pertenece al rango" }
        }

        val normalized = candidate.copy(
            name = candidate.name.trim(),
            cidr = parsed.canonical,
            gateway = gateway?.let(::ipv4).orEmpty(),
            dns = dns.joinToString(", ") { ipv4(parseIpv4(it)) },
            usableStart = ipv4(start),
            usableEnd = ipv4(end),
            exclusions = exclusions.joinToString(", "),
            priority = candidate.priority.coerceIn(1, 999),
            updatedAt = System.currentTimeMillis()
        )

        val combined = existing.filter { it.id != normalized.id } + normalized
        require(combined.size <= MAX_RANGES) { "Solo se permiten $MAX_RANGES segmentos" }
        require(combined.map { parseCidr(it.cidr).canonical }.distinct().size == combined.size) { "Ya existe un segmento con ese CIDR" }
        require(combined.any { it.active }) { "Debe existir al menos un segmento activo" }
        val active = combined.filter { it.active }
        require(active.sumOf { parseCidr(it.cidr).addressCount } <= MAX_COMBINED_ADDRESSES) { "Los segmentos activos superan 65,536 direcciones" }
        active.forEachIndexed { index, left ->
            val a = parseCidr(left.cidr)
            active.drop(index + 1).forEach { right ->
                val b = parseCidr(right.cidr)
                require(a.broadcast < b.network || b.broadcast < a.network) { "Los segmentos ${left.cidr} y ${right.cidr} se solapan" }
            }
        }
        return normalized
    }

    fun isAssignable(range: LocalIpRange, value: String): Boolean = runCatching {
        val address = parseIpv4(value)
        val cidr = parseCidr(range.cidr)
        val start = parseIpv4(range.usableStart)
        val end = parseIpv4(range.usableEnd)
        if (!cidr.contains(address) || address !in start..end) return false
        val excluded = range.exclusions.split(',', ';', '\n').map(String::trim).filter(String::isNotEmpty).any { token ->
            val bounds = token.split('-', limit = 2).map(String::trim)
            val first = parseIpv4(bounds[0])
            val last = if (bounds.size == 2) parseIpv4(bounds[1]) else first
            address in first..last
        }
        !excluded
    }.getOrDefault(false)

    fun parseCidr(value: String): Ipv4Cidr {
        val parts = value.trim().split('/')
        require(parts.size == 2) { "CIDR invalido" }
        val address = parseIpv4(parts[0])
        val prefix = parts[1].toIntOrNull() ?: throw IllegalArgumentException("Prefijo CIDR invalido")
        require(prefix in 0..32) { "Prefijo CIDR invalido" }
        val mask = if (prefix == 0) 0L else (0xFFFF_FFFFL shl (32 - prefix)) and 0xFFFF_FFFFL
        val network = address and mask
        return Ipv4Cidr(network, network or (mask xor 0xFFFF_FFFFL), prefix)
    }

    fun parseIpv4(value: String): Long {
        val parts = value.trim().split('.')
        require(parts.size == 4) { "Direccion IPv4 invalida: $value" }
        return parts.fold(0L) { acc, item ->
            val octet = item.toIntOrNull()
            require(octet != null && octet in 0..255 && item == octet.toString()) { "Direccion IPv4 invalida: $value" }
            (acc shl 8) or octet.toLong()
        }
    }
}

private fun ipv4(value: Long) = listOf(24, 16, 8, 0).joinToString(".") { ((value shr it) and 255).toString() }
