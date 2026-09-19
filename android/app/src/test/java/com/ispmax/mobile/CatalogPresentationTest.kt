package com.ispmax.mobile

import com.ispmax.mobile.ui.catalogValue
import org.junit.Assert.assertEquals
import org.junit.Test

class CatalogPresentationTest {
    @Test fun translatesOnlyTypedStatusFields() {
        assertEquals("Pendiente", catalogValue("status", "pending"))
        assertEquals("pending", catalogValue("description", "pending"))
        assertEquals("Si", catalogValue("online", "true"))
        assertEquals("Sin dato", catalogValue("online", "Sin dato"))
        assertEquals("vendor-specific", catalogValue("status", "vendor-specific"))
    }
}
