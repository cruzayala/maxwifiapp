package com.ispmax.mobile

import org.junit.Assert.assertEquals
import org.junit.Test

class LiveNetworkFormattingTest {
    @Test fun formatsNetworkRatesWithoutFalsePrecision() {
        assertEquals("0 bps", compactBps(0.0))
        assertEquals("850 Kbps", compactBps(850_000.0))
        assertEquals("12.5 Mbps", compactBps(12_500_000.0))
        assertEquals("1.5 Gbps", compactBps(1_500_000_000.0))
    }
}
