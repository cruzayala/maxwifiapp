package com.ispmax.mobile.data

import com.ispmax.mobile.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class ApiFailure(val status: Int, val code: String, message: String) : IOException(message) {
    val sessionEnded: Boolean get() = status == 401 && code in setOf("SESSION_REVOKED", "ACCESS_EXPIRED", "LOGIN_FAILED")
}
data class ReadResult(val body: JSONObject, val cached: Boolean, val savedAt: Long)

const val WEB_PREFIX = "web:"

fun serverUrl(input: String, debug: Boolean = BuildConfig.DEBUG): String {
    val url = input.trim().trimEnd('/').toHttpUrlOrNull() ?: error("URL del servidor invalida")
    require(url.username.isEmpty() && url.password.isEmpty() && url.query == null && url.fragment == null) { "URL sin credenciales ni parametros" }
    require(url.encodedPath == "/") { "Introduce solamente el origen del servidor" }
    require(url.isHttps || debug && (url.host == "127.0.0.1" || url.host == "10.0.2.2" || url.host == "localhost")) { "El servidor debe usar HTTPS" }
    val normalized = url.toString().trimEnd('/')
    require(debug || normalized == DEFAULT_SERVER) { "La aplicacion de produccion usa exclusivamente la nube ISP Max" }
    return normalized
}

class MobileRepository(private val vault: SessionStore, private val dao: LocalDao) {
    private val http = OkHttpClient.Builder().connectTimeout(12, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS).callTimeout(35, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
    // Recover stale pooled sockets for reads only; writes retain explicit idempotent retries.
    private val readHttp = http.newBuilder().retryOnConnectionFailure(true).build()
    private val authLock = Mutex()
    @Volatile private var session: JSONObject? = null
    val user: JSONObject? get() = session?.optJSONObject("user")
    val base: String get() = session?.optString("server") ?: vault.server()
    private fun scope(): String = MessageDigest.getInstance("SHA-256")
        .digest("$base|${user?.optInt("id")}".toByteArray()).joinToString("") { "%02x".format(it) }

    suspend fun restore(): Boolean = withContext(Dispatchers.IO) {
        session = vault.load()
        session?.optString("server")?.takeIf { it.isNotBlank() }?.let { vault.saveServer(it) }
        session?.optString("expiresAt")?.takeIf { it.isNotBlank() }?.let {
            if (java.time.Instant.parse(it).toEpochMilli() <= System.currentTimeMillis()) {
                vault.clear(); session = null
            }
        }
        session != null
    }
    suspend fun login(server: String, username: String, password: String, deviceName: String) = withContext(Dispatchers.IO) {
        val origin = serverUrl(server)
        val result = request(origin, "/sessions", "POST", JSONObject().put("username", username.trim()).put("password", password).put("deviceName", deviceName), null)
        result.put("server", origin)
        vault.save(result)
        vault.saveServer(origin)
        session = result
    }
    private fun request(origin: String, path: String, method: String = "GET", body: JSONObject? = null, token: String? = null, idempotency: String? = null, version: String? = null): JSONObject {
        // "web:" usa las mismas rutas que la pagina web (OLT, MikroTik, TR-069...) con la sesion movil.
        val web = path.startsWith(WEB_PREFIX)
        val url = if (web) "$origin${path.removePrefix(WEB_PREFIX)}" else "$origin/mobile/v1$path"
        val builder = Request.Builder().url(url).header("Accept", "application/json")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (idempotency != null) builder.header("Idempotency-Key", idempotency)
        if (version != null) builder.header("If-Match", version)
        builder.method(method, if (method in listOf("POST", "PUT", "PATCH") || method == "DELETE" && body != null) (body ?: JSONObject()).toString().toRequestBody("application/json".toMediaType()) else null)
        (if (method == "GET") readHttp else http).newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val trimmed = raw.trimStart()
            val parsed = runCatching { if (web && trimmed.startsWith("[")) JSONObject().put("items", org.json.JSONArray(trimmed)) else JSONObject(raw) }.getOrNull()
                ?: if (web && response.isSuccessful && trimmed.isEmpty()) JSONObject() else null
            if (!response.isSuccessful) {
                throw ApiFailure(response.code, parsed?.optString("code")?.ifBlank { null } ?: "HTTP_ERROR",
                    (parsed?.optString("error")?.ifBlank { null } ?: parsed?.optString("message")?.ifBlank { null })?.take(250) ?: "Servidor no disponible (${response.code})")
            }
            return parsed ?: throw ApiFailure(502, "INVALID_RESPONSE", "El servidor no devuelve la API movil. Comprueba su version.")
        }
    }
    private suspend fun authorized(path: String, method: String = "GET", body: JSONObject? = null, idempotency: String? = null, version: String? = null): JSONObject = withContext(Dispatchers.IO) {
        // Las solicitudes van en paralelo (una lectura lenta de la OLT no frena las demas);
        // solo la renovacion del token se hace de a una.
        val current = session ?: throw ApiFailure(401, "SESSION_REVOKED", "Inicia sesion")
        try {
            try {
                request(base, path, method, body, current.getString("accessToken"), idempotency, version)
            } catch (error: ApiFailure) {
                if (error.status != 401 || error.code != "ACCESS_EXPIRED") throw error
                val fresh = authLock.withLock {
                    val now = session ?: throw ApiFailure(401, "SESSION_REVOKED", "Inicia sesion")
                    if (now.getString("accessToken") != current.getString("accessToken")) now
                    else request(base, "/sessions/refresh", "POST", JSONObject().put("refreshToken", now.getString("refreshToken"))).also { refreshed ->
                        refreshed.put("server", base)
                        vault.save(refreshed); session = refreshed
                    }
                }
                request(base, path, method, body, fresh.getString("accessToken"), idempotency, version)
            }
        } catch (error: ApiFailure) {
            // Un 401 de un servicio externo (WispHub) no es la sesion movil: solo se cierra la sesion propia.
            if (error.sessionEnded) { vault.clear(); session = null }
            throw error
        }
    }
    suspend fun read(path: String): ReadResult {
        val owner = scope()
        try {
            val body = authorized(path)
            val now = System.currentTimeMillis()
            // Las rutas web (OLT, MikroTik, TR-069, ajustes...) pueden traer datos sensibles: no se guardan en disco.
            val volatile = path.startsWith("/sessions") || path.startsWith(WEB_PREFIX)
            if (!volatile) dao.save(Snapshot(owner, path, body.toString(), now))
            return ReadResult(body, false, now)
        } catch (error: IOException) {
            if (path.startsWith("/sessions") || path.startsWith(WEB_PREFIX) || error is ApiFailure && error.status < 500) throw error
            val cached = dao.snapshot(owner, path) ?: throw error
            return ReadResult(JSONObject(cached.payload), true, cached.savedAt)
        }
    }
    /** Operacion sobre una ruta de la web (misma validacion y permisos que la pagina). */
    suspend fun web(path: String, method: String, body: JSONObject? = null): JSONObject {
        require(path.startsWith("/") && !path.startsWith("/mobile/")) { "Ruta web invalida" }
        return authorized(WEB_PREFIX + path, method, body)
    }
    suspend fun exportRows(path: String): org.json.JSONArray {
        require(path.startsWith("/exports/")) { "Exportacion invalida" }
        val result = authorized(path)
        val rows = result.optJSONArray("items")
            ?: throw ApiFailure(502, "INVALID_RESPONSE", "La exportacion no contiene registros")
        if (result.optString("source") != "sqlite" || result.optInt("total", -1) != rows.length()) {
            throw ApiFailure(502, "INVALID_RESPONSE", "Railway no confirmo la exportacion completa")
        }
        return rows
    }
    /** Prueba del enlace MikroTik -> equipo del cliente. Solo lectura; se confirma que sea de este cliente. */
    suspend fun linkTest(id: Int, seconds: Int = 8): JSONObject {
        val result = authorized("/clients/$id/link-test", "POST", JSONObject().put("seconds", seconds))
        if (!result.optBoolean("verified") || result.optJSONObject("client")?.optInt("idServicio") != id || result.optJSONObject("traffic") == null) {
            throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la prueba de enlace")
        }
        return result
    }
    suspend fun setSurveyReminders(paused: Boolean, key: String): JSONObject {
        val result = authorized("/surveys/reminders", "POST", JSONObject().put("paused", paused), key)
        if (!result.optBoolean("confirmed") || result.optBoolean("pausedGlobally") != paused) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el estado de los recordatorios")
        return result
    }
    suspend fun saveClientGps(id: Int, lat: Double, lng: Double, accuracy: Double?, key: String): JSONObject {
        val body = JSONObject().put("lat", lat).put("lng", lng).put("accuracy", accuracy ?: JSONObject.NULL)
        val result = authorized("/clients/$id/gps", "POST", body, key)
        val client = result.optJSONObject("client")
        if (!result.optBoolean("ok") || client?.optInt("idServicio") != id || client.optDouble("gpsLat") != lat || client.optDouble("gpsLng") != lng) {
            throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la ubicacion del cliente")
        }
        return result
    }
    suspend fun externalClientForEdit(id: Int): JSONObject {
        val result = authorized("/clients/$id/external")
        if (result.optInt("idServicio") != id || result.optString("version").length != 64 || result.optString("source") != "wisphub_live") {
            throw ApiFailure(502, "INVALID_RESPONSE", "No se recibio el cliente en vivo de WispHub")
        }
        return result
    }
    suspend fun changeExternalClient(id: Int, section: String, changes: JSONObject, key: String, version: String): JSONObject {
        val body = JSONObject().put("section", section).put("changes", changes)
        val result = authorized("/clients/$id/external", "PATCH", body, key, version)
        val client = result.optJSONObject("client")
        if (!result.optBoolean("ok") || !result.optBoolean("verified") || result.optString("section") != section || client?.optInt("idServicio") != id || client.optString("version").length != 64) {
            throw ApiFailure(502, "INVALID_RESPONSE", "WispHub no confirmo el cambio del cliente")
        }
        return result
    }
    suspend fun noteDraft(clientId: Int): JSONObject? = dao.draft(scope(), "note-$clientId")?.let { JSONObject(it.payload) }
    suspend fun saveNoteDraft(clientId: Int, value: JSONObject) {
        dao.save(Draft(scope(), "note-$clientId", "client-note", value.toString(), System.currentTimeMillis()))
    }
    suspend fun addNote(clientId: Int, text: String, key: String) {
        val result = authorized("/clients/$clientId/notes", "POST", JSONObject().put("note", text), key)
        if (result.optInt("id") <= 0 || result.optInt("idServicio") != clientId || result.optString("note") != text.trim()) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la nota")
        dao.deleteDraft(scope(), "note-$clientId")
    }
    suspend fun ticketOptions(): JSONObject = authorized("/tickets/options")
    suspend fun ticketForEdit(id: Int): JSONObject {
        val result = authorized("/tickets/$id/manage")
        if (result.optInt("idTicket") != id || result.optString("version").length != 64 || result.optString("source") != "wisphub_live") {
            throw ApiFailure(502, "INVALID_RESPONSE", "No se recibio el ticket en vivo de WispHub")
        }
        return result
    }
    suspend fun ticketDraft(id: Int): JSONObject? = dao.draft(scope(), "ticket-$id")?.let { JSONObject(it.payload) }
    suspend fun saveTicketDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "ticket-$id", "ticket", value.toString(), System.currentTimeMillis()))
    suspend fun discardTicketDraft(id: Int) = dao.deleteDraft(scope(), "ticket-$id")
    suspend fun saveTicket(id: Int, body: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(if (id == 0) "/tickets" else "/tickets/$id", if (id == 0) "POST" else "PATCH", body, key, version)
        val ticket = result.optJSONObject("ticket")
        if (!result.optBoolean("ok") || !result.optBoolean("verified") || ticket == null || ticket.optInt("idTicket") <= 0 || ticket.optString("version").length != 64) {
            throw ApiFailure(502, "INVALID_RESPONSE", "WispHub no confirmo el ticket")
        }
        discardTicketDraft(id)
        return result
    }
    suspend fun newClientDraft(): JSONObject? = dao.draft(scope(), "new-client")?.let { JSONObject(it.payload) }
    suspend fun saveNewClientDraft(value: JSONObject) = dao.save(Draft(scope(), "new-client", "client-provisioning", value.toString(), System.currentTimeMillis()))
    suspend fun discardNewClientDraft() = dao.deleteDraft(scope(), "new-client")
    suspend fun ipRanges(): List<LocalIpRange> = withContext(Dispatchers.IO) {
        var ranges = dao.ipRanges()
        if (ranges.isEmpty()) {
            dao.saveIpRange(IpRangeRules.defaultRange())
            ranges = dao.ipRanges()
        }
        ranges
    }
    suspend fun saveIpRange(candidate: LocalIpRange): List<LocalIpRange> = withContext(Dispatchers.IO) {
        val current = dao.ipRanges()
        val normalized = IpRangeRules.normalize(candidate, current)
        dao.saveIpRange(normalized)
        dao.ipRanges()
    }
    suspend fun deleteIpRange(id: Long): List<LocalIpRange> = withContext(Dispatchers.IO) {
        val current = dao.ipRanges()
        val target = current.firstOrNull { it.id == id } ?: throw IllegalArgumentException("El segmento ya no existe")
        val remaining = current.filter { it.id != target.id }
        require(remaining.isNotEmpty()) { "Debe conservar al menos un segmento" }
        require(remaining.any { it.active }) { "Debe conservar al menos un segmento activo" }
        dao.deleteIpRange(id)
        dao.ipRanges()
    }
    suspend fun provisionClient(body: JSONObject, key: String): JSONObject {
        val result = authorized("/client-provisioning", "POST", body, key)
        val id = result.optJSONObject("client")?.optInt("idServicio") ?: 0
        if (!result.optBoolean("ok") || result.optString("status") != "complete" || id <= 0 ||
            result.optJSONObject("wisphub")?.optBoolean("ok") != true || result.optJSONObject("mikrotik")?.optBoolean("ok") != true ||
            result.optJSONObject("sqlite")?.optBoolean("ok") != true) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el alta completa en WispHub, MikroTik y SQLite")
        discardNewClientDraft()
        return result
    }
    suspend fun queryIpam(cidrs: org.json.JSONArray): JSONObject = authorized("/ipam/query", "POST", JSONObject().put("cidrs", cidrs))
    suspend fun reserveIp(body: JSONObject, key: String): JSONObject {
        val result = authorized("/ipam/reservations", "POST", body, key)
        if (result.optString("token").isBlank() || result.optString("ip") != body.optString("ip") || result.optString("status") != "active") throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la reserva de IP")
        return result
    }
    suspend fun releaseIp(token: String, key: String) {
        val result = authorized("/ipam/reservations/$token", "DELETE", idempotency = key)
        if (result.optString("token") != token || result.optString("status") != "released") throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la liberacion de IP")
    }
    suspend fun expenseDraft(id: Int): JSONObject? = dao.draft(scope(), "expense-$id")?.let { JSONObject(it.payload) }
    suspend fun expenseForEdit(id: Int): JSONObject = authorized("/expenses/$id")
    suspend fun saveExpenseDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "expense-$id", "expense", value.toString(), System.currentTimeMillis()))
    suspend fun discardExpenseDraft(id: Int) = dao.deleteDraft(scope(), "expense-$id")
    suspend fun saveExpense(id: Int, body: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(if (id == 0) "/expenses" else "/expenses/$id", if (id == 0) "POST" else "PATCH", body, key, version)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se recibio confirmacion del gasto")
        dao.deleteDraft(scope(), "expense-$id")
        return result
    }
    suspend fun deleteExpense(id: Int, key: String, version: String) {
        val result = authorized("/expenses/$id", "DELETE", idempotency = key, version = version)
        require(result.optBoolean("success") && result.optInt("id") == id) { "No se confirmo la eliminacion" }
    }
    suspend fun employeeDraft(id: Int): JSONObject? = dao.draft(scope(), "employee-$id")?.let { JSONObject(it.payload) }
    suspend fun saveEmployeeDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "employee-$id", "employee", value.toString(), System.currentTimeMillis()))
    suspend fun discardEmployeeDraft(id: Int) = dao.deleteDraft(scope(), "employee-$id")
    suspend fun employeeForEdit(id: Int): JSONObject = authorized("/employees/$id")
    suspend fun saveEmployee(id: Int, body: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(if (id == 0) "/employees" else "/employees/$id", if (id == 0) "POST" else "PATCH", body, key, version)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el empleado")
        discardEmployeeDraft(id)
        return result
    }
    suspend fun deleteEmployee(id: Int, key: String, version: String): JSONObject {
        val result = authorized("/employees/$id", "DELETE", idempotency = key, version = version)
        if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la baja")
        return result
    }
    suspend fun payrollDraft(id: Int): JSONObject? = dao.draft(scope(), "payroll-$id")?.let { JSONObject(it.payload) }
    suspend fun savePayrollDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "payroll-$id", "payroll", value.toString(), System.currentTimeMillis()))
    suspend fun discardPayrollDraft(id: Int) = dao.deleteDraft(scope(), "payroll-$id")
    suspend fun createPayroll(body: JSONObject, key: String): JSONObject {
        val result = authorized("/payroll", "POST", body, key)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la nomina")
        discardPayrollDraft(0)
        return result
    }
    suspend fun payPayroll(id: Int, body: JSONObject, key: String, version: String): JSONObject {
        val result = authorized("/payroll/$id/pay", "POST", body, key, version)
        if (result.optInt("id") != id || result.optString("status") != "paid" || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el pago de nomina")
        return result
    }
    suspend fun deletePayroll(id: Int, key: String, version: String) {
        val result = authorized("/payroll/$id", "DELETE", idempotency = key, version = version)
        if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la eliminacion")
    }
    suspend fun userForEdit(id: Int): JSONObject = authorized("/users/$id")
    suspend fun saveUser(id: Int, body: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(if (id == 0) "/users" else "/users/$id", if (id == 0) "POST" else "PATCH", body, key, version)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el usuario")
        return result
    }
    suspend fun changeUserPassword(id: Int, body: JSONObject, key: String, version: String): JSONObject {
        val result = authorized("/users/$id/password", "POST", body, key, version)
        if (!result.optBoolean("success") || result.optInt("id") != id || !result.optBoolean("sessionsRevoked")) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el cambio de clave")
        return result
    }
    suspend fun deleteUser(id: Int, key: String, version: String) {
        val result = authorized("/users/$id", "DELETE", idempotency = key, version = version)
        if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la eliminacion")
    }
    suspend fun changeIncident(id: Int, body: JSONObject, key: String, version: String): JSONObject {
        val result = authorized("/incidents/$id", "PATCH", body, key, version)
        if (result.optInt("id") != id || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el cambio del incidente")
        return result
    }
    suspend fun whatsappDraft(): JSONObject? = dao.draft(scope(), "whatsapp-message")?.let { JSONObject(it.payload) }
    suspend fun saveWhatsappDraft(value: JSONObject) = dao.save(Draft(scope(), "whatsapp-message", "whatsapp-message", value.toString(), System.currentTimeMillis()))
    suspend fun discardWhatsappDraft() = dao.deleteDraft(scope(), "whatsapp-message")
    suspend fun sendWhatsapp(body: JSONObject, key: String): JSONObject {
        val result = authorized("/whatsapp/messages", "POST", body, key)
        if (result.optString("state") !in listOf("sent", "failed", "pending_review")) throw ApiFailure(502, "INVALID_RESPONSE", "No se pudo comprobar el resultado del mensaje")
        if (result.optString("state") == "sent") discardWhatsappDraft()
        return result
    }
    suspend fun toggleWhatsappBot(enabled: Boolean, key: String): JSONObject {
        val result = authorized("/whatsapp/bot/toggle", "POST", JSONObject().put("enabled", enabled), key)
        if (!result.optBoolean("confirmed") || result.optBoolean("enabled") != enabled) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el estado del bot")
        return result
    }
    suspend fun executeClientServiceAction(id: Int, body: JSONObject, key: String): JSONObject {
        val result = authorized("/clients/$id/service-actions", "POST", body, key)
        if (result.optInt("idServicio") != id || result.optString("state") !in listOf("complete", "failed", "pending_review")) throw ApiFailure(502, "INVALID_RESPONSE", "No se pudo comprobar la accion de servicio")
        return result
    }
    suspend fun revokeSession(id: String) {
        val result = authorized("/sessions/$id", "DELETE")
        require(result.optBoolean("success")) { "No se confirmo la revocacion" }
    }
    suspend fun equipmentDraft(id: Int): JSONObject? = dao.draft(scope(), "equipment-$id")?.let { JSONObject(it.payload) }
    suspend fun saveEquipmentDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "equipment-$id", "equipment-operation", value.toString(), System.currentTimeMillis()))
    suspend fun discardEquipmentDraft(id: Int) = dao.deleteDraft(scope(), "equipment-$id")
    suspend fun equipmentForEdit(id: Int): JSONObject = authorized("/equipment/$id")
    suspend fun changeEquipment(id: Int, operation: String, data: JSONObject, key: String, version: String?): JSONObject {
        require(operation in listOf("create", "update", "assign", "return", "delete"))
        val path = if (operation == "create") "/equipment" else "/equipment/$id" + if (operation in listOf("assign", "return")) "/$operation" else ""
        val method = when (operation) { "update" -> "PATCH"; "delete" -> "DELETE"; else -> "POST" }
        val result = authorized(path, method, data, key, version)
        if (operation == "delete") {
            if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la eliminacion")
        } else if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se recibio confirmacion del equipo")
        dao.deleteDraft(scope(), "equipment-$id")
        return result
    }
    suspend fun inventoryTypeForEdit(id: Int): JSONObject {
        val result = authorized("/inventory/types?pageSize=100")
        return result.optJSONArray("items")?.let { rows ->
            (0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.firstOrNull { it.optInt("id") == id }
        } ?: throw ApiFailure(404, "NOT_FOUND", "Tipo de inventario no encontrado")
    }
    suspend fun saveInventoryType(id: Int, body: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(if (id == 0) "/inventory/types" else "/inventory/types/$id", if (id == 0) "POST" else "PATCH", body, key, version)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo el tipo de inventario")
        return result
    }
    suspend fun deleteInventoryType(id: Int, key: String, version: String) {
        val result = authorized("/inventory/types/$id", "DELETE", idempotency = key, version = version)
        if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la eliminacion del tipo")
    }
    suspend fun purchaseDraft(): JSONObject? = dao.draft(scope(), "purchase-0")?.let { JSONObject(it.payload) }
    suspend fun savePurchaseDraft(value: JSONObject) = dao.save(Draft(scope(), "purchase-0", "inventory-purchase", value.toString(), System.currentTimeMillis()))
    suspend fun discardPurchaseDraft() = dao.deleteDraft(scope(), "purchase-0")
    suspend fun createPurchase(body: JSONObject, key: String): JSONObject {
        val result = authorized("/inventory/purchases", "POST", body, key)
        if (result.optInt("id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la compra")
        discardPurchaseDraft()
        return result
    }
    suspend fun deletePurchase(id: Int, key: String, version: String) {
        val result = authorized("/inventory/purchases/$id", "DELETE", idempotency = key, version = version)
        if (!result.optBoolean("success") || result.optInt("id") != id) throw ApiFailure(502, "INVALID_RESPONSE", "No se confirmo la eliminacion de la compra")
    }
    suspend fun paymentDraft(id: Int): JSONObject? = dao.draft(scope(), "payment-$id")?.let { JSONObject(it.payload) }
    suspend fun savePaymentDraft(id: Int, value: JSONObject) = dao.save(Draft(scope(), "payment-$id", "payment", value.toString(), System.currentTimeMillis()))
    suspend fun discardPaymentDraft(id: Int) = dao.deleteDraft(scope(), "payment-$id")
    suspend fun paymentOptions(id: Int): JSONObject = authorized("/invoices/$id/payment-options")
    suspend fun paymentRequest(key: String): JSONObject { require(key.matches(Regex("[A-Za-z0-9_-]{16,120}"))); return checkedPayment(authorized("/payment-requests/$key")) }
    suspend fun submitPayment(id: Int, body: JSONObject, key: String): JSONObject = checkedPayment(authorized("/invoices/$id/payments", "POST", body, key))
    suspend fun verifyPayment(id: String): JSONObject { require(id.matches(Regex("[A-Za-z0-9_-]{16,120}"))); return checkedPayment(authorized("/payments/$id/verify", "POST")) }
    private fun checkedPayment(row: JSONObject): JSONObject {
        val states = listOf("uncertain", "pending", "confirmed_external", "confirmed", "rejected")
        if (row.optString("id").isBlank() || row.optInt("invoiceId") <= 0 || row.optString("state") !in states || row.optBoolean("ok") != (row.optString("state") == "confirmed") || row.optBoolean("ok") && !row.optBoolean("localLogSaved")) throw ApiFailure(502, "INVALID_RESPONSE", "No se pudo verificar el resultado del pago")
        return row
    }
    suspend fun logout(): Boolean {
        val revoked = runCatching { authorized("/sessions/current", "DELETE") }.isSuccess
        withContext(Dispatchers.IO) { vault.clear(); session = null }
        return revoked
    }
    private fun recordPath(kind: String, id: Int): String = when (kind) {
        "alias" -> { require(id > 0); "/clients/$id/record" }
        "promise" -> if (id == 0) "/promises" else "/promises/$id"
        else -> error("Operacion no disponible")
    }
    suspend fun recordForEdit(kind: String, id: Int): JSONObject = authorized(recordPath(kind, id))
    suspend fun recordDraft(kind: String, id: Int): JSONObject? = dao.draft(scope(), "record-$kind-$id")?.let { JSONObject(it.payload) }
    suspend fun saveRecordDraft(kind: String, id: Int, value: JSONObject) = dao.save(Draft(scope(), "record-$kind-$id", "client-record", value.toString(), System.currentTimeMillis()))
    suspend fun discardRecordDraft(kind: String, id: Int) = dao.deleteDraft(scope(), "record-$kind-$id")
    suspend fun changeRecord(kind: String, id: Int, data: JSONObject, key: String, version: String?): JSONObject {
        val result = authorized(recordPath(kind, id), if (kind == "promise" && id == 0) "POST" else "PATCH", data, key, version)
        if (result.optInt(if (kind == "alias") "idServicio" else "id") <= 0 || result.optString("version").length != 64) throw ApiFailure(502, "INVALID_RESPONSE", "No se recibio confirmacion del registro")
        discardRecordDraft(kind, id)
        return result
    }
}
