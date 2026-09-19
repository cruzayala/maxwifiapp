package com.ispmax.mobile

import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.ZoneId

internal fun paymentAmount(input: String, balance: String): BigDecimal {
    val normalized = input.trim().replace(',', '.')
    require(Regex("\\d+(\\.\\d{1,2})?").matches(normalized)) { "Introduce un importe con hasta dos decimales" }
    val amount = normalized.toBigDecimal()
    require(amount > BigDecimal.ZERO && amount <= balance.toBigDecimal() && amount <= BigDecimal("1000000000")) { "El importe debe ser positivo y no superar el saldo" }
    return amount
}
internal fun paymentDate(input: String): String = try {
    LocalDateTime.parse(input).atZone(ZoneId.systemDefault()).toInstant().toString()
} catch (_: Exception) { throw IllegalArgumentException("Fecha invalida: AAAA-MM-DDTHH:MM") }
