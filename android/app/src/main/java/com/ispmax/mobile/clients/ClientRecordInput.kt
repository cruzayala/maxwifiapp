package com.ispmax.mobile

import org.json.JSONObject
import java.time.LocalDate

internal fun clientRecordRequest(kind: String, data: JSONObject, create: Boolean): JSONObject {
    val result = JSONObject()
    fun text(key: String, max: Int) {
        val value = if (data.isNull(key)) "" else data.optString(key).trim()
        require(value.length <= max) { "El texto excede $max caracteres" }
        result.put(key, value.ifBlank { null } ?: JSONObject.NULL)
    }
    if (kind == "alias") {
        listOf("aliasNombre", "aliasTelefono", "aliasCedula").forEach { text(it, 200) }
        text("aliasNotas", 4000)
    } else {
        require(kind == "promise")
        if (create) {
            val id = data.optInt("idServicio")
            require(id > 0) { "Selecciona un cliente" }
            result.put("idServicio", id)
        }
        val amount = data.optString("amount", "").trim().replace(',', '.')
        require(Regex("[0-9]+(?:\\.[0-9]{1,2})?").matches(amount) && (amount.toBigDecimalOrNull()?.let { it.signum() > 0 && it <= "1000000000".toBigDecimal() } == true)) { "Escribe un importe positivo con hasta dos decimales" }
        val day = data.optString("promisedDate", "").take(10)
        require(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(day) && runCatching { LocalDate.parse(day) }.isSuccess) { "Selecciona una fecha valida" }
        result.put("amount", amount).put("promisedDate", day)
        text("notes", 4000)
        if (!create) {
            val status = data.optString("status", "pending")
            require(status in listOf("pending", "paid", "broken")) { "Estado invalido" }
            result.put("status", status)
        }
    }
    return result
}
