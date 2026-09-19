package com.ispmax.mobile

import com.ispmax.mobile.data.serverUrl
import com.ispmax.mobile.data.DEFAULT_SERVER
import org.junit.Assert.*
import org.junit.Test

class ServerUrlTest {
    @Test fun releaseAcceptsOnlyProductionRailway() {
        assertEquals(DEFAULT_SERVER, serverUrl("$DEFAULT_SERVER/", false))
        assertTrue(runCatching { serverUrl("https://isp.example", false) }.isFailure)
    }
    @Test fun rejectsCleartextRelease() { assertTrue(runCatching { serverUrl("http://10.0.2.2:7415", false) }.isFailure) }
    @Test fun allowsOnlyLocalDebugHttp() {
        assertEquals("http://10.0.2.2:7415", serverUrl("http://10.0.2.2:7415", true))
        assertTrue(runCatching { serverUrl("http://example.com", true) }.isFailure)
    }
    @Test fun rejectsCredentialsAndPaths() {
        listOf("https://admin:secret@example.com", "https://example.com/clients", "https://example.com?token=x", "https://example.com/#x").forEach {
            assertTrue(runCatching { serverUrl(it, true) }.isFailure)
        }
    }
}
