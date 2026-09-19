package com.ispmax.mobile.data

import android.content.Context
import androidx.room.*
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Entity(tableName = "snapshots", primaryKeys = ["scope", "resource"])
data class Snapshot(val scope: String, val resource: String, val payload: String, val savedAt: Long)

@Entity(tableName = "drafts", primaryKeys = ["scope", "id"])
data class Draft(val scope: String, val id: String, val kind: String, val payload: String, val updatedAt: Long)

@Entity(tableName = "ip_ranges", indices = [Index(value = ["cidr"], unique = true)])
data class LocalIpRange(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val name: String,
    val cidr: String,
    val vlan: Int?,
    val gateway: String,
    val dns: String,
    val usableStart: String,
    val usableEnd: String,
    val exclusions: String,
    val priority: Int,
    val active: Boolean,
    val updatedAt: Long = System.currentTimeMillis()
)

@Dao interface LocalDao {
    @Query("SELECT * FROM snapshots WHERE scope = :scope AND resource = :resource")
    suspend fun snapshot(scope: String, resource: String): Snapshot?
    @Upsert suspend fun save(snapshot: Snapshot)
    @Query("SELECT * FROM drafts WHERE scope = :scope AND id = :id")
    suspend fun draft(scope: String, id: String): Draft?
    @Upsert suspend fun save(draft: Draft)
    @Query("DELETE FROM drafts WHERE scope = :scope AND id = :id") suspend fun deleteDraft(scope: String, id: String)
    @Query("DELETE FROM snapshots WHERE scope = :scope") suspend fun clearScope(scope: String)
    @Query("SELECT * FROM ip_ranges ORDER BY active DESC, priority ASC, name COLLATE NOCASE ASC")
    suspend fun ipRanges(): List<LocalIpRange>
    @Upsert suspend fun saveIpRange(range: LocalIpRange): Long
    @Query("DELETE FROM ip_ranges WHERE id = :id") suspend fun deleteIpRange(id: Long): Int
}
@Database(entities = [Snapshot::class, Draft::class, LocalIpRange::class], version = 2, exportSchema = true)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun dao(): LocalDao
    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("""
                    CREATE TABLE IF NOT EXISTS `ip_ranges` (
                        `id` INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
                        `name` TEXT NOT NULL,
                        `cidr` TEXT NOT NULL,
                        `vlan` INTEGER,
                        `gateway` TEXT NOT NULL,
                        `dns` TEXT NOT NULL,
                        `usableStart` TEXT NOT NULL,
                        `usableEnd` TEXT NOT NULL,
                        `exclusions` TEXT NOT NULL,
                        `priority` INTEGER NOT NULL,
                        `active` INTEGER NOT NULL,
                        `updatedAt` INTEGER NOT NULL
                    )
                """.trimIndent())
                db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS `index_ip_ranges_cidr` ON `ip_ranges` (`cidr`)")
            }
        }

        fun open(context: Context) = Room.databaseBuilder(context, LocalDatabase::class.java, "ispmax.db")
            .addMigrations(MIGRATION_1_2)
            .build()
    }
}
