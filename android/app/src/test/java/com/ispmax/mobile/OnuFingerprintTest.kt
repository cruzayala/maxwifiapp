package com.ispmax.mobile

import com.ispmax.mobile.onu.*
import org.junit.Assert.*
import org.junit.Test

class OnuFingerprintTest {
    @Test fun loginIsNotAuthenticatedInventory() {
        val device = fingerprint("EG8141A5 txt_Username loginbutton")
        assertEquals("Huawei / Novatech", device.family)
        assertEquals("EG8141A5", device.model)
        assertFalse(device.authenticated)
        assertNull(device.serial)
        assertEquals("ZTE", fingerprint("Frm_Username Frm_Password F670L").family)
    }
    @Test fun neverInventModelFromGenericPage() { assertNull(fingerprint("<title>Router</title>").model) }
    @Test fun onlyAllowsExplicitPrivateSameSubnetTargets() {
        assertTrue(isLocalTarget("192.168.1.1", "192.168.1.100", 24))
        assertFalse(isLocalTarget("192.168.16.1", "192.168.1.100", 24))
        assertFalse(isLocalTarget("8.8.8.8", "8.8.8.9", 24))
        assertFalse(isLocalTarget("192.168.1.255", "192.168.1.100", 24))
        assertFalse(isLocalTarget("192.168.1.100", "192.168.1.100", 24))
        assertNull(ipv4("192.168.1.1\r\nHost:evil"))
    }
}
