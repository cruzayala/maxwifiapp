package com.ispmax.mobile

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.ispmax.mobile.data.*
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

@RunWith(AndroidJUnit4::class)
class MobileSessionTest {
    private class Stub : AutoCloseable {
        private val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
        val origin = "http://127.0.0.1:${socket.localPort}"
        @Volatile var status = 200
        @Volatile var json = "{}"
        private val worker = thread(isDaemon = true) {
            while (!socket.isClosed) {
                try {
                    socket.accept().use { client ->
                        client.soTimeout = 3000
                        val reader = client.getInputStream().bufferedReader()
                        var length = 0
                        while (true) {
                            val line = reader.readLine() ?: break
                            if (line.isEmpty()) break
                            if (line.startsWith("Content-Length:", true)) length = line.substringAfter(':').trim().toInt()
                        }
                        repeat(length) { reader.read() }
                        val body = json.toByteArray()
                        client.getOutputStream().apply {
                            write("HTTP/1.1 $status Test\r\nContent-Type: application/json\r\nContent-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                            write(body); flush()
                        }
                    }
                } catch (_: java.io.IOException) { }
            }
        }
        override fun close() { socket.close(); worker.join(3000) }
    }

    @Test fun encryptedSessionOfflineCacheAndRevocation() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.inMemoryDatabaseBuilder(context, LocalDatabase::class.java).build()
        val vault = SessionStore(context)
        vault.clear()
        try {
            Stub().use { server ->
                val repo = MobileRepository(vault, database.dao())
                server.json = """{"accessToken":"qa-access-secret","refreshToken":"qa-refresh-secret","expiresAt":"2099-01-01T00:00:00Z","user":{"id":7,"role":"admin"}}"""
                repo.login(server.origin, "qa-user", "qa-password-never-stored", "test")
                val raw = java.io.File(context.noBackupFilesDir, "mobile-session.dat").readBytes().toString(Charsets.ISO_8859_1)
                assertFalse(raw.contains("qa-access-secret"))
                assertFalse(raw.contains("qa-password-never-stored"))
                assertEquals("qa-refresh-secret", vault.load()?.getString("refreshToken"))
                val restored = MobileRepository(vault, database.dao())
                assertTrue(restored.restore())
                server.json = """{"items":[{"id":301}]}"""
                assertFalse(restored.read("/clients").cached)
                server.status = 503
                server.json = """{"error":"Unavailable"}"""
                assertTrue(restored.read("/clients").cached)
                server.status = 403
                val forbidden = runCatching { restored.read("/clients") }.exceptionOrNull()
                assertEquals(403, (forbidden as ApiFailure).status)
                assertNotNull(vault.load())
                server.status = 401
                server.json = """{"code":"SESSION_REVOKED","error":"Revoked"}"""
                val revoked = runCatching { restored.read("/clients") }.exceptionOrNull()
                assertEquals(401, (revoked as ApiFailure).status)
                assertNull(vault.load())
                assertFalse(MobileRepository(vault, database.dao()).restore())
                assertEquals(server.origin, SessionStore(context).server())
                assertEquals(server.origin, MobileRepository(SessionStore(context), database.dao()).base)
            }
        } finally { vault.clear(); vault.saveServer(DEFAULT_SERVER); database.close() }
    }

    @Test fun serverPreferenceRejectsCredentialsAndRecoversCorruptFile() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val vault = SessionStore(context)
        try {
            vault.saveServer("https://isp.example.test/")
            assertEquals("https://isp.example.test", SessionStore(context).server())
            vault.clear()
            assertEquals("https://isp.example.test", SessionStore(context).server())
            assertTrue(runCatching { vault.saveServer("https://admin:secret@isp.example.test") }.isFailure)
            assertEquals("https://isp.example.test", vault.server())
            java.io.File(context.noBackupFilesDir, "mobile-server.dat").writeText("invalid")
            assertEquals(DEFAULT_SERVER, SessionStore(context).server())
        } finally { vault.saveServer(DEFAULT_SERVER) }
    }
}
