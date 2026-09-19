package com.ispmax.mobile

import com.ispmax.mobile.data.IpRangeRules
import com.ispmax.mobile.data.LocalIpRange
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertThrows
import org.junit.Test

class IpRangeRulesTest {
    @Test fun normalizesNetworkAndDefaultUsableInterval() {
        val value = IpRangeRules.normalize(range(cidr = "192.168.50.19/24", gateway = "192.168.50.1"), emptyList())
        assertEquals("192.168.50.0/24", value.cidr)
        assertEquals("192.168.50.1", value.usableStart)
        assertEquals("192.168.50.254", value.usableEnd)
    }

    @Test fun rejectsGatewayOutsideNetwork() {
        assertThrows(IllegalArgumentException::class.java) {
            IpRangeRules.normalize(range(cidr = "192.168.50.0/24", gateway = "192.168.51.1"), emptyList())
        }
    }

    @Test fun rejectsOverlappingActiveNetworks() {
        val existing = IpRangeRules.normalize(range(id = 1, cidr = "192.168.50.0/24", gateway = "192.168.50.1"), emptyList())
        assertThrows(IllegalArgumentException::class.java) {
            IpRangeRules.normalize(range(cidr = "192.168.50.128/25", gateway = "192.168.50.129"), listOf(existing))
        }
    }

    @Test fun permitsOverlapWhenEditedRangeIsInactive() {
        val existing = IpRangeRules.normalize(range(id = 1, cidr = "192.168.50.0/24", gateway = "192.168.50.1"), emptyList())
        val inactive = IpRangeRules.normalize(range(cidr = "192.168.50.128/25", gateway = "192.168.50.129", active = false), listOf(existing))
        assertEquals(false, inactive.active)
    }

    @Test fun rejectsConfigurationWithoutActiveNetwork() {
        val only = range(id = 1, active = false)
        assertThrows(IllegalArgumentException::class.java) { IpRangeRules.normalize(only, emptyList()) }
    }

    @Test fun rejectsMoreThanCombinedAddressLimit() {
        val first = IpRangeRules.normalize(range(id = 1, cidr = "10.0.0.0/17", gateway = "10.0.0.1"), emptyList())
        val second = IpRangeRules.normalize(range(id = 2, cidr = "10.0.128.0/17", gateway = "10.0.128.1"), listOf(first))
        assertThrows(IllegalArgumentException::class.java) {
            IpRangeRules.normalize(range(id = 3, cidr = "10.1.0.0/24", gateway = "10.1.0.1"), listOf(first, second))
        }
    }

    @Test fun honorsUsableIntervalAndExclusions() {
        val range = IpRangeRules.normalize(range().copy(usableStart = "192.168.16.10", usableEnd = "192.168.16.20", exclusions = "192.168.16.12, 192.168.16.15-192.168.16.17"), emptyList())
        assertTrue(IpRangeRules.isAssignable(range, "192.168.16.10"))
        assertFalse(IpRangeRules.isAssignable(range, "192.168.16.9"))
        assertFalse(IpRangeRules.isAssignable(range, "192.168.16.12"))
        assertFalse(IpRangeRules.isAssignable(range, "192.168.16.16"))
    }

    private fun range(
        id: Long = 0,
        cidr: String = "192.168.16.0/24",
        gateway: String = "192.168.16.1",
        active: Boolean = true
    ) = LocalIpRange(id, "Principal", cidr, 101, gateway, "8.8.8.8", "", "", "", 10, active, 1)
}
