package com.ispmax.mobile

import com.ispmax.mobile.ui.PhoneLinks
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionToolsTest {
    @Test fun dominicanPhonesFollowTheWebRules() {
        assertEquals("18095550101", PhoneLinks.international("809-555-0101"))
        assertEquals("18295550101", PhoneLinks.international("1 (829) 555 0101"))
        assertEquals("34612345678", PhoneLinks.international("+34 612 345 678"))
        assertNull(PhoneLinks.international("0000000000"))
        assertNull(PhoneLinks.international(""))
        assertEquals("(809) 555-0101", PhoneLinks.format("18095550101"))
        assertEquals("tel:+18095550101", PhoneLinks.telUri("8095550101"))
    }

    @Test fun whatsappMessageIsEncodedWithoutPlusSigns() {
        val url = PhoneLinks.whatsappUrl("8095550101", "Hola Ana, debe RD$ 1,200.00")!!
        assertTrue(url.startsWith("https://wa.me/18095550101?text=Hola%20Ana%2C%20debe%20RD%24%201%2C200.00"))
        assertNull(PhoneLinks.whatsappUrl("123", "hola"))
    }

    @Test fun linkVerdictExplainsTheProblemInPlainWords() {
        fun result(disabled: Boolean = false, received: Int = 5, inArp: Boolean = true, loss: Double = 0.0, avgDown: Long = 1_000_000, maxDown: Long = 50_000_000) = JSONObject()
            .put("queue", JSONObject().put("disabled", disabled).put("maxDownloadBps", maxDown))
            .put("ping", JSONObject().put("received", received).put("sent", 5).put("lossPercent", loss))
            .put("presence", JSONObject().put("inArp", inArp))
            .put("traffic", JSONObject().put("avgDownloadBps", avgDown))
        assertEquals("error", linkVerdict(result(disabled = true)).first)
        assertEquals("error", linkVerdict(result(received = 0, inArp = false)).first)
        assertEquals("warn", linkVerdict(result(received = 0)).first)
        assertEquals("warn", linkVerdict(result(loss = 40.0)).first)
        assertEquals("warn", linkVerdict(result(avgDown = 48_000_000)).first)
        assertEquals("ok", linkVerdict(result()).first)
        assertEquals("12.5 Mbps", mbps(12_500_000))
    }
}
