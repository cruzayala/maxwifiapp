package com.ispmax.mobile

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.time.Instant
import java.util.Locale

// Utilidades de la administracion MikroTik: mismo calculo que src/app/pages/mikrotik/mt-utils.ts
// y mikrotik.ts de la web. Todo se calcula con los datos ya leidos; nada aqui escribe en el router.

internal fun JSONObject?.mtStr(key: String): String? =
    if (this == null || !has(key) || isNull(key)) null else optString(key).ifBlank { null }
internal fun JSONObject?.mtNum(key: String): Double =
    if (this == null || !has(key) || isNull(key)) 0.0 else optDouble(key, 0.0).let { if (it.isNaN()) 0.0 else it }
internal fun JSONObject?.mtBool(key: String): Boolean = this?.optBoolean(key, false) == true

private fun fixed(value: Double, digits: Int) = String.format(Locale.US, "%.${digits}f", value)
private fun round1(value: Double) = Math.round(value * 10.0) / 10.0
private val esNumber: NumberFormat = NumberFormat.getIntegerInstance(Locale("es", "DO"))
internal fun mtInt(value: Double): String = esNumber.format(value.toLong())

internal fun mtFormatBps(value: Double): String = when {
    value == 0.0 -> "0 Mbps"
    value < 1_000_000 -> "${fixed(value / 1_000, 0)} Kbps"
    else -> "${fixed(value / 1_000_000, if (value >= 100_000_000) 0 else 1)} Mbps"
}

internal fun mtFormatBytes(value: Double): String = when {
    value < 1_000_000 -> "${fixed(value / 1_000, 1)} KB"
    value < 1_000_000_000 -> "${fixed(value / 1_000_000, 1)} MB"
    value < 1_000_000_000_000 -> "${fixed(value / 1_000_000_000, 1)} GB"
    else -> "${fixed(value / 1_000_000_000_000, 2)} TB"
}

internal fun mtBpsToMbps(value: Double): Double = round1(value / 1_000_000)
internal fun mtCompact(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else fixed(value, 1)
internal fun mtLimitValues(value: String?): Pair<Double, Double> {
    val parts = (value ?: "0/0").ifBlank { "0/0" }.split("/")
    return mtBpsToMbps(parts.getOrNull(0)?.trim()?.toDoubleOrNull() ?: 0.0) to mtBpsToMbps(parts.getOrNull(1)?.trim()?.toDoubleOrNull() ?: 0.0)
}
internal fun mtFormatLimit(value: String?): String {
    val (up, down) = mtLimitValues(value)
    if (up == 0.0 && down == 0.0) return "Sin límite"
    return "${mtCompact(up)} / ${mtCompact(down)} Mbps"
}

internal fun mtParseTime(value: String?): Long? =
    value?.takeIf { it.isNotBlank() }?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }

/** "hace 3 min", igual que relativeTime() de la web. */
internal fun mtRelative(time: Long?, now: Long): String {
    if (time == null || time <= 0) return "sin datos"
    val seconds = maxOf(0L, Math.round((now - time) / 1000.0))
    if (seconds < 10) return "hace unos segundos"
    if (seconds < 60) return "hace $seconds s"
    val minutes = seconds / 60
    if (minutes < 60) return "hace $minutes min"
    val hours = minutes / 60
    if (hours < 24) return "hace $hours h"
    val days = hours / 24
    return "hace $days ${if (days == 1L) "día" else "días"}"
}

private val planRegex = Regex("""^(\d+(?:\.\d+)?)\s*([kKmM])\s*[/|]\s*(\d+(?:\.\d+)?)\s*([kKmM])\s*(.*)$""")
/** Igual que PlanLabelPipe: "3300k/3300k" -> "3.3 Mbps". */
internal fun mtPlanLabel(raw: String?): String {
    val name = raw?.trim().orEmpty()
    if (name.isEmpty()) return "Sin plan"
    val match = planRegex.find(name) ?: return name
    fun toMbps(value: String, unit: String): String {
        val number = value.toDoubleOrNull() ?: return value
        return mtCompact(round1(if (unit.lowercase() == "k") number / 1000 else number))
    }
    val down = toMbps(match.groupValues[1], match.groupValues[2])
    val up = toMbps(match.groupValues[3], match.groupValues[4])
    val speed = if (down == up) "$down Mbps" else "$down / $up Mbps"
    val suffix = match.groupValues[5].trim()
    if (suffix.isEmpty()) return speed
    return "$speed · ${suffix.first().uppercase()}${suffix.drop(1).lowercase()}"
}

// --- Etiquetas (mismos textos que la web) ---
internal fun mtSyncLabel(state: String?): String = when (state) {
    "synced" -> "Sincronizado"; "missing_wisphub" -> "Solo MikroTik"; "missing_mikrotik" -> "Sin cola"
    "missing_ip" -> "Sin IP"; "queue_mismatch" -> "Nombre diferente"; "state_mismatch" -> "Estado diferente"
    else -> state ?: "-"
}
internal fun mtClassificationLabel(value: String?): String = when (value) {
    "unregistered_queue" -> "Cola sin ERP"; "unmanaged_device" -> "Sin control"; "infrastructure_candidate" -> "Posible infraestructura"
    else -> value ?: "-"
}
internal fun mtSeverityLabel(value: String?): String = when (value) {
    "critical" -> "Crítico"; "high" -> "Alto"; "medium" -> "Medio"; "low" -> "Bajo"; else -> value ?: "-"
}
internal fun mtClientStateLabel(row: JSONObject): String =
    if (row.mtBool("isDisabled")) "Deshabilitado" else if (row.mtBool("isOnline")) "En línea" else "Sin conexión"
internal fun mtNetwatchStatusLabel(item: JSONObject): String {
    if (item.mtBool("disabled")) return "Deshabilitada"
    val status = item.mtStr("status")
    return when (status?.lowercase()) { "up" -> "Responde"; "down" -> "Sin respuesta"; "unknown" -> "Sin datos"; else -> status ?: "Sin datos" }
}
internal val MT_NETWATCH_TYPES = listOf("icmp" to "Ping (ICMP)", "simple" to "Ping simple", "tcp-conn" to "Conexión TCP", "http-get" to "Web HTTP", "https-get" to "Web HTTPS", "dns" to "DNS")
internal fun mtNetwatchTypeLabel(type: String?): String = MT_NETWATCH_TYPES.firstOrNull { it.first == type }?.second ?: type ?: "-"
internal fun mtIpSourceLabel(sources: JSONArray?): String {
    val list = (0 until (sources?.length() ?: 0)).map { sources!!.optString(it) }
    if (list.isEmpty()) return "Sin registros"
    val labels = mapOf("queue" to "Cola", "queues" to "Cola", "dhcp" to "DHCP", "lease" to "DHCP", "arp" to "ARP", "wisphub" to "WispHub", "client" to "WispHub", "pool" to "Pool", "address" to "Router", "router" to "Router")
    return list.joinToString(" + ") { labels[it.lowercase()] ?: it }
}
internal fun mtIpamClassificationLabel(row: JSONObject): String {
    if (row.mtBool("conflict")) return "Conflicto"
    return when (val c = row.mtStr("classification")) {
        "available" -> if (row.mtBool("recommended")) "Disponible sugerida" else "Disponible"
        "client" -> "Cliente WispHub"; "unknown_lease" -> "DHCP sin cliente"; "arp_only" -> "ARP sin cliente"
        "queue_only" -> "Cola sin cliente"; "pool_reserved" -> "Reserva de pool"; "router" -> "Infraestructura"
        else -> c ?: "-"
    }
}

// --- Salud del router (evaluateRouterHealth) ---
internal enum class MtLevel(val rank: Int) { NONE(0), OK(1), WARN(2), CRIT(3) }
internal data class MtMetric(val label: String, val value: Double?, val display: String, val detail: String, val level: MtLevel)
internal data class MtSensor(val key: String, val label: String, val display: String, val kind: String, val level: MtLevel)
internal data class MtHealth(
    val level: MtLevel, val label: String, val reasons: List<String>, val cpu: MtMetric, val memory: MtMetric, val disk: MtMetric,
    val sensors: List<MtSensor>, val uptimeSeconds: Long?, val version: String, val board: String, val architecture: String, val cpuInfo: String,
)
internal fun mtLevelLabel(level: MtLevel) = when (level) { MtLevel.OK -> "Saludable"; MtLevel.WARN -> "Revisar"; MtLevel.CRIT -> "Crítico"; MtLevel.NONE -> "Sin datos" }

private fun numOf(value: Any?): Double? {
    if (value == null || value == JSONObject.NULL) return null
    val text = value.toString()
    if (text.isEmpty()) return null
    val cleaned = text.replace(Regex("[^\\d.\\-]"), "")
    if (cleaned.isEmpty()) return 0.0
    return cleaned.toDoubleOrNull()
}
private fun levelFor(value: Double?, warn: Double, crit: Double): MtLevel = when {
    value == null -> MtLevel.NONE; value >= crit -> MtLevel.CRIT; value >= warn -> MtLevel.WARN; else -> MtLevel.OK
}
private fun plain(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
internal fun mtBytesShort(value: Double?): String {
    val bytes = value ?: 0.0
    return when {
        bytes >= 1_073_741_824 -> "${fixed(bytes / 1_073_741_824, 1)} GB"
        bytes >= 1_048_576 -> "${fixed(bytes / 1_048_576, 0)} MB"
        else -> "${fixed(bytes / 1024, 0)} KB"
    }
}
internal fun mtParseUptime(text: String?): Long? {
    val value = text?.trim().orEmpty()
    if (value.isEmpty()) return null
    var seconds = 0L; var matched = false
    listOf(Regex("(\\d+)w") to 604_800L, Regex("(\\d+)d") to 86_400L, Regex("(\\d+)h") to 3_600L, Regex("(\\d+)m(?!s)") to 60L, Regex("(\\d+)s") to 1L).forEach { (pattern, factor) ->
        pattern.find(value)?.let { seconds += it.groupValues[1].toLong() * factor; matched = true }
    }
    Regex("(\\d{1,2}):(\\d{2}):(\\d{2})$").find(value)?.let {
        seconds += it.groupValues[1].toLong() * 3_600 + it.groupValues[2].toLong() * 60 + it.groupValues[3].toLong(); matched = true
    }
    return if (matched) seconds else null
}
internal fun mtDuration(totalSeconds: Long?): String {
    if (totalSeconds == null) return "-"
    val days = totalSeconds / 86_400
    val hours = (totalSeconds % 86_400) / 3_600
    val minutes = (totalSeconds % 3_600) / 60
    if (days >= 7) {
        val weeks = days / 7; val rest = days % 7
        return "$weeks ${if (weeks == 1L) "semana" else "semanas"}${if (rest > 0) " y $rest ${if (rest == 1L) "día" else "días"}" else ""}"
    }
    if (days > 0) return "$days ${if (days == 1L) "día" else "días"}${if (hours > 0) " y $hours h" else ""}"
    if (hours > 0) return "$hours h $minutes min"
    return "${maxOf(1L, minutes)} min"
}
private fun sensorLabel(name: String): String {
    val known = mapOf(
        "cpu-temperature" to "Temp. CPU", "temperature" to "Temperatura", "board-temperature1" to "Temp. placa",
        "board-temperature2" to "Temp. placa 2", "sfp-temperature" to "Temp. SFP", "switch-temperature" to "Temp. switch",
        "phy-temperature" to "Temp. puertos", "voltage" to "Voltaje", "power-consumption" to "Consumo eléctrico", "current" to "Corriente",
    )
    known[name]?.let { return it }
    Regex("^fan(\\d*)-speed$").find(name)?.let { return "Ventilador ${it.groupValues[1]}".trim() }
    Regex("^psu(\\d*)-state$").find(name)?.let { return "Fuente ${it.groupValues[1]}".trim() }
    Regex("^psu(\\d*)-voltage$").find(name)?.let { return "Voltaje fuente ${it.groupValues[1]}".trim() }
    return name.replace("-", " ")
}
private fun rawText(obj: JSONObject, key: String): String = if (!obj.has(key) || obj.isNull(key)) "" else obj.opt(key).toString()
internal fun mtReadSensors(health: Any?): List<MtSensor> {
    val list = health as? JSONArray ?: return emptyList()
    val entries = mutableListOf<Triple<String, String, String>>()
    for (index in 0 until list.length()) {
        val record = list.optJSONObject(index) ?: continue
        if (record.has("name") && record.has("value")) entries += Triple(rawText(record, "name"), rawText(record, "value"), rawText(record, "type"))
        else record.keys().forEach { key -> if (!key.startsWith(".")) entries += Triple(key, rawText(record, key), "") }
    }
    return entries.filter { it.second.isNotEmpty() }.map { (rawName, rawValue, type) ->
        val name = rawName.lowercase()
        val value = numOf(rawValue)
        when {
            name.contains("temperature") -> {
                val (warn, crit) = if (name.startsWith("cpu")) 75.0 to 85.0 else if (name.startsWith("sfp")) 65.0 to 75.0 else 60.0 to 70.0
                MtSensor(name, sensorLabel(name), if (value == null) rawValue else "${plain(value)} °C", "temperature", levelFor(value, warn, crit))
            }
            name.contains("voltage") -> MtSensor(name, sensorLabel(name), if (value == null) rawValue else "${plain(value)} V", "voltage", MtLevel.OK)
            name.contains("fan") && name.contains("speed") -> MtSensor(name, sensorLabel(name), if (value == null) rawValue else "${mtInt(value)} RPM", "fan", if (value == 0.0) MtLevel.WARN else MtLevel.OK)
            name.contains("psu") && name.contains("state") -> {
                val ok = rawValue.lowercase() == "ok"
                MtSensor(name, sensorLabel(name), if (ok) "Funciona" else "Falla o sin conectar", "psu", if (ok) MtLevel.OK else MtLevel.WARN)
            }
            else -> MtSensor(name, sensorLabel(name), rawValue + if (type.isNotEmpty() && type != "C") " $type" else "", "other", MtLevel.NONE)
        }
    }
}
internal fun mtRouterHealth(system: JSONObject?): MtHealth {
    val resource = system?.optJSONObject("resource") ?: JSONObject()
    fun res(key: String): Any? = if (resource.has(key)) resource.opt(key) else null
    val cpuLoad = numOf(res("cpu-load"))
    val totalMemory = numOf(res("total-memory")); val freeMemory = numOf(res("free-memory"))
    val totalDisk = numOf(res("total-hdd-space")); val freeDisk = numOf(res("free-hdd-space"))
    val memoryPct = if (totalMemory != null && totalMemory != 0.0 && freeMemory != null) ((totalMemory - freeMemory) / totalMemory * 100).coerceIn(0.0, 100.0) else null
    val diskPct = if (totalDisk != null && totalDisk != 0.0 && freeDisk != null) ((totalDisk - freeDisk) / totalDisk * 100).coerceIn(0.0, 100.0) else null
    val cpuCount = numOf(res("cpu-count")); val cpuFrequency = numOf(res("cpu-frequency"))
    val cpu = MtMetric("CPU", cpuLoad, cpuLoad?.let { "${fixed(it, 0)}%" } ?: "-",
        if (cpuCount != null && cpuCount != 0.0) "${plain(cpuCount)} ${if (cpuCount == 1.0) "núcleo" else "núcleos"}${if (cpuFrequency != null && cpuFrequency != 0.0) " · ${plain(cpuFrequency)} MHz" else ""}" else "Carga del procesador",
        levelFor(cpuLoad, 70.0, 85.0))
    val memory = MtMetric("Memoria", memoryPct, memoryPct?.let { "${fixed(it, 0)}%" } ?: "-",
        if (totalMemory != null && totalMemory != 0.0 && freeMemory != null) "${mtBytesShort(totalMemory - freeMemory)} de ${mtBytesShort(totalMemory)}" else "Memoria RAM usada",
        levelFor(memoryPct, 80.0, 90.0))
    val disk = MtMetric("Almacenamiento", diskPct, diskPct?.let { "${fixed(it, 0)}%" } ?: "-",
        if (totalDisk != null && totalDisk != 0.0 && freeDisk != null) "${mtBytesShort(freeDisk)} libres" else "Espacio para respaldos",
        levelFor(diskPct, 80.0, 90.0))
    val sensors = mtReadSensors(system?.opt("health"))
    val uptime = mtParseUptime(res("uptime")?.takeIf { it != JSONObject.NULL }?.toString())
    val reasons = mutableListOf<String>()
    if (cpu.level == MtLevel.CRIT) reasons += "CPU muy cargada (${cpu.display})" else if (cpu.level == MtLevel.WARN) reasons += "CPU alta (${cpu.display})"
    if (memory.level == MtLevel.WARN || memory.level == MtLevel.CRIT) reasons += "Memoria ${if (memory.level == MtLevel.CRIT) "casi llena" else "alta"} (${memory.display})"
    if (disk.level == MtLevel.WARN || disk.level == MtLevel.CRIT) reasons += "Almacenamiento ${if (disk.level == MtLevel.CRIT) "casi lleno" else "alto"}: limpie respaldos viejos"
    sensors.filter { it.level == MtLevel.CRIT || it.level == MtLevel.WARN }.forEach { sensor ->
        reasons += when (sensor.kind) {
            "psu" -> "${sensor.label}: falla o sin conectar"
            "fan" -> "${sensor.label} detenido"
            else -> "${sensor.label} ${if (sensor.level == MtLevel.CRIT) "muy alta" else "elevada"} (${sensor.display})"
        }
    }
    var uptimeLevel = if (uptime == null) MtLevel.NONE else MtLevel.OK
    if (uptime != null && uptime < 3_600) { uptimeLevel = MtLevel.WARN; reasons += "Se reinició hace ${mtDuration(uptime)}" }
    val level = (listOf(cpu.level, memory.level, disk.level, uptimeLevel) + sensors.map { it.level }).maxByOrNull { it.rank } ?: MtLevel.NONE
    fun textOf(key: String) = res(key)?.takeIf { it != JSONObject.NULL }?.toString().orEmpty()
    return MtHealth(level, mtLevelLabel(level), reasons, cpu, memory, disk, sensors, uptime,
        textOf("version").ifEmpty { "-" }, textOf("board-name").ifEmpty { "-" }, textOf("architecture-name").ifEmpty { "-" }, textOf("cpu"))
}

// --- Inconsistencias (detectIssues) ---
internal data class MtIssueInfo(val title: String, val detail: String, val level: String, val short: String)
internal val MT_ISSUE_ORDER = listOf("dup-ip", "no-client", "no-queue", "state-diff", "paused", "no-limit", "dup-mac", "saturated", "no-ip", "name-diff")
internal val MT_ISSUE_INFO = mapOf(
    "dup-ip" to MtIssueInfo("IP con más de una cola", "Dos colas apuntan a la misma IP: solo una limita al cliente.", "crit", "IP duplicada"),
    "no-client" to MtIssueInfo("Colas sin cliente en WispHub", "Hay un equipo con cola en el router que no aparece como cliente. Puede estar navegando sin facturar.", "warn", "Sin cliente"),
    "no-queue" to MtIssueInfo("Clientes sin cola", "Clientes de WispHub con IP que no tienen cola de velocidad en el router.", "warn", "Sin cola"),
    "state-diff" to MtIssueInfo("Estado diferente", "La cola está deshabilitada en el router pero el cliente sigue activo en WispHub.", "warn", "Estado diferente"),
    "paused" to MtIssueInfo("Colas pausadas", "La cola existe pero está deshabilitada: ese equipo navega sin límite de velocidad.", "warn", "Cola pausada"),
    "no-limit" to MtIssueInfo("Colas sin límite configurado", "La cola no tiene velocidad máxima: no controla el consumo del cliente.", "warn", "Sin límite"),
    "dup-mac" to MtIssueInfo("MAC repetida en varias IPs", "El mismo equipo responde en varias IPs. Puede ser un repetidor o un cliente que cambió de IP.", "info", "MAC repetida"),
    "saturated" to MtIssueInfo("Clientes al tope del plan", "Usan 90% o más de su velocidad ahora mismo. Útil si reportan lentitud.", "info", "Al tope"),
    "no-ip" to MtIssueInfo("Clientes sin IP asignada", "Clientes de WispHub sin IP: no se pueden vincular con el router.", "info", "Sin IP"),
    "name-diff" to MtIssueInfo("Nombre de cola diferente", "El nombre de la cola no coincide con el registrado en WispHub.", "info", "Nombre diferente"),
)
internal fun mtNormalizeMac(value: String?): String = value.orEmpty().uppercase().replace(Regex("[^0-9A-F]"), "")
internal fun mtUsage(row: JSONObject): Double = maxOf(row.mtNum("uploadPct"), row.mtNum("downloadPct"))

internal fun mtIpToLong(ip: String?): Long? {
    val parts = ip.orEmpty().split(".")
    if (parts.size != 4) return null
    var value = 0L
    for (part in parts) {
        if (!Regex("^\\d{1,3}$").matches(part)) return null
        val octet = part.toLong(); if (octet > 255) return null
        value = value * 256 + octet
    }
    return value
}
internal fun mtLongToIp(value: Long): String = listOf((value / 16_777_216) % 256, (value / 65_536) % 256, (value / 256) % 256, value % 256).joinToString(".")
internal fun mtCompareIp(a: String?, b: String?): Int {
    val left = mtIpToLong(a); val right = mtIpToLong(b)
    if (left == null && right == null) return 0
    if (left == null) return 1
    if (right == null) return -1
    return left.compareTo(right)
}

internal fun mtDetectIssues(rows: List<JSONObject>): Map<String, List<JSONObject>> {
    val result = MT_ISSUE_ORDER.associateWith { mutableListOf<JSONObject>() }
    val queuesByIp = LinkedHashMap<String, MutableList<JSONObject>>()
    val ipsByMac = LinkedHashMap<String, MutableSet<String>>()
    val rowsByMac = LinkedHashMap<String, MutableList<JSONObject>>()
    for (row in rows) {
        when (row.mtStr("syncState")) {
            "missing_wisphub" -> result.getValue("no-client") += row
            "missing_mikrotik" -> result.getValue("no-queue") += row
            "missing_ip" -> result.getValue("no-ip") += row
            "queue_mismatch" -> result.getValue("name-diff") += row
            "state_mismatch" -> result.getValue("state-diff") += row
        }
        val queueId = row.mtStr("queueId"); val ip = row.mtStr("ip")
        if (queueId != null && row.mtBool("isDisabled")) result.getValue("paused") += row
        if (queueId != null && row.mtNum("maxUploadBps") == 0.0 && row.mtNum("maxDownloadBps") == 0.0) result.getValue("no-limit") += row
        if (queueId != null && row.mtBool("isOnline") && !row.mtBool("isDisabled") && mtUsage(row) >= 90) result.getValue("saturated") += row
        if (queueId != null && ip != null) queuesByIp.getOrPut(ip) { mutableListOf() } += row
        val mac = mtNormalizeMac(row.mtStr("macAddress"))
        if (ip != null && mac.length == 12 && mac != "000000000000" && mac != "FFFFFFFFFFFF") {
            ipsByMac.getOrPut(mac) { mutableSetOf() } += ip
            rowsByMac.getOrPut(mac) { mutableListOf() } += row
        }
    }
    queuesByIp.values.filter { it.size > 1 }.forEach { result.getValue("dup-ip") += it }
    ipsByMac.filter { it.value.size > 1 }.forEach { (mac, _) -> result.getValue("dup-mac") += rowsByMac[mac].orEmpty() }
    result.getValue("saturated").sortByDescending { mtUsage(it) }
    result.getValue("dup-ip").sortWith { a, b -> mtCompareIp(a.mtStr("ip"), b.mtStr("ip")) }
    result.getValue("dup-mac").sortWith { a, b ->
        mtNormalizeMac(a.mtStr("macAddress")).compareTo(mtNormalizeMac(b.mtStr("macAddress"))).takeIf { it != 0 } ?: mtCompareIp(a.mtStr("ip"), b.mtStr("ip"))
    }
    return result
}

// --- Mapa de ocupacion IP (mt-ip-grid.ts) ---
internal data class MtGridCell(val n: Int, val ip: String, val state: String, val title: String)
internal data class MtGridBlock(val id: String, val cidr: String, val label: String, val cells: List<MtGridCell>, val counts: Map<String, Int>, val hosts: Int, val used: Int, val firstFree: String?)
internal val MT_GRID_LEGEND = listOf(
    "recommended" to "Libre sugerida", "free" to "Libre", "client" to "Cliente WispHub", "occupied" to "Ocupada sin cliente",
    "pool" to "Reserva de pool", "router" to "Infraestructura", "conflict" to "Conflicto IP / MAC", "edge" to "Red / difusión",
)
private fun gridState(row: JSONObject): String {
    if (row.mtBool("conflict")) return "conflict"
    return when (row.mtStr("classification")) {
        "available" -> if (row.mtBool("recommended")) "recommended" else "free"
        "client" -> "client"; "router" -> "router"; "pool_reserved" -> "pool"; else -> "occupied"
    }
}
private fun describeIp(row: JSONObject): String {
    val ip = row.mtStr("ip").orEmpty()
    val client = row.optJSONObject("client")
    if (row.mtBool("conflict")) {
        val macs = (0 until (row.optJSONArray("macAddresses")?.length() ?: 0)).map { row.optJSONArray("macAddresses")!!.optString(it) }
        return "$ip · Conflicto: ${macs.joinToString(", ").ifEmpty { "varias concesiones" }}"
    }
    return when (row.mtStr("classification")) {
        "available" -> "$ip · Libre${if (row.mtBool("recommended")) " (sugerida)" else ""}: toque para copiar"
        "client" -> "$ip · Cliente: ${client.mtStr("name") ?: "-"}${client.mtStr("username")?.let { " ($it)" } ?: ""}"
        "router" -> "$ip · Infraestructura del router${row.mtStr("interface")?.let { " ($it)" } ?: ""}"
        "pool_reserved" -> "$ip · Reserva del pool ${row.mtStr("poolName").orEmpty()}".trim()
        "queue_only" -> "$ip · Cola sin cliente: ${row.mtStr("queueName") ?: "-"}"
        "unknown_lease" -> "$ip · DHCP sin cliente: ${row.mtStr("hostName") ?: row.mtStr("macAddress") ?: "-"}"
        "arp_only" -> "$ip · Equipo visto en ARP sin cliente: ${row.mtStr("macAddress") ?: "-"}"
        else -> ip
    }
}
internal fun mtGridBlocks(ipam: JSONObject?, selectedNetwork: String?): List<MtGridBlock> {
    if (ipam == null) return emptyList()
    val rows = HashMap<Long, JSONObject>()
    ipam.optJSONArray("rows").objects().forEach { row -> mtIpToLong(row.mtStr("ip"))?.let { rows[it] = row } }
    val blocks = mutableListOf<MtGridBlock>()
    for (network in ipam.optJSONArray("networks").objects()) {
        val cidr = network.mtStr("cidr") ?: continue
        if (selectedNetwork != null && cidr != selectedNetwork) continue
        val base = mtIpToLong(network.mtStr("network")) ?: continue
        val prefix = network.optInt("prefix", 0)
        if (prefix < 8 || prefix > 30) continue
        val size = 1L shl (32 - prefix)
        val end = base + size - 1
        var blockStart = base - (base % 256); var index = 0
        while (blockStart <= end && index < 64) {
            blocks += buildBlock(cidr, blockStart, base, end, rows)
            blockStart += 256; index++
        }
    }
    return blocks
}
private fun buildBlock(cidr: String, blockStart: Long, start: Long, end: Long, rows: Map<Long, JSONObject>): MtGridBlock {
    val counts = linkedMapOf("recommended" to 0, "free" to 0, "client" to 0, "occupied" to 0, "pool" to 0, "router" to 0, "conflict" to 0, "edge" to 0, "nodata" to 0, "outside" to 0)
    val cells = ArrayList<MtGridCell>(256)
    var firstFree: String? = null
    for (n in 0 until 256) {
        val value = blockStart + n
        val ip = mtLongToIp(value)
        val row = rows[value]
        val (state, title) = when {
            value < start || value > end -> "outside" to "$ip · fuera del rango $cidr"
            value == start || value == end -> "edge" to "$ip · ${if (value == start) "dirección de red" else "difusión"} (no se asigna)"
            row == null -> "nodata" to "$ip · sin datos en el inventario"
            else -> gridState(row) to describeIp(row)
        }
        counts[state] = (counts[state] ?: 0) + 1
        if (firstFree == null && (state == "recommended" || state == "free")) firstFree = ip
        cells += MtGridCell(n, ip, state, title)
    }
    val hosts = 256 - counts.getValue("outside") - counts.getValue("edge")
    val used = counts.getValue("client") + counts.getValue("occupied") + counts.getValue("pool") + counts.getValue("router") + counts.getValue("conflict")
    val label = mtLongToIp(blockStart).split(".").take(3).joinToString(".") + ".x"
    return MtGridBlock("$cidr|$blockStart", cidr, label, cells, counts, hosts, used, firstFree)
}

// --- Buscador global (mt-global-search.ts) ---
internal data class MtSearchHit(
    val key: String, val kind: String, val badge: String, val title: String, val subtitle: String,
    val ip: String, val clientId: Int?, val rate: String, val tab: String, val score: Int,
)
internal fun mtSearch(query: String, clients: List<JSONObject>, unknown: List<JSONObject>, ipamRows: List<JSONObject>): List<MtSearchHit> {
    val raw = query.trim().lowercase()
    if (raw.length < 2) return emptyList()
    val macQuery = mtNormalizeMac(raw)
    val useMac = macQuery.length >= 4 && !Regex("^[\\d.]+$").matches(raw) && Regex("^[0-9a-f:\\-.\\s]+$", RegexOption.IGNORE_CASE).matches(raw)
    val seenIps = HashSet<String>()
    val hits = mutableListOf<MtSearchHit>()
    fun score(fields: List<String?>, ip: String, mac: String?): Int {
        var best = 0
        if (ip.isNotEmpty()) {
            if (ip == raw) best = 100 else if (ip.startsWith(raw)) best = maxOf(best, 70) else if (ip.contains(raw)) best = maxOf(best, 40)
        }
        if (useMac && mac != null && mtNormalizeMac(mac).contains(macQuery)) best = maxOf(best, 80)
        for (field in fields) {
            val text = field.orEmpty().lowercase()
            if (text.isEmpty()) continue
            best = when {
                text == raw -> maxOf(best, 90)
                text.startsWith(raw) -> maxOf(best, 60)
                text.split(Regex("\\s+")).any { it.startsWith(raw) } -> maxOf(best, 50)
                text.contains(raw) -> maxOf(best, 30)
                else -> best
            }
        }
        return best
    }
    fun limitText(v: Double) = fixed(v / 1e6, 1).replace(".0", "")
    for (row in clients) {
        val client = row.optJSONObject("client")
        val ip = row.mtStr("ip").orEmpty()
        val value = score(listOf(client.mtStr("name"), client.mtStr("wisphubName"), client.mtStr("username"), row.mtStr("queueName"), client.mtStr("zone"), client.mtStr("snOnu")), ip, row.mtStr("macAddress"))
        if (value == 0) continue
        val queueId = row.mtStr("queueId")
        val kind = if (client == null) "no-client" else if (queueId == null) "no-queue" else "client"
        val online = row.mtBool("isOnline")
        val limit = if (queueId != null) "${limitText(row.mtNum("maxUploadBps"))} / ${limitText(row.mtNum("maxDownloadBps"))} Mbps" else "sin cola"
        hits += MtSearchHit(
            "c-${queueId ?: client?.optInt("id")?.toString() ?: ip}-$ip", kind,
            if (kind == "client") (if (online) "Cliente en línea" else "Cliente sin conexión") else if (kind == "no-client") "Cola sin cliente" else "Cliente sin cola",
            client.mtStr("name") ?: row.mtStr("queueName") ?: "Sin nombre",
            listOfNotNull(client.mtStr("username"), row.mtStr("macAddress"), "Límite $limit").joinToString(" · "),
            ip, client?.optInt("id")?.takeIf { it > 0 },
            if (row.mtNum("downloadBps") + row.mtNum("uploadBps") > 0) "↓ ${mtFormatBps(row.mtNum("downloadBps"))}" else "",
            "reconciliation", value + if (online) 1 else 0,
        )
        if (ip.isNotEmpty()) seenIps += ip
    }
    for (device in unknown) {
        val ip = device.mtStr("ip").orEmpty()
        val value = score(listOf(device.mtStr("identity"), device.mtStr("platform"), device.mtStr("queueName"), device.mtStr("bridgePort"), device.mtStr("interface")), ip, device.mtStr("macAddress"))
        if (value == 0 || ip in seenIps) continue
        hits += MtSearchHit(
            "u-$ip", "unknown", if (device.mtStr("risk") == "high") "Desconocido · riesgo alto" else "Desconocido",
            device.mtStr("identity") ?: device.mtStr("platform") ?: "Equipo sin identificar",
            listOfNotNull(device.mtStr("macAddress"), device.mtStr("bridgePort") ?: device.mtStr("interface"), "${device.optInt("connectionCount")} conexiones").joinToString(" · "),
            ip, null, if (device.mtNum("downloadBps") + device.mtNum("uploadBps") > 0) "↓ ${mtFormatBps(device.mtNum("downloadBps"))}" else "",
            "unknown", value,
        )
        seenIps += ip
    }
    for (row in ipamRows) {
        val ip = row.mtStr("ip").orEmpty()
        if (ip in seenIps) continue
        val client = row.optJSONObject("client")
        val value = score(listOf(row.mtStr("hostName"), row.mtStr("queueName"), client.mtStr("name"), client.mtStr("username")), ip, row.mtStr("macAddress"))
        if (value == 0) continue
        val available = row.mtBool("available")
        hits += MtSearchHit(
            "i-$ip", if (available) "free" else "ip", if (available) "IP libre" else "Inventario IP",
            if (available) "Disponible para un equipo nuevo" else (client.mtStr("name") ?: row.mtStr("hostName") ?: row.mtStr("queueName") ?: "Ocupada sin cliente"),
            listOfNotNull(row.mtStr("cidr"), row.mtStr("macAddress"), row.mtStr("hostName")).joinToString(" · "),
            ip, client?.optInt("id")?.takeIf { it > 0 }, "", "ipam", value - if (available) 5 else 0,
        )
    }
    return hits.sortedByDescending { it.score }
}

/** Filas CSV con las mismas columnas que exporta la web. */
internal fun mtCsvRow(vararg pairs: Pair<String, Any?>): JSONObject =
    JSONObject().apply { pairs.forEach { (key, value) -> put(key, value?.toString() ?: "") } }
internal fun mtMbps2(value: Double): String = fixed(value / 1_000_000, 2).let { if (it.endsWith(".00")) it.dropLast(3) else it.trimEnd('0') }
