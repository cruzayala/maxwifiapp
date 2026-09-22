package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Estado del inventario de ONUs (filtros del servidor + filtro local de senal), igual que olt.ts. */
internal class OltInventoryState {
    var searchInput by mutableStateOf("")
    var search by mutableStateOf("")
    var status by mutableStateOf("all")
    var mapping by mutableStateOf("all")
    var pon by mutableStateOf<Int?>(null)
    var page by mutableIntStateOf(1)
    var localSignal by mutableStateOf<String?>(null)
    var view by mutableStateOf("list")

    fun path(): String = buildString {
        append("web:/olt-api/onus?page=$page&limit=50")
        if (search.isNotBlank()) append("&search=${oltEnc(search)}")
        pon?.let { append("&pon=$it") }
        if (status != "all") append("&status=$status")
        if (mapping != "all") append("&mapping=$mapping")
    }

    /** Chip rapido: «Caidas» y «Sin cliente» usan el servidor; la senal se filtra localmente. */
    fun setQuick(key: String) {
        if (key == "weak" || key == "critical") { localSignal = key; status = "all"; mapping = "all"; return }
        localSignal = null
        status = if (key == "offline") "offline" else "all"
        mapping = if (key == "unlinked") "unlinked" else "all"
        page = 1
    }

    fun activeQuick(): String? = localSignal ?: when {
        status == "all" && mapping == "all" -> "all"
        status == "offline" && mapping == "all" -> "offline"
        status == "all" && mapping == "unlinked" -> "unlinked"
        else -> null
    }
}

/** Titulo de cabecera por seccion (pageTitle() de la web). */
private val OLT_TITLES = listOf("Mapa PON", "Salud de la red óptica", "Inventario de ONUs", "Instalaciones", "ONUs por autorizar", "NAP y splitters", "Perfiles de servicio", "Alarmas y alertas", "Bitácora")
private val OLT_TABS = listOf("Mapa PON", "Salud", "ONUs", "Instalaciones", "Por autorizar", "NAP y splitters", "Perfiles", "Alarmas", "Bitácora")

/**
 * Administracion OLT completa (equivale a src/app/pages/olt de la web) usando las mismas rutas
 * /olt-api y /provisioning con la sesion movil. Solo la consola TR-069 vive fuera: [onTr069].
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OltScreen(
    vm: MainViewModel,
    pages: Map<String, PageState>,
    onTr069: (serial: String) -> Unit = {},
    onClient: (idServicio: Int) -> Unit = {},
    onOnuProvisioner: (wanIp: String?, vlan: Int?, ssid: String?) -> Unit = { _, _, _ -> },
) {
    val app by vm.app.collectAsState()
    val role = app.user?.optString("role").orEmpty()
    val admin = role == "admin" || role == "super_admin"
    val snackbar = remember { SnackbarHostState() }
    com.ispmax.mobile.ui.ScreenSnackbar.Register(snackbar)
    val scope = rememberCoroutineScope()
    val notify: (String) -> Unit = { message -> scope.launch { snackbar.currentSnackbarData?.dismiss(); snackbar.showSnackbar(message) } }
    val ctx = OltCtx(vm, pages, admin, notify, onClient, onTr069)

    var tab by rememberSaveable { mutableIntStateOf(0) }
    val inventory = remember { OltInventoryState() }
    var selectedMapPon by rememberSaveable { mutableStateOf<Int?>(null) }
    var openOnu by remember { mutableStateOf<JSONObject?>(null) }
    var quickReboot by remember { mutableStateOf(false) }
    var wizardFor by remember { mutableStateOf<JSONObject?>(null) }
    var searchOpen by remember { mutableStateOf(false) }
    var syncing by remember { mutableStateOf(false) }

    // Igual que la web: carga completa al entrar y relectura silenciosa cada 60 s.
    LaunchedEffect(Unit) { while (true) { ctx.loadAll(true); delay(60_000) } }

    fun runSync(full: Boolean) {
        if (syncing) return
        syncing = true
        scope.launch {
            try {
                val result = ctx.write("POST", "/olt-api/sync", JSONObject().put("full", full))
                notify(if (result.optBoolean("ok")) (if (full) "Inventario OLT actualizado" else "Estado OLT actualizado") else "La OLT no confirmó la lectura")
            } catch (error: Exception) { notify(error.message ?: "La OLT no respondió") } finally { syncing = false }
        }
    }

    val statusState = ctx.page(OltPaths.STATUS)
    val status = statusState.body
    val totals = status?.optJSONObject("totals") ?: JSONObject()
    val latest = status?.optJSONObject("latest")
    val mapOnus = ctx.items(OltPaths.MAP)
    val unconfigured = ctx.items(OltPaths.UNCONFIGURED)
    val jobs = ctx.items(OltPaths.JOBS)
    val alarms = ctx.items(OltPaths.ALARMS)
    val signalAlerts = ctx.items(OltPaths.SIGNAL)
    val criticalCount = mapOnus.count { it.optBoolean("online") && oltIsCritical(it.oltNum("rxPowerDbm")) }
    val healthIssues = totals.optInt("offlineOnus") + criticalCount
    val activeInstallations = jobs.count { it.oltStr("status") !in listOf("complete", "cancelled") }
    val connected = status?.optBoolean("connected") == true

    fun inspect(onu: JSONObject) { openOnu = onu; quickReboot = false }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Infraestructura óptica", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        Text(OLT_TITLES[tab], style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    }
                    IconButton(onClick = { searchOpen = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Search, "Buscar cliente, IP, serial o MAC") }
                    if (admin) IconButton(onClick = { runSync(false) }, enabled = !syncing, modifier = Modifier.size(48.dp)) {
                        if (syncing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Sync, "Sincronizar ahora")
                    }
                    IconButton(onClick = { ctx.loadAll(true) }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Refresh, "Recargar datos") }
                }
                // En el celular el resumen completo solo va en la primera pestana; en las demas
                // una linea basta y la lista queda a la vista.
                if (tab != 0) Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Outlined.Dns, null, tint = if (connected) IspGreen else IspRed, modifier = Modifier.size(16.dp))
                    Text("${totals.optInt("onlineOnus")}/${totals.optInt("totalOnus")} en línea · ${totals.optInt("activeAlarms") + totals.optInt("activeSignalAlerts")} alertas · ${if (connected) "Conectada" else "Sin conexión"}",
                        style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                } else OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Icon(Icons.Outlined.Dns, null, tint = if (connected) IspGreen else IspRed, modifier = Modifier.size(18.dp))
                            Text(latest?.oltStr("systemName") ?: "ZTE C320", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                            OltPill(if (connected) "Conectada" else "Sin conexión", if (connected) IspGreen else IspRed)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text("${totals.optInt("onlineOnus")}/${totals.optInt("totalOnus")} en línea", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                            Text("${totals.optInt("activeAlarms") + totals.optInt("activeSignalAlerts")} alertas", style = MaterialTheme.typography.bodySmall, color = IspAmber)
                            Text("Leída ${oltAgo(latest?.oltStr("capturedAt"))}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (admin) FilledTonalButton(onClick = { tab = 4 }, modifier = Modifier.fillMaxWidth().heightIn(min = 44.dp)) {
                            Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp))
                            Text("Autorizar ONU" + if (unconfigured.isNotEmpty()) " (${unconfigured.size})" else "")
                        }
                    }
                }
                if (tab != 0) Unit
                else if (status != null && !status.optBoolean("configured")) {
                    Notice("Conexión con la OLT sin configurar. El sistema no tiene los datos de acceso a la OLT. Avise al administrador del sistema.", true)
                } else if (latest?.oltStr("errorMessage") != null && !connected) {
                    Notice("No se pudo leer la OLT en la última consulta: ${latest.oltStr("errorMessage")} · Los datos mostrados pueden estar desactualizados.", true)
                }
                ReadStatus(statusState) { ctx.loadAll(true) }
            }
            ScrollableTabRow(selectedTabIndex = tab, edgePadding = 12.dp) {
                OLT_TABS.forEachIndexed { index, label ->
                    val badge = when (index) {
                        1 -> healthIssues.takeIf { it > 0 }; 2 -> totals.optInt("totalOnus"); 3 -> activeInstallations
                        4 -> totals.optInt("unconfiguredOnus"); 7 -> alarms.size + signalAlerts.size; else -> null
                    }
                    Tab(selected = tab == index, onClick = { tab = index }, modifier = Modifier.heightIn(min = 48.dp),
                        text = { Text(if (badge != null) "$label ($badge)" else label, maxLines = 1) })
                }
            }
            Box(Modifier.weight(1f).fillMaxWidth()) {
                when (tab) {
                    0 -> OltMapTab(ctx, selectedMapPon, { selectedMapPon = it }, onInspect = ::inspect,
                        onInventory = { pon -> inventory.pon = pon; inventory.page = 1; tab = 2 },
                        onQuickReboot = { onu -> openOnu = onu; quickReboot = true })
                    1 -> OltHealthTab(ctx, onInspect = ::inspect,
                        onPon = { pon -> selectedMapPon = pon; tab = 0 },
                        onInventory = { key -> inventory.pon = null; inventory.setQuick(key); tab = 2 })
                    2 -> OltInventoryTab(ctx, inventory, syncing, onSync = { runSync(true) }, onInspect = ::inspect)
                    3 -> OltInstallationsTab(ctx, onContinue = { job ->
                        val serial = job.oltStr("serial")
                        val discovered = unconfigured.firstOrNull { it.oltStr("serial")?.uppercase() == serial?.uppercase() }
                        if (discovered != null) wizardFor = discovered
                        else { tab = 4; notify("La ONU aún no aparece como detectada. Conéctela a la fibra y pulse «Detectar ahora».") }
                    })
                    4 -> OltDiscoveredTab(ctx, syncing, onSync = { runSync(true) }, onAuthorize = { wizardFor = it })
                    5 -> OltTopologyTab(ctx)
                    6 -> OltProfilesTab(ctx)
                    7 -> OltAlarmsTab(ctx, onInspect = ::inspect)
                    else -> OltActivityTab(ctx)
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(12.dp))
    }

    if (searchOpen) OltGlobalSearch(mapOnus, inventory.searchInput, onClose = { searchOpen = false },
        onOpen = { searchOpen = false; inspect(it) },
        onShowAll = { query -> searchOpen = false; inventory.localSignal = null; inventory.searchInput = query; inventory.search = query; inventory.page = 1; tab = 2 })
    openOnu?.let { onu ->
        OltOnuDetail(ctx, onu, startReboot = quickReboot, close = { openOnu = null; quickReboot = false })
    }
    wizardFor?.let { pending ->
        OltProvisioningWizard(ctx, pending, close = { wizardFor = null }, onOnuProvisioner = onOnuProvisioner)
    }
}

/** Busqueda global sobre el inventario del mapa (equivale a app-onu-global-search). */
@Composable
private fun OltGlobalSearch(onus: List<JSONObject>, initial: String, onClose: () -> Unit, onOpen: (JSONObject) -> Unit, onShowAll: (String) -> Unit) {
    var query by remember { mutableStateOf(initial) }
    val matches = remember(query, onus) { if (query.isBlank()) emptyList() else onus.filter { oltMatchesOnu(it, query) } }
    OltFullDialog(title = "Buscar ONU", eyebrow = "Búsqueda global", onClose = onClose, scrollable = false) {
        OutlinedTextField(query, { query = it }, singleLine = true, leadingIcon = { Icon(Icons.Outlined.Search, null) },
            label = { Text("Buscar cliente, IP, serial o MAC") }, modifier = Modifier.fillMaxWidth())
        if (query.isNotBlank() && matches.isEmpty()) EmptyState("Ninguna ONU coincide con «$query».")
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            items(matches.take(8), key = { it.optInt("id") }) { onu ->
                val health = onuHealth(onu)
                OutlinedCard(onClick = { onOpen(onu) }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(leadingContent = { OltDot(health.color(), 12) },
                        headlineContent = { Text(oltOnuName(onu), fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        supportingContent = { Text(listOf(onu.text("onuIndex", ""), oltOnuIp(onu), onu.oltStr("serial").orEmpty(), oltOnuMac(onu)).filter { it.isNotBlank() }.joinToString(" · "), maxLines = 2) },
                        trailingContent = { Column(horizontalAlignment = Alignment.End) { Text(oltOnuStatusLabel(onu), style = MaterialTheme.typography.labelSmall, color = health.color()); onu.oltNum("rxPowerDbm")?.let { OltMono(oltDbm(it)) } } })
                }
            }
            if (matches.isNotEmpty()) item {
                TextButton(onClick = { onShowAll(query) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(if (matches.size > 8) "Ver las ${matches.size} coincidencias en el inventario" else "Buscar en el inventario")
                }
            }
        }
    }
}
