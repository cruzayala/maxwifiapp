package com.ispmax.mobile.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SessionStore(context: Context) {
    private val serverFile = AtomicFile(java.io.File(context.noBackupFilesDir, "mobile-server.dat"))
    @Synchronized fun server(): String = runCatching {
        serverUrl(String(serverFile.readFully(), Charsets.UTF_8))
    }.getOrDefault(DEFAULT_SERVER)
    @Synchronized fun saveServer(value: String) {
        val origin = serverUrl(value)
        val stream = serverFile.startWrite()
        try { stream.write(origin.toByteArray(Charsets.UTF_8)); serverFile.finishWrite(stream) }
        catch (error: Exception) { serverFile.failWrite(stream); throw error }
    }
    private val file = AtomicFile(java.io.File(context.noBackupFilesDir, "mobile-session.dat"))
    private val alias = "ispmax.mobile.session.v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    @Synchronized fun save(value: JSONObject) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val encrypted = cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8))
        val stream = file.startWrite()
        try {
            stream.write(byteArrayOf(1)); stream.write(cipher.iv); stream.write(encrypted)
            file.finishWrite(stream)
        } catch (error: Exception) { file.failWrite(stream); throw error }
    }
    @Synchronized fun load(): JSONObject? {
        if (!file.baseFile.exists()) return null
        val bytes = file.readFully()
        require(bytes.size > 29 && bytes[0] == 1.toByte()) { "Archivo de sesion incompatible" }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        }
        return JSONObject(String(cipher.doFinal(bytes.copyOfRange(13, bytes.size)), Charsets.UTF_8))
    }
    @Synchronized fun clear() { file.delete() }
}

const val DEFAULT_SERVER = "https://isp-max-production-d0b9.up.railway.app"
