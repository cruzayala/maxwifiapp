package com.ispmax.mobile

import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.ispmax.mobile.data.LocalDatabase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        LocalDatabase::class.java.canonicalName,
        FrameworkSQLiteOpenHelperFactory()
    )

    @Test fun migrateOneToTwoPreservesExistingDataAndAddsIpRanges() {
        helper.createDatabase("migration-ip-ranges", 1).apply {
            execSQL("INSERT INTO snapshots(scope, resource, payload, savedAt) VALUES ('owner', '/clients', 'kept', 7)")
            close()
        }

        helper.runMigrationsAndValidate("migration-ip-ranges", 2, true, LocalDatabase.MIGRATION_1_2).apply {
            query("SELECT payload, savedAt FROM snapshots WHERE scope='owner'").use { cursor ->
                cursor.moveToFirst()
                assertEquals("kept", cursor.getString(0))
                assertEquals(7L, cursor.getLong(1))
            }
            query("SELECT COUNT(*) FROM ip_ranges").use { cursor ->
                cursor.moveToFirst()
                assertEquals(0, cursor.getInt(0))
            }
            close()
        }
    }
}
