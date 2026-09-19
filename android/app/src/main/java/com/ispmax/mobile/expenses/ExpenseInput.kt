package com.ispmax.mobile

import org.json.JSONObject
import java.time.LocalDate

val expenseCategories = linkedMapOf("inventario" to "Inventario", "nomina" to "Nomina", "servicios" to "Servicios", "transporte" to "Transporte", "otros" to "Otros")

fun expenseRequest(form: JSONObject): JSONObject {
    val category = form.optString("category")
    val description = form.optString("description").trim()
    val amount = form.optString("amount").replace(',', '.')
    require(category in expenseCategories) { "Selecciona una categoria" }
    require(description.isNotEmpty() && description.length <= 500) { "Escribe una descripcion de hasta 500 caracteres" }
    require(Regex("\\d+(\\.\\d{1,2})?").matches(amount) && amount.toBigDecimal() <= "1000000000000".toBigDecimal()) { "Importe invalido: usa hasta dos decimales" }
    val date = form.optString("expenseDate")
    require(runCatching { LocalDate.parse(date).toString() == date }.getOrDefault(false)) { "Selecciona una fecha valida" }
    return JSONObject().put("category", category).put("description", description).put("amount", amount)
        .put("expenseDate", date).put("clientIdServicio", if (form.optInt("clientIdServicio") > 0) form.optInt("clientIdServicio") else JSONObject.NULL)
        .also { result -> for (key in listOf("paymentMethod", "reference", "notes")) {
            val text = form.optString(key).trim()
            require(text.length <= if (key == "notes") 4000 else 200) { "El campo $key es demasiado largo" }
            result.put(key, text.ifBlank { null } ?: JSONObject.NULL)
        } }
}
