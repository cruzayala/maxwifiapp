package com.ispmax.mobile

import org.json.JSONObject

internal val equipmentStates = linkedMapOf("" to "Todos", "stock" to "En stock", "assigned" to "Asignados", "rma" to "En reparacion", "lost" to "Perdidos", "retired" to "Retirados")
internal fun equipmentRequest(form: JSONObject): JSONObject {
    val operation = form.getString("operation")
    val data = form.getJSONObject("data")
    fun value(field: String): String = if (data.isNull(field)) "" else data.optString(field).trim()
    if (operation == "assign") {
        require(data.optInt("clientId") > 0) { "Selecciona un cliente" }
        return JSONObject().put("clientId", data.getInt("clientId")).put("notes", value("installNotes"))
    }
    if (operation in listOf("return", "delete")) return JSONObject()
    require(operation in listOf("create", "update")) { "Operacion no disponible" }
    require(data.optInt("typeId") > 0) { "Selecciona el tipo de equipo" }
    val cost = data.optString("unitCost", "0").trim().replace(',', '.').ifBlank { "0" }
    require(Regex("[0-9]+(\\.[0-9]{1,2})?").matches(cost) && cost.toDouble() <= 1e9) { "Costo invalido: usa hasta dos decimales" }
    val mac = value("macAddress").replace(":", "").replace("-", "")
    require(mac.isEmpty() || Regex("[0-9a-fA-F]{12}").matches(mac)) { "MAC invalida" }
    val result = JSONObject().put("typeId", data.getInt("typeId")).put("unitCost", cost)
    for (field in listOf("serialNumber", "macAddress", "brand", "model", "notes")) {
        val value = value(field)
        require(value.length <= if (field == "notes") 4000 else 200) { "El campo $field es demasiado largo" }
        result.put(field, if (value.isBlank()) JSONObject.NULL else value)
    }
    if (operation == "update") {
        val status = data.optString("status")
        require(status in equipmentStates.keys && status.isNotBlank()) { "Estado invalido" }
        result.put("status", status)
    }
    return result
}
