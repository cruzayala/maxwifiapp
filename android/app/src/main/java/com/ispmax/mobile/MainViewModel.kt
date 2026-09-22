package com.ispmax.mobile

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.ispmax.mobile.data.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import org.json.JSONObject
import java.util.UUID

data class PageState(val body: JSONObject? = null, val loading: Boolean = false, val error: String? = null, val cached: Boolean = false, val savedAt: Long = 0)
data class AppState(val ready: Boolean = false, val user: JSONObject? = null, val server: String = "", val busy: Boolean = false, val error: String? = null, val capabilities: JSONObject? = null)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val db = LocalDatabase.open(application)
    private val repo = MobileRepository(SessionStore(application), db.dao())
    private val _app = MutableStateFlow(AppState())
    val app = _app.asStateFlow()
    private val _pages = MutableStateFlow<Map<String, PageState>>(emptyMap())
    val pages = _pages.asStateFlow()
    private val jobs = mutableMapOf<String, Job>()
    private val _ipRanges = MutableStateFlow<List<LocalIpRange>>(emptyList())
    val ipRanges = _ipRanges.asStateFlow()
    init {
        viewModelScope.launch {
            try {
                repo.restore()
                _app.value = AppState(ready = true, user = repo.user, server = repo.base)
                ensureIpRanges()
                if (repo.user != null) capabilities()
            } catch (_: Exception) { _app.value = AppState(ready = true, error = "No se pudo abrir la sesion cifrada. Inicia sesion de nuevo.") }
        }
    }
    fun login(server: String, username: String, password: String) {
        if (_app.value.busy) return
        viewModelScope.launch {
            _app.update { it.copy(busy = true, error = null) }
            try {
                repo.login(server, username, password, "${Build.MANUFACTURER} ${Build.MODEL}")
                _pages.value = emptyMap()
                _app.value = AppState(ready = true, user = repo.user, server = repo.base)
                capabilities()
            } catch (error: Exception) { _app.update { it.copy(busy = false, error = error.message ?: "No se pudo conectar") } }
        }
    }
    private suspend fun capabilities() {
        try { val result = repo.read("/me"); _app.update { it.copy(capabilities = result.body, user = result.body.optJSONObject("user") ?: it.user) } }
        catch (error: Exception) { handleAuth(error); _app.update { it.copy(error = error.message) } }
    }
    private fun handleAuth(error: Exception) {
        if (error is ApiFailure && error.status == 401) {
            _pages.value = emptyMap()
            _app.update { it.copy(user = null, capabilities = null, error = error.message) }
        }
    }
    fun load(path: String, refresh: Boolean = false) {
        if (jobs[path]?.isActive == true || !refresh && _pages.value[path]?.body != null) return
        jobs[path] = viewModelScope.launch {
            _pages.update { it + (path to (it[path] ?: PageState()).copy(loading = true, error = null)) }
            try {
                val result = repo.read(path)
                _pages.update { it + (path to PageState(result.body, cached = result.cached, savedAt = result.savedAt)) }
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                handleAuth(error)
                val forbidden = error is ApiFailure && error.status in listOf(401, 403)
                _pages.update { it + (path to (if (forbidden) PageState() else it[path] ?: PageState()).copy(loading = false, error = error.message)) }
                if (error is ApiFailure && error.status == 403) capabilities()
            }
        }
    }
    suspend fun draft(id: Int) = repo.noteDraft(id)
    suspend fun saveDraft(id: Int, text: String, key: String, attempted: Boolean = false) = repo.saveNoteDraft(id, JSONObject().put("note", text).put("key", key).put("attempted", attempted))
    suspend fun sendNote(id: Int, text: String, key: String) {
        repo.addNote(id, text, key)
        load("/clients/$id", true)
    }
    suspend fun ticketOptions() = mutation { repo.ticketOptions() }
    suspend fun ticketForEdit(id: Int) = mutation { repo.ticketForEdit(id) }
    suspend fun ticketDraft(id: Int) = repo.ticketDraft(id)
    suspend fun saveTicketDraft(id: Int, value: JSONObject) = repo.saveTicketDraft(id, value)
    suspend fun discardTicketDraft(id: Int) = repo.discardTicketDraft(id)
    suspend fun saveTicket(id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.saveTicket(id, data, key, version).also {
            _pages.value.keys.filter { path -> path.startsWith("/tickets") || path.startsWith("/clients/") }.forEach { path ->
                jobs.remove(path)?.cancel(); load(path, true)
            }
        }
    }
    suspend fun newClientDraft() = repo.newClientDraft()
    suspend fun saveNewClientDraft(value: JSONObject) = repo.saveNewClientDraft(value)
    suspend fun discardNewClientDraft() = repo.discardNewClientDraft()
    suspend fun ensureIpRanges(): List<LocalIpRange> = repo.ipRanges().also { _ipRanges.value = it }
    fun loadIpRanges() { viewModelScope.launch { runCatching { ensureIpRanges() } } }
    suspend fun saveIpRange(range: LocalIpRange) = repo.saveIpRange(range).also { _ipRanges.value = it }
    suspend fun deleteIpRange(id: Long) = repo.deleteIpRange(id).also { _ipRanges.value = it }
    suspend fun provisionClient(data: JSONObject, key: String) = mutation {
        repo.provisionClient(data, key).also {
            _pages.value.keys.filter { path -> path.startsWith("/clients") || path == "/overview" }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
        }
    }
    suspend fun queryIpam(cidrs: org.json.JSONArray) = mutation { repo.queryIpam(cidrs) }
    suspend fun mikrotikPing(address: String) = mutation { repo.mikrotikPing(address) }
    suspend fun linkTest(id: Int) = mutation { repo.linkTest(id) }
    suspend fun setSurveyReminders(paused: Boolean, key: String) = mutation {
        repo.setSurveyReminders(paused, key).also {
            _pages.value.keys.filter { path -> path.startsWith("/surveys") }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
        }
    }
    suspend fun exportRows(path: String) = mutation { repo.exportRows(path) }
    suspend fun saveClientGps(id: Int, lat: Double, lng: Double, accuracy: Double?, key: String) = mutation {
        repo.saveClientGps(id, lat, lng, accuracy, key).also {
            _pages.value.keys.filter { path -> path == "/clients/$id" || path.startsWith("/map/clients") }.forEach { path ->
                jobs.remove(path)?.cancel(); load(path, true)
            }
        }
    }
    suspend fun externalClientForEdit(id: Int) = mutation { repo.externalClientForEdit(id) }
    suspend fun changeExternalClient(id: Int, section: String, changes: JSONObject, key: String, version: String) = mutation {
        repo.changeExternalClient(id, section, changes, key, version).also {
            _pages.value.keys.filter { path -> path == "/clients/$id" || path.startsWith("/clients?") || path == "/overview" }.forEach { path ->
                jobs.remove(path)?.cancel(); load(path, true)
            }
        }
    }
    suspend fun reserveIp(data: JSONObject, key: String) = mutation { repo.reserveIp(data, key) }
    suspend fun releaseIp(token: String, key: String) = mutation { repo.releaseIp(token, key) }
    suspend fun expenseDraft(id: Int) = repo.expenseDraft(id)
    suspend fun expenseForEdit(id: Int) = mutation { repo.expenseForEdit(id) }
    suspend fun saveExpenseDraft(id: Int, data: JSONObject) = repo.saveExpenseDraft(id, data)
    suspend fun discardExpenseDraft(id: Int) = repo.discardExpenseDraft(id)
    suspend fun saveExpense(id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.saveExpense(id, data, key, version).also { invalidateExpenses() }
    }
    suspend fun deleteExpense(id: Int, key: String, version: String) = mutation {
        repo.deleteExpense(id, key, version); invalidateExpenses()
    }
    suspend fun employeeDraft(id: Int) = repo.employeeDraft(id)
    suspend fun saveEmployeeDraft(id: Int, value: JSONObject) = repo.saveEmployeeDraft(id, value)
    suspend fun discardEmployeeDraft(id: Int) = repo.discardEmployeeDraft(id)
    suspend fun employeeForEdit(id: Int) = mutation { repo.employeeForEdit(id) }
    suspend fun saveEmployee(id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.saveEmployee(id, data, key, version).also { invalidatePayroll() }
    }
    suspend fun deleteEmployee(id: Int, key: String, version: String) = mutation {
        repo.deleteEmployee(id, key, version).also { invalidatePayroll() }
    }
    suspend fun payrollDraft(id: Int) = repo.payrollDraft(id)
    suspend fun savePayrollDraft(id: Int, value: JSONObject) = repo.savePayrollDraft(id, value)
    suspend fun discardPayrollDraft(id: Int) = repo.discardPayrollDraft(id)
    suspend fun payrollForEdit(id: Int) = mutation { repo.payrollForEdit(id) }
    suspend fun createPayroll(data: JSONObject, key: String) = mutation {
        repo.createPayroll(data, key).also { invalidatePayroll(); invalidateExpenses() }
    }
    suspend fun payPayroll(id: Int, data: JSONObject, key: String, version: String) = mutation {
        repo.payPayroll(id, data, key, version).also { invalidatePayroll(); invalidateExpenses() }
    }
    suspend fun deletePayroll(id: Int, key: String, version: String) = mutation {
        repo.deletePayroll(id, key, version); invalidatePayroll()
    }
    suspend fun userForEdit(id: Int) = mutation { repo.userForEdit(id) }
    suspend fun saveUser(id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.saveUser(id, data, key, version).also { invalidateUsers() }
    }
    suspend fun changeUserPassword(id: Int, data: JSONObject, key: String, version: String) = mutation {
        repo.changeUserPassword(id, data, key, version).also { invalidateUsers() }
    }
    suspend fun deleteUser(id: Int, key: String, version: String) = mutation {
        repo.deleteUser(id, key, version); invalidateUsers()
    }
    suspend fun changeIncident(id: Int, data: JSONObject, key: String, version: String) = mutation {
        repo.changeIncident(id, data, key, version).also {
            _pages.value.keys.filter { it.startsWith("/incidents") || it == "/network/summary" || it == "/overview" }.forEach { path ->
                jobs.remove(path)?.cancel(); load(path, true)
            }
        }
    }
    suspend fun whatsappDraft() = repo.whatsappDraft()
    suspend fun saveWhatsappDraft(value: JSONObject) = repo.saveWhatsappDraft(value)
    suspend fun discardWhatsappDraft() = repo.discardWhatsappDraft()
    suspend fun sendWhatsapp(data: JSONObject, key: String) = mutation {
        repo.sendWhatsapp(data, key).also {
            _pages.value.keys.filter { path -> path.startsWith("/whatsapp") }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
        }
    }
    suspend fun toggleWhatsappBot(enabled: Boolean, key: String) = mutation {
        repo.toggleWhatsappBot(enabled, key).also {
            _pages.value.keys.filter { path -> path.startsWith("/whatsapp/bot") }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
        }
    }
    suspend fun executeClientServiceAction(id: Int, data: JSONObject, key: String) = mutation {
        repo.executeClientServiceAction(id, data, key).also {
            _pages.value.keys.filter { path -> path.startsWith("/clients/$id") || path.startsWith("/clients?") || path == "/overview" }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
        }
    }
    suspend fun revokeSession(id: String) = mutation { repo.revokeSession(id); load("/sessions", true) }
    suspend fun equipmentDraft(id: Int) = repo.equipmentDraft(id)
    suspend fun saveEquipmentDraft(id: Int, value: JSONObject) = repo.saveEquipmentDraft(id, value)
    suspend fun discardEquipmentDraft(id: Int) = repo.discardEquipmentDraft(id)
    suspend fun equipmentForEdit(id: Int) = mutation { repo.equipmentForEdit(id) }
    suspend fun changeEquipment(id: Int, operation: String, data: JSONObject, key: String, version: String?) = mutation {
        repo.changeEquipment(id, operation, data, key, version).also {
            _pages.value.keys.filter { it.startsWith("/equipment") || it.startsWith("/clients/") || it.startsWith("/catalog/inventory") }.forEach { path ->
                jobs.remove(path)?.cancel()
                load(path, true)
            }
        }
    }
    suspend fun inventoryTypeForEdit(id: Int) = mutation { repo.inventoryTypeForEdit(id) }
    suspend fun saveInventoryType(id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.saveInventoryType(id, data, key, version).also { invalidateInventory() }
    }
    suspend fun deleteInventoryType(id: Int, key: String, version: String) = mutation {
        repo.deleteInventoryType(id, key, version); invalidateInventory()
    }
    suspend fun purchaseDraft() = repo.purchaseDraft()
    suspend fun savePurchaseDraft(data: JSONObject) = repo.savePurchaseDraft(data)
    suspend fun discardPurchaseDraft() = repo.discardPurchaseDraft()
    suspend fun createPurchase(data: JSONObject, key: String) = mutation {
        repo.createPurchase(data, key).also { invalidateInventory(); invalidateExpenses() }
    }
    suspend fun deletePurchase(id: Int, key: String, version: String) = mutation {
        repo.deletePurchase(id, key, version); invalidateInventory(); invalidateExpenses()
    }
    private fun invalidateInventory() {
        _pages.value.keys.filter { it.startsWith("/inventory/") || it.startsWith("/equipment") || it.startsWith("/catalog/inventory") }.forEach { path ->
            jobs.remove(path)?.cancel(); load(path, true)
        }
    }
    private fun invalidateExpenses() {
        _pages.value.keys.filter { it.startsWith("/expenses") }.forEach { load(it, true) }
    }
    private fun invalidatePayroll() {
        _pages.value.keys.filter { it.startsWith("/employees") || it.startsWith("/payroll") || it == "/overview" }.forEach { path ->
            jobs.remove(path)?.cancel(); load(path, true)
        }
    }
    private fun invalidateUsers() {
        _pages.value.keys.filter { it.startsWith("/users") || it.startsWith("/sessions") }.forEach { path ->
            jobs.remove(path)?.cancel(); load(path, true)
        }
    }
    suspend fun recordDraft(kind: String, id: Int) = repo.recordDraft(kind, id)
    suspend fun saveRecordDraft(kind: String, id: Int, data: JSONObject) = repo.saveRecordDraft(kind, id, data)
    suspend fun discardRecordDraft(kind: String, id: Int) = repo.discardRecordDraft(kind, id)
    suspend fun recordForEdit(kind: String, id: Int) = mutation { repo.recordForEdit(kind, id) }
    suspend fun changeRecord(kind: String, id: Int, data: JSONObject, key: String, version: String?) = mutation {
        repo.changeRecord(kind, id, data, key, version).also {
            _pages.value.keys.filter { it.startsWith("/clients") || it.startsWith("/promises") }.forEach { path ->
                jobs.remove(path)?.cancel(); load(path, true)
            }
        }
    }
    suspend fun paymentDraft(id: Int) = repo.paymentDraft(id)
    suspend fun savePaymentDraft(id: Int, value: JSONObject) = repo.savePaymentDraft(id, value)
    suspend fun discardPaymentDraft(id: Int) = repo.discardPaymentDraft(id)
    suspend fun paymentOptions(id: Int) = mutation { repo.paymentOptions(id) }
    suspend fun paymentRequest(key: String) = mutation { repo.paymentRequest(key) }
    suspend fun submitPayment(id: Int, body: JSONObject, key: String) = mutation { repo.submitPayment(id, body, key).also { refreshBilling() } }
    suspend fun verifyPayment(id: String) = mutation { repo.verifyPayment(id).also { refreshBilling() } }
    private fun refreshBilling() {
        _pages.value.keys.filter { it.startsWith("/invoices") || it.startsWith("/payments") || it == "/overview" || it.startsWith("/reports/billing") }.forEach { path -> jobs.remove(path)?.cancel(); load(path, true) }
    }
    private suspend fun <T> mutation(block: suspend () -> T): T = try { block() }
    catch (error: Exception) { handleAuth(error); throw error }
    fun logout() {
        viewModelScope.launch {
            jobs.values.forEach { it.cancel() }; jobs.clear()
            val revoked = repo.logout()
            _pages.value = emptyMap()
            _app.value = AppState(ready = true, server = repo.base, error = if (revoked) null else "Sesion local cerrada. No se pudo confirmar la revocacion en el servidor.")
        }
    }
    override fun onCleared() { db.close(); super.onCleared() }
}
