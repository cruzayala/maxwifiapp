package com.ispmax.mobile

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ispmax.mobile.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalStorageTest {
    @Test fun sqliteUpsertsAndIsolatesScopes() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val database = Room.inMemoryDatabaseBuilder(context, LocalDatabase::class.java).build()
        try {
            val dao = database.dao()
            dao.save(Snapshot("server-a/user1", "/clients", "old", 1))
            dao.save(Snapshot("server-a/user1", "/clients", "new", 2))
            dao.save(Snapshot("server-b/user1", "/clients", "other-server", 3))
            assertEquals("new", dao.snapshot("server-a/user1", "/clients")?.payload)
            assertNull(dao.snapshot("server-a/user2", "/clients"))
            dao.save(Draft("server-a/user1", "note-301", "note", "pending", 1))
            dao.clearScope("server-a/user1")
            assertEquals("pending", dao.draft("server-a/user1", "note-301")?.payload)
            assertEquals("other-server", dao.snapshot("server-b/user1", "/clients")?.payload)
            dao.saveIpRange(IpRangeRules.defaultRange())
            assertEquals("192.168.16.0/24", dao.ipRanges().single().cidr)
        } finally { database.close() }
    }
}
