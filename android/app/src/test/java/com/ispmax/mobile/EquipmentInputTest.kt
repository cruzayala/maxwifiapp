package com.ispmax.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EquipmentInputTest {
    private fun form(op: String, data: String) = JSONObject().put("operation", op).put("data", JSONObject(data))
    @Test fun decimalsNullFieldsAndAllowlist() {
        val result = equipmentRequest(form("create", """{"typeId":1,"unitCost":"125,50","serialNumber":null,"macAddress":null,"model":"ONU","purchaseId":42,"password":"not-sent"}"""))
        assertEquals("125.50", result.getString("unitCost"))
        assertTrue(result.isNull("serialNumber")); assertTrue(result.isNull("macAddress"))
        assertFalse(result.has("purchaseId")); assertFalse(result.has("password"))
    }
    @Test fun invalidCostMacAndMissingTypeAreRejected() {
        for (data in listOf("""{"typeId":1,"unitCost":"-1"}""", """{"typeId":1,"unitCost":"1.001"}""", """{"typeId":1,"macAddress":"bad"}""", "{}")) {
            assertTrue(runCatching { equipmentRequest(form("create", data)) }.isFailure)
        }
    }
    @Test fun assignmentAndReturnCannotCarryArbitraryWrites() {
        val assigned = equipmentRequest(form("assign", """{"clientId":301,"installNotes":"prueba","status":"retired"}"""))
        assertEquals(301, assigned.getInt("clientId")); assertFalse(assigned.has("status"))
        assertEquals(0, equipmentRequest(form("return", """{"status":"lost"}""")).length())
        assertTrue(runCatching { equipmentRequest(form("assign", "{}")) }.isFailure)
    }
}
