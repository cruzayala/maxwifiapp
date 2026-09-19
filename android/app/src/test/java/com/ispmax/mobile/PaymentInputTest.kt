package com.ispmax.mobile

import org.junit.Assert.*
import org.junit.Test

class PaymentInputTest {
    @Test fun amountUsesDecimalPrecisionAndRejectsExcess() {
        assertEquals("40.20", paymentAmount("40,20", "100").toPlainString())
        for (value in listOf("-1", "0", "1.234", "1e2", "100.01", "NaN")) assertThrows(IllegalArgumentException::class.java) { paymentAmount(value, "100") }
    }
    @Test fun dateRequiresActualDateAndTime() {
        assertTrue(paymentDate("2026-01-01T12:00").endsWith("Z"))
        for (value in listOf("2026-02-30T12:00", "2026-01-01", "invalid")) assertThrows(IllegalArgumentException::class.java) { paymentDate(value) }
    }
}
