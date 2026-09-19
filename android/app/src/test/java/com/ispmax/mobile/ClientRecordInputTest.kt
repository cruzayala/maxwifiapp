package com.ispmax.mobile

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ClientRecordInputTest {
    @Test fun aliasNeverIncludesNetworkFieldsOrLiteralNull() {
        val body = clientRecordRequest("alias", JSONObject().put("aliasNombre", " Ana ").put("aliasTelefono", JSONObject.NULL).put("ip", "192.0.2.1"), false)
        assertEquals("Ana", body.getString("aliasNombre"))
        assertTrue(body.isNull("aliasTelefono"))
        assertFalse(body.has("ip"))
    }
    @Test fun promiseRequiresRealDateAmountAndClient() {
        val data = JSONObject().put("idServicio", 301).put("amount", "450,50").put("promisedDate", "2026-09-10").put("status", "paid")
        val body = clientRecordRequest("promise", data, true)
        assertEquals("450.50", body.getString("amount"))
        assertFalse(body.has("status"))
        for (amount in listOf("0", "-1", "1.234", "1e5", "NaN")) {
            assertThrows(IllegalArgumentException::class.java) { clientRecordRequest("promise", JSONObject(data.toString()).put("amount", amount), true) }
        }
        assertThrows(IllegalArgumentException::class.java) { clientRecordRequest("promise", JSONObject(data.toString()).put("promisedDate", "2026-02-30"), true) }
        assertThrows(IllegalArgumentException::class.java) { clientRecordRequest("promise", JSONObject(data.toString()).put("idServicio", 0), true) }
    }
}
