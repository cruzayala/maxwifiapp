package com.ispmax.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ExpenseInputTest {
    private fun form() = JSONObject().put("category", "otros").put("description", "Transporte").put("amount", "125,50").put("expenseDate", "2026-09-04")
    @Test fun decimalCommaAndOptionalFieldsAreNormalized() {
        val result = expenseRequest(form())
        assertEquals("125.50", result.getString("amount"))
        assertTrue(result.isNull("clientIdServicio"))
        assertFalse(result.has("key"))
    }
    @Test fun rejectsInvalidMoneyAndDates() {
        for (amount in listOf("", "-1", "1.005", "NaN", "1000000000001")) assertThrows(IllegalArgumentException::class.java) { expenseRequest(form().put("amount", amount)) }
        assertThrows(IllegalArgumentException::class.java) { expenseRequest(form().put("expenseDate", "2026-02-30")) }
    }
}
