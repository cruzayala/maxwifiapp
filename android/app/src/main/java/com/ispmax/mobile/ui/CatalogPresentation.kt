package com.ispmax.mobile.ui

val catalogFieldLabels = mapOf(
    "id" to "ID", "idServicio" to "ID del cliente", "idTicket" to "Ticket",
    "nombre" to "Nombre", "name" to "Nombre", "tipo" to "Tipo",
    "syncedAt" to "Ultima sincronizacion", "asunto" to "Asunto",
    "descripcion" to "Descripcion", "description" to "Descripcion",
    "prioridad" to "Prioridad", "asignado" to "Responsable", "cliente" to "Cliente",
    "fechaCreacion" to "Creacion", "lastChangedAt" to "Ultimo cambio",
    "interfaceName" to "Interfaz", "rack" to "Rack", "shelf" to "Tarjeta",
    "pon" to "Puerto PON", "onuId" to "ID ONU", "online" to "En linea",
    "phaseState" to "Estado optico", "lastOfflineCause" to "Ultima causa de desconexion",
    "clientIdServicio" to "ID del cliente", "title" to "Titulo",
    "severity" to "Severidad", "status" to "Estado", "scopeLabel" to "Ubicacion",
    "affectedClients" to "Clientes afectados", "detectedAt" to "Detectado",
    "serialNumber" to "Serial", "macAddress" to "MAC", "brand" to "Marca",
    "unitCost" to "Costo unitario", "assignedToClientId" to "ID del cliente asignado",
    "assignedAt" to "Fecha de asignacion", "notes" to "Notas",
    "category" to "Categoria", "amount" to "Importe", "expenseDate" to "Fecha del gasto",
    "paymentMethod" to "Forma de pago", "reference" to "Referencia",
    "employeeId" to "ID del empleado", "period" to "Periodo", "netAmount" to "Importe neto",
    "paidAt" to "Fecha de pago", "periodStart" to "Inicio del periodo", "periodEnd" to "Fin del periodo",
    "folio" to "Folio", "clienteIdServicio" to "ID del cliente"
)

private val states = mapOf(
    "stock" to "En inventario", "assigned" to "Asignado", "rma" to "En garantia",
    "lost" to "Extraviado", "retired" to "Retirado", "pending" to "Pendiente",
    "paid" to "Pagado", "cancelled" to "Cancelado", "open" to "Abierto",
    "acknowledged" to "Reconocido", "resolved" to "Resuelto", "low" to "Baja",
    "medium" to "Media", "high" to "Alta", "critical" to "Critica"
)

fun catalogValue(key: String, raw: String): String = when (key) {
    "online" -> when (raw) { "true" -> "Si"; "false" -> "No"; else -> raw }
    "status", "severity" -> states[raw.lowercase()] ?: raw
    else -> raw
}
