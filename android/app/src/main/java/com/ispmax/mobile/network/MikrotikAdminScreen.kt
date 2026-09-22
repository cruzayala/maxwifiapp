package com.ispmax.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.ispmax.mobile.ui.IspAmber
import com.ispmax.mobile.ui.IspBlue
import com.ispmax.mobile.ui.IspGreen
import com.ispmax.mobile.ui.IspRed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

// Rutas web (las mismas que usa src/app/pages/mikrotik) leidas con la sesion movil.
internal const val MT_STATUS = "web:/mikrotik/status"
internal const val MT_SYSTEM = "web:/mikrotik/system"
internal const val MT_WAN = "web:/mikrotik/wan-traffic"
internal const val MT_LIVE = "web:/mikrotik/clients-live"
internal const val MT_UNKNOWN = "web:/mikrotik/unknown-devices"
internal const val MT_SECURITY = "web:/mikrotik/security-audit"
internal const val MT_TRAFFIC = "web:/mikrotik/traffic"
internal const val MT_SESSIONS = "web:/mikrotik/active-sessions"
internal const val MT_ADDRESSES = "web:/mikrotik/addresses"
internal const val MT_ARP = "web:/mikrotik/arp"
internal const val MT_DHCP = "web:/mikrotik/dhcp-leases"
internal const val MT_BACKUPS = "web:/mikrotik/backups"
internal const val MT_FIREWALL = "web:/mikrotik/firewall"
internal const val MT_IPAM = "web:/mikrotik/ipam"
internal const val MT_TEMPLATES = "web:/mikrotik/speed-templates"
internal const val MT_NETWATCH = "web:/mikrotik/netwatch"
internal val MT_CORE = listOf(MT_STATUS, MT_SYSTEM, MT_WAN, MT_LIVE)
internal const val MT_PAGE_SIZE = 50

internal data class MtConfirm(val title: String, val message: String, val confirmLabel: String, val danger: Boolean = false, val onConfirm: () -> Unit)
internal data class MtQueueDraft(val id: String?, val ip: String, val name: String, val upload: String, val download: String, val disabled: Boolean, val comment: String)

/** Estado de la vista (filtros, paginas, seleccion) compartido entre pestañas, como las señales de mikrotik.ts. */
internal class MtUiState {
    var tab by mutableStateOf("overview")
    var clientQuery by mutableStateOf(""); var syncFilter by mutableStateOf("all"); var clientSort by mutableStateOf("default"); var clientPage by mutableIntStateOf(1)
    var unknownQuery by mutableStateOf(""); var unknownFilter by mutableStateOf("all"); var unknownPage by mutableIntStateOf(1)
    var ipamQuery by mutableStateOf(""); var ipamFilter by mutableStateOf("all"); var ipamNetwork by mutableStateOf<String?>(null); var ipamPage by mutableIntStateOf(1)
    var rankingMode by mutableStateOf("now")
    var firewallTable by mutableStateOf("filter")
    var infraSection by mutableStateOf("interfaces")
    val selectedQueueIds = mutableStateListOf<String>()
    var selectedTemplateId by mutableStateOf("")
    var queueEditor by mutableStateOf<MtQueueDraft?>(null)
    var confirm by mutableStateOf<MtConfirm?>(null)
    var saving by mutableStateOf(false)
    var searchQuery by mutableStateOf("")

    fun setClientFilter(value: String) { syncFilter = value; clientPage = 1 }
    fun setIpamFilterValue(value: String) { ipamFilter = value; ipamPage = 1 }
    fun showIssue(kind: String) { tab = "reconciliation"; clientQuery = ""; setClientFilter(if (kind == "paused") "disabled" else kind) }
    fun openIpamConflicts() { tab = "ipam"; ipamNetwork = null; ipamQuery = ""; setIpamFilterValue("conflict") }
    fun openSearchResult(target: String, query: String) {
        tab = target
        when (target) {
            "reconciliation" -> { syncFilter = "all"; clientQuery = query; clientPage = 1 }
            "unknown" -> { unknownFilter = "all"; unknownQuery = query; unknownPage = 1 }
            "ipam" -> { ipamNetwork = null; ipamFilter = "all"; ipamQuery = query; ipamPage = 1 }
        }
    }
    fun showTopConsumers() { tab = "reconciliation"; setClientFilter("all"); clientSort = if (rankingMode == "total") "total" else "traffic"; clientPage = 1 }
}

/** Acciones contra el router: solo avisa exito cuando el servidor lo confirma, igual que la web. */
internal class MtActions(private val vm: MainViewModel, private val scope: CoroutineScope, private val snackbar: SnackbarHostState, private val clipboard: ClipboardManager, private val ui: MtUiState) {
    fun toast(message: String) { scope.launch { snackbar.currentSnackbarData?.dismiss(); snackbar.showSnackbar(message) } }
    fun copy(ip: String) {
        if (runCatching { clipboard.setText(AnnotatedString(ip)) }.isSuccess) toast("IP $ip copiada") else toast("No se pudo copiar. Anote la IP: $ip")
    }
    fun run(method: String, path: String, body: JSONObject?, refresh: List<String>, success: String, failure: String, guarded: Boolean = true, onDone: (JSONObject) -> Unit = {}) {
        if (guarded && ui.saving) return
        if (guarded) ui.saving = true
        scope.launch {
            try {
                val result = vm.web(method, path, body, *refresh.toTypedArray())
                if (result.has("ok") && !result.optBoolean("ok")) throw IllegalStateException(result.optString("error").ifBlank { failure })
                toast(success)
                onDone(result)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                toast(error.message?.takeIf { it.isNotBlank() } ?: failure)
            } finally {
                if (guarded) ui.saving = false
            }
        }
    }
    fun confirm(title: String, message: String, label: String, danger: Boolean = false, action: () -> Unit) { ui.confirm = MtConfirm(title, message, label, danger, action) }
}

private val MT_TABS = listOf(
    "overview" to "Resumen", "ipam" to "IPs libres", "reconciliation" to "Clientes y colas", "unknown" to "Desconocidos",
    "interfaces" to "Infraestructura", "firewall" to "Firewall", "netwatch" to "Monitoreo", "backups" to "Respaldos", "security" to "Seguridad",
)

@Composable
fun MikrotikAdminScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    val app by vm.app.collectAsState()
    val role = app.user?.optString("role").orEmpty()
    // La web usa hasAnyRole(['admin']) y el servidor requireRole(['admin']): admin y super_admin.
    val canManage = role == "admin" || role == "super_admin"
    val ui = remember { MtUiState() }
    val snackbar = remember { SnackbarHostState() }
    com.ispmax.mobile.ui.ScreenSnackbar.Register(snackbar)
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val actions = remember(vm) { MtActions(vm, scope, snackbar, clipboard, ui) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val latestPages by rememberUpdatedState(pages)
    val lifecycle = LocalLifecycleOwner.current.lifecycle

    // Igual que la web: datos operativos cada 15 s, desconocidos cada 5 min y reloj local cada 10 s.
    // Solo mientras la pantalla esta visible (se detiene en segundo plano).
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch {
                while (true) {
                    val current = latestPages
                    if (current[MT_UNKNOWN]?.loading != true && current[MT_SECURITY]?.loading != true) MT_CORE.forEach { vm.load(it, true) }
                    delay(15_000)
                }
            }
            launch { while (true) { delay(300_000); if (latestPages[MT_UNKNOWN]?.body != null) vm.load(MT_UNKNOWN, true) } }
            launch { while (true) { now = System.currentTimeMillis(); delay(10_000) } }
        }
    }
    LaunchedEffect(ui.tab) {
        when (ui.tab) {
            "unknown" -> vm.load(MT_UNKNOWN)
            "interfaces" -> { vm.load(MT_TRAFFIC); vm.load(MT_SESSIONS) }
            "security" -> vm.load(MT_SECURITY)
            "firewall" -> vm.load(MT_FIREWALL)
            "ipam" -> vm.load(MT_IPAM)
            "netwatch" -> vm.load(MT_NETWATCH)
            "backups" -> vm.load(MT_BACKUPS)
            "reconciliation" -> vm.load(MT_TEMPLATES)
        }
    }

    val status = pages[MT_STATUS]?.body
    val system = pages[MT_SYSTEM]?.body
    val live = pages[MT_LIVE]?.body
    val clients = remember(live) { live?.optJSONArray("clients").objects() }
    val health = remember(system) { mtRouterHealth(system) }
    val lastUpdate = MT_CORE.maxOf { pages[it]?.savedAt ?: 0L }.takeIf { it > 0 }
    val refreshing = MT_CORE.any { pages[it]?.loading == true }
    val connected = status?.optBoolean("connected") == true
    val statusState = pages[MT_STATUS]
    val offline = !connected && statusState != null && !statusState.loading && (statusState.body != null || statusState.error != null)

    fun refreshAll() {
        when (ui.tab) {
            "unknown" -> vm.load(MT_UNKNOWN, true)
            "interfaces" -> listOf(MT_TRAFFIC, MT_SESSIONS, MT_ADDRESSES, MT_ARP, MT_DHCP).filter { it == MT_TRAFFIC || it == MT_SESSIONS || pages[it] != null }.forEach { vm.load(it, true) }
            "security" -> vm.load(MT_SECURITY, true)
            "firewall" -> vm.load(MT_FIREWALL, true)
            "ipam" -> vm.load(MT_IPAM, true)
            "netwatch" -> vm.load(MT_NETWATCH, true)
            "backups" -> vm.load(MT_BACKUPS, true)
            else -> MT_CORE.forEach { vm.load(it, true) }
        }
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            MtHeader(status, system, health, connected, lastUpdate, now, refreshing, onHealth = { ui.tab = "overview" }, onRefresh = { refreshAll() })
            pages[MT_LIVE]?.error?.let { Box(Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) { Notice(it.ifBlank { "No se pudo leer la operación del MikroTik" }, true) } }
            val unknownStats = pages[MT_UNKNOWN]?.body?.optJSONObject("stats")
            val differences = live?.optJSONObject("stats")?.optInt("differences") ?: 0
            ScrollableTabRow(selectedTabIndex = MT_TABS.indexOfFirst { it.first == ui.tab }.coerceAtLeast(0), edgePadding = 12.dp) {
                MT_TABS.forEach { (key, label) ->
                    val text = when (key) {
                        "reconciliation" -> "$label ($differences)"
                        "unknown" -> "$label (${unknownStats?.optInt("highRisk")?.toString() ?: "-"})"
                        else -> label
                    }
                    Tab(selected = ui.tab == key, onClick = { ui.tab = key }, text = { Text(text, maxLines = 1) }, modifier = Modifier.heightIn(min = 48.dp))
                }
            }
            if (offline) {
                MtOffline(status?.mtStr("error") ?: statusState?.error ?: "No se pudo conectar con el MikroTik.") { refreshAll() }
            } else {
                Box(Modifier.weight(1f)) {
                    when (ui.tab) {
                        "overview" -> MtOverviewTab(vm, pages, ui, actions, clients, health, now)
                        "reconciliation" -> MtClientsTab(vm, pages, ui, actions, clients, canManage)
                        "unknown" -> MtUnknownTab(vm, pages, ui, actions, canManage, now)
                        "interfaces" -> MtInfrastructureTab(vm, pages, ui)
                        "firewall" -> MtFirewallTab(vm, pages, ui, actions, canManage, now)
                        "ipam" -> MtIpamTab(vm, pages, ui, actions, canManage, now)
                        "netwatch" -> MtNetwatchTab(vm, pages, ui, actions, canManage)
                        "backups" -> MtBackupsTab(vm, pages, ui, actions, canManage)
                        "security" -> MtSecurityTab(vm, pages, actions, now)
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter).padding(12.dp))
    }

    ui.confirm?.let { confirm ->
        AlertDialog(
            onDismissRequest = { ui.confirm = null },
            title = { Text(confirm.title) },
            text = { Text(confirm.message) },
            confirmButton = {
                TextButton(onClick = { ui.confirm = null; confirm.onConfirm() }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Text(confirm.confirmLabel, color = if (confirm.danger) IspRed else MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                }
            },
            dismissButton = { TextButton(onClick = { ui.confirm = null }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Cancelar") } },
        )
    }
    ui.queueEditor?.let { draft -> MtQueueEditorDialog(vm, draft, actions, onClose = { ui.queueEditor = null }) }
}

@Composable
private fun MtHeader(status: JSONObject?, system: JSONObject?, health: MtHealth, connected: Boolean, lastUpdate: Long?, now: Long, refreshing: Boolean, onHealth: () -> Unit, onRefresh: () -> Unit) {
    val resource = system?.optJSONObject("resource")
    val version = resource.mtStr("version")
    val stale = lastUpdate != null && now - lastUpdate > 60_000
    Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(42.dp).background((if (connected) IspGreen else IspRed).copy(alpha = .1f), RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Router, null, tint = if (connected) IspGreen else IspRed)
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(8.dp).background(if (connected) IspGreen else IspRed, CircleShape))
                    Spacer(Modifier.width(6.dp))
                    Text("${if (connected) "En línea" else "Sin conexión"} · ${status.mtStr("host") ?: "No configurado"}", style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(system.mtStr("identity") ?: "Router principal", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(if (version != null) "${resource.mtStr("board-name") ?: "-"} · RouterOS $version" else "Sin datos del equipo", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            IconButton(onClick = onRefresh, enabled = !refreshing, modifier = Modifier.size(48.dp)) {
                if (refreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(Icons.Outlined.Refresh, "Actualizar datos")
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (connected && health.level != MtLevel.NONE) {
                AssistChip(onClick = onHealth, label = { Text("Router: ${health.label}") }, leadingIcon = { Box(Modifier.size(8.dp).background(mtLevelColor(health.level), CircleShape)) })
            }
            Text("${if (stale) "Datos atrasados" else "Actualizado"} ${if (lastUpdate != null) mtRelative(lastUpdate, now) else "--:--:--"}", style = MaterialTheme.typography.labelSmall, color = if (stale) IspAmber else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (connected && health.reasons.isNotEmpty() && health.level != MtLevel.OK) {
            Text(health.reasons.joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = mtLevelColor(health.level), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun MtOffline(message: String, retry: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Outlined.WifiOff, null, tint = IspRed, modifier = Modifier.size(40.dp))
        Text("MikroTik no disponible", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        Text(message, style = MaterialTheme.typography.bodyMedium)
        Text("Verifique que el router esté encendido y con Internet. Si el problema continúa, avise al administrador de la red.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = retry, modifier = Modifier.heightIn(min = 48.dp)) { Icon(Icons.Outlined.Refresh, null); Spacer(Modifier.width(8.dp)); Text("Reintentar") }
    }
}

// --- Piezas comunes ---
internal fun mtLevelColor(level: MtLevel): Color = when (level) { MtLevel.CRIT -> IspRed; MtLevel.WARN -> IspAmber; MtLevel.OK -> IspGreen; MtLevel.NONE -> Color(0xFF52646B) }
internal fun mtIssueColor(level: String): Color = when (level) { "crit" -> IspRed; "warn" -> IspAmber; else -> IspBlue }

@Composable internal fun MtBadge(text: String, color: Color) {
    Text(text, color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, maxLines = 1,
        modifier = Modifier.background(color.copy(alpha = .10f), RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable internal fun MtCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(modifier.fillMaxWidth()) { Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp), content = content) }
}

@Composable internal fun MtSectionTitle(title: String, subtitle: String, icon: ImageVector? = null, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (icon != null) { Icon(icon, null, tint = IspGreen); Spacer(Modifier.width(10.dp)) }
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        trailing()
    }
}

@Composable internal fun MtSearchField(value: String, placeholder: String, onChange: (String) -> Unit) {
    OutlinedTextField(value, { onChange(it.take(120)) }, placeholder = { Text(placeholder) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        leadingIcon = { Icon(Icons.Outlined.Search, null) },
        trailingIcon = { if (value.isNotEmpty()) IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Close, "Limpiar búsqueda") } })
}

@Composable internal fun MtSelect(label: String, options: List<Pair<String, String>>, selected: String, modifier: Modifier = Modifier, enabled: Boolean = true, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(onClick = { open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp), shape = RoundedCornerShape(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(options.firstOrNull { it.first == selected }?.second ?: options.firstOrNull()?.second ?: "-", maxLines = 1, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurface)
            }
            Icon(Icons.Outlined.ArrowDropDown, null)
        }
        DropdownMenu(open, { open = false }) {
            options.forEach { (value, text) -> DropdownMenuItem(text = { Text(text) }, onClick = { open = false; onSelect(value) }, modifier = Modifier.heightIn(min = 48.dp)) }
        }
    }
}

@Composable internal fun MtChipRail(content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp), content = content)
}

@Composable internal fun MtFilterChip(label: String, count: Any?, selected: Boolean, color: Color? = null, onClick: () -> Unit) {
    FilterChip(selected = selected, onClick = onClick, modifier = Modifier.heightIn(min = 40.dp),
        label = { Text(if (count != null) "$label  $count" else label, color = color ?: Color.Unspecified) })
}

@Composable internal fun MtIpChip(ip: String, actions: MtActions) {
    AssistChip(onClick = { actions.copy(ip) }, label = { Text(ip, fontFamily = FontFamily.Monospace) }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, "Copiar IP $ip", Modifier.size(16.dp)) })
}

@Composable internal fun MtPager(total: Int, page: Int, pageCount: Int, onMove: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
        IconButton(onClick = { onMove(-1) }, enabled = page > 1, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ChevronLeft, "Página anterior") }
        Text("$total resultados · página $page de $pageCount", style = MaterialTheme.typography.bodySmall)
        IconButton(onClick = { onMove(1) }, enabled = page < pageCount, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.ChevronRight, "Página siguiente") }
    }
}

@Composable internal fun MtDatum(label: String, value: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified) {
    Column(modifier) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, fontWeight = FontWeight.SemiBold, color = color, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

internal fun mtPageCount(size: Int) = maxOf(1, (size + MT_PAGE_SIZE - 1) / MT_PAGE_SIZE)
internal fun <T> mtPaged(rows: List<T>, page: Int): List<T> {
    val current = minOf(page, mtPageCount(rows.size))
    return rows.drop((current - 1) * MT_PAGE_SIZE).take(MT_PAGE_SIZE)
}

/** Estado de lectura dentro de una lista: barra de carga y error con reintento. */
internal fun LazyListScope.mtReadStatus(state: PageState?, retry: () -> Unit) {
    if (state == null) return
    item { ReadStatus(state, retry) }
}

// --- Resumen ---
@Composable
private fun MtOverviewTab(vm: MainViewModel, pages: Map<String, PageState>, ui: MtUiState, actions: MtActions, clients: List<JSONObject>, health: MtHealth, now: Long) {
    val wan = pages[MT_WAN]?.body
    val stats = pages[MT_LIVE]?.body?.optJSONObject("stats")
    val unknownBody = pages[MT_UNKNOWN]?.body
    val unknownDevices = remember(unknownBody) { unknownBody?.optJSONArray("devices").objects() }
    val ipamBody = pages[MT_IPAM]?.body
    val ipamRows = remember(ipamBody) { ipamBody?.optJSONArray("rows").objects() }
    val security = pages[MT_SECURITY]?.body
    val rx = wan.mtNum("rxBps"); val tx = wan.mtNum("txBps"); val maxBps = wan.mtNum("maxBps")
    val utilization = if (maxBps > 0) minOf(100.0, maxOf(rx, tx) / maxBps * 100) else 0.0
    val issues = remember(clients) { mtDetectIssues(clients) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { MtGlobalSearch(ui, actions, clients, unknownDevices, ipamRows) }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtKpi("WAN descarga", mtFormatBps(rx), "${"%.0f".format(utilization)}% capacidad", Icons.Outlined.ArrowDownward, IspBlue, Modifier.weight(1f))
                    MtKpi("WAN subida", mtFormatBps(tx), wan.mtStr("ifaceName") ?: "-", Icons.Outlined.ArrowUpward, IspGreen, Modifier.weight(1f))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtKpi("Clientes en línea", "${stats?.optInt("onlineClients") ?: 0}", "${stats?.optInt("transmittingClients") ?: 0} transmitiendo", Icons.Outlined.Wifi, IspGreen, Modifier.weight(1f))
                    MtKpi("Diferencias", "${stats?.optInt("differences") ?: 0}", "WispHub / MikroTik", Icons.Outlined.Storage, IspAmber, Modifier.weight(1f)) { ui.tab = "reconciliation"; ui.setClientFilter("differences") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    MtKpi("Desconocidos", unknownBody?.optJSONObject("stats")?.optInt("highRisk")?.toString() ?: "-", "riesgo alto", Icons.Outlined.GppMaybe, IspRed, Modifier.weight(1f)) { ui.tab = "unknown" }
                    MtKpi("Seguridad", security?.takeIf { it.has("score") && !it.isNull("score") }?.optInt("score")?.toString() ?: "-", "sobre 100", Icons.Outlined.Shield, Color(0xFF52646B), Modifier.weight(1f)) { ui.tab = "security" }
                }
            }
        }
        item {
            MtCard {
                MtSectionTitle("Capacidad del enlace", "${wan.mtStr("ifaceName") ?: "WAN"} · ${mtFormatBps(maxBps)} contratado", Icons.Outlined.Speed) {
                    Text("${"%.0f".format(utilization)}%", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = if (utilization >= 80) IspAmber else IspGreen)
                }
                LinearProgressIndicator(progress = { (utilization / 100).toFloat() }, modifier = Modifier.fillMaxWidth().height(8.dp), color = if (utilization >= 80) IspAmber else IspGreen)
                Row {
                    MtDatum("Descarga", mtFormatBps(rx), Modifier.weight(1f), IspBlue)
                    MtDatum("Subida", mtFormatBps(tx), Modifier.weight(1f), IspGreen)
                    MtDatum("Paquetes", "${mtInt(wan.mtNum("rxPps") + wan.mtNum("txPps"))}/s", Modifier.weight(1f))
                }
                if (wan.mtBool("degraded")) Text("El router no entregó la lectura del enlace WAN en este momento.", style = MaterialTheme.typography.labelSmall, color = IspAmber)
            }
        }
        item { MtRouterHealthCard(pages[MT_SYSTEM]?.body, health) }
        item { MtNetworkIssuesCard(ui, actions, clients, issues, ipamBody) }
        item { MtRankingCard(ui, actions, clients, wan) }
    }
}

@Composable
private fun MtKpi(label: String, value: String, sub: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: (() -> Unit)? = null) {
    OutlinedCard(modifier.then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(34.dp).background(color.copy(alpha = .1f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = color, modifier = Modifier.size(19.dp)) }
            Spacer(Modifier.width(8.dp))
            Column {
                Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                Text(value, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 1)
                Text(sub, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MtRouterHealthCard(system: JSONObject?, health: MtHealth) {
    val hasData = (system?.optJSONObject("resource")?.length() ?: 0) > 0
    MtCard {
        MtSectionTitle("Salud del router", "${health.board} · RouterOS ${health.version}", Icons.Outlined.Dns) { MtBadge(health.label, mtLevelColor(health.level)) }
        if (!hasData) {
            Text("El router aún no envía datos de recursos. Se actualizan solos cada pocos segundos.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf(health.cpu, health.memory, health.disk).forEach { metric ->
                    Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(progress = { ((metric.value ?: 0.0).coerceIn(0.0, 100.0) / 100).toFloat() }, modifier = Modifier.size(68.dp), strokeWidth = 7.dp,
                                color = if (metric.level == MtLevel.NONE) IspBlue else mtLevelColor(metric.level), trackColor = Color(0xFFE8EDE8))
                            Text(metric.display, fontWeight = FontWeight.Bold)
                        }
                        Text(metric.label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = if (metric.level == MtLevel.WARN || metric.level == MtLevel.CRIT) mtLevelColor(metric.level) else Color.Unspecified)
                        Text(metric.detail, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (health.reasons.isNotEmpty()) {
                Column(Modifier.fillMaxWidth().background(Color(0xFFFFF6E8), RoundedCornerShape(9.dp)).padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    health.reasons.forEach { reason -> Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.ErrorOutline, null, tint = IspAmber, modifier = Modifier.size(15.dp)); Spacer(Modifier.width(6.dp)); Text(reason, style = MaterialTheme.typography.bodySmall, color = Color(0xFF8A520E)) } }
                }
            }
            if (health.sensors.isNotEmpty()) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    health.sensors.forEach { sensor ->
                        val color = if (sensor.level == MtLevel.WARN || sensor.level == MtLevel.CRIT) mtLevelColor(sensor.level) else MaterialTheme.colorScheme.onSurface
                        Row(Modifier.background(color.copy(alpha = .07f), RoundedCornerShape(9.dp)).padding(horizontal = 8.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (sensor.kind == "temperature") Icons.Outlined.Thermostat else Icons.Outlined.Bolt, null, tint = color, modifier = Modifier.size(14.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("${sensor.label} ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(sensor.display, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = color)
                        }
                    }
                }
            } else {
                Text("Este modelo no informa temperatura ni voltaje.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HorizontalDivider()
            Row {
                MtDatum("Encendido", mtDuration(health.uptimeSeconds), Modifier.weight(1f))
                MtDatum("Arquitectura", health.architecture, Modifier.weight(1f))
            }
            if (health.cpuInfo.isNotBlank()) MtDatum("Procesador", health.cpuInfo)
        }
    }
}

@Composable
private fun MtNetworkIssuesCard(ui: MtUiState, actions: MtActions, clients: List<JSONObject>, issues: Map<String, List<JSONObject>>, ipam: JSONObject?) {
    var expanded by remember { mutableStateOf<String?>(null) }
    val groups = MT_ISSUE_ORDER.filter { issues[it].orEmpty().isNotEmpty() }
    val ipConflicts = ipam?.optJSONObject("conflicts")?.optJSONArray("ip")?.length() ?: 0
    val macConflicts = ipam?.optJSONObject("conflicts")?.optJSONArray("mac")?.length() ?: 0
    MtCard {
        MtSectionTitle("Inconsistencias de red", "Router comparado con WispHub · ${if (groups.isNotEmpty()) "${groups.size} tipos por revisar" else "sin pendientes"}", Icons.Outlined.WarningAmber)
        if (clients.isEmpty()) {
            Text("Esperando la lista de colas del router…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@MtCard
        }
        if (groups.isEmpty() && ipConflicts + macConflicts == 0) {
            Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen); Spacer(Modifier.width(8.dp)); Text("Todo coincide: no hay colas duplicadas, clientes sin cola ni colas sin cliente.", style = MaterialTheme.typography.bodySmall, color = IspGreen) }
        }
        groups.forEach { kind ->
            val rows = issues.getValue(kind)
            val info = MT_ISSUE_INFO.getValue(kind)
            var count = rows.size
            var unit = if (rows.size == 1) "equipo" else "equipos"
            if (kind == "dup-ip") { count = rows.map { it.mtStr("ip") }.toSet().size; unit = if (count == 1) "IP" else "IPs" }
            if (kind == "dup-mac") { count = rows.map { mtNormalizeMac(it.mtStr("macAddress")) }.toSet().size; unit = "MAC" }
            if (kind in listOf("no-queue", "no-ip", "saturated", "state-diff")) unit = if (rows.size == 1) "cliente" else "clientes"
            if (kind in listOf("no-client", "paused", "no-limit", "name-diff")) unit = if (rows.size == 1) "cola" else "colas"
            val color = mtIssueColor(info.level)
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().clickable { expanded = if (expanded == kind) null else kind }.heightIn(min = 48.dp).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(9.dp).background(color, CircleShape))
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) { Text(info.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold); Text(info.detail, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Text("$count $unit", fontWeight = FontWeight.Bold, color = if (info.level == "info") MaterialTheme.colorScheme.onSurface else color)
                    Icon(if (expanded == kind) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null)
                }
                if (expanded == kind) {
                    Column(Modifier.padding(start = 19.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        rows.take(8).forEach { row ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text(row.optJSONObject("client").mtStr("name") ?: row.mtStr("queueName") ?: "Sin nombre", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    Text(mtIssueExtra(kind, row), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                }
                                row.mtStr("ip")?.let { MtIpChip(it, actions) }
                            }
                        }
                        OutlinedButton(onClick = { ui.showIssue(kind) }, modifier = Modifier.heightIn(min = 44.dp)) { Text("Ver ${if (rows.size > 8) "los ${rows.size}" else "todos"} en Clientes y colas") }
                    }
                }
                HorizontalDivider()
            }
        }
        if (ipConflicts + macConflicts > 0) {
            Row(Modifier.fillMaxWidth().clickable { ui.openIpamConflicts() }.heightIn(min = 48.dp).padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(9.dp).background(IspRed, CircleShape))
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) { Text("Conflictos en el inventario IP", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold); Text("$ipConflicts IPs con varias MAC · $macConflicts MAC en varias IPs (DHCP y ARP)", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                Text("${ipConflicts + macConflicts}", fontWeight = FontWeight.Bold, color = IspRed)
                Icon(Icons.Outlined.ChevronRight, null)
            }
        }
        val okCount = MT_ISSUE_ORDER.size - groups.size
        if (okCount > 0) Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.CheckCircle, null, tint = IspGreen, modifier = Modifier.size(14.dp)); Spacer(Modifier.width(5.dp)); Text("$okCount revisiones sin problemas", style = MaterialTheme.typography.labelSmall, color = IspGreen) }
    }
}

private fun mtIssueExtra(kind: String, row: JSONObject): String {
    val client = row.optJSONObject("client")
    return when (kind) {
        "dup-mac", "dup-ip" -> "MAC ${row.mtStr("macAddress") ?: "desconocida"} · cola ${row.mtStr("queueName") ?: "-"}"
        "saturated" -> "${Math.round(mtUsage(row))}% del plan en uso"
        "no-client" -> "Cola ${row.mtStr("queueName").orEmpty()}${if (row.mtBool("isOnline")) " · en línea" else ""}"
        "name-diff" -> "Cola en el router: ${row.mtStr("queueName").orEmpty()}"
        "paused", "state-diff" -> "Cola ${row.mtStr("queueName").orEmpty()} deshabilitada"
        else -> client.mtStr("username") ?: client.mtStr("zone") ?: row.mtStr("queueName").orEmpty()
    }
}

@Composable
private fun MtRankingCard(ui: MtUiState, actions: MtActions, clients: List<JSONObject>, wan: JSONObject?) {
    val totalMode = ui.rankingMode == "total"
    val top = remember(clients, totalMode) {
        if (totalMode) clients.filter { it.mtNum("totalBytes") > 0 }.sortedByDescending { it.mtNum("totalBytes") }.take(10)
        else clients.filter { it.mtNum("uploadBps") + it.mtNum("downloadBps") > 0 }.sortedByDescending { it.mtNum("uploadBps") + it.mtNum("downloadBps") }.take(10)
    }
    val wanTotal = wan.mtNum("rxBps") + wan.mtNum("txBps")
    MtCard {
        MtSectionTitle("Ranking de consumo", if (!totalMode) "Tráfico de este momento por cola · se actualiza cada 15 s" else "Datos acumulados por cola desde su último reinicio de contadores", Icons.Outlined.People)
        Row(verticalAlignment = Alignment.CenterVertically) {
            SingleChoiceSegmentedButtonRow(Modifier.weight(1f)) {
                SegmentedButton(selected = !totalMode, onClick = { ui.rankingMode = "now" }, shape = SegmentedButtonDefaults.itemShape(0, 2)) { Text("Ahora") }
                SegmentedButton(selected = totalMode, onClick = { ui.rankingMode = "total" }, shape = SegmentedButtonDefaults.itemShape(1, 2)) { Text("Acumulado") }
            }
            TextButton(onClick = { ui.showTopConsumers() }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Ver todos") }
        }
        if (top.isEmpty()) Text(if (!totalMode) "Ningún cliente está transmitiendo en este momento" else "Aún no hay consumo acumulado en las colas", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        top.forEachIndexed { index, row ->
            val client = row.optJSONObject("client")
            val online = row.mtBool("isOnline")
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(28.dp).background(if (index < 3) IspGreen else Color(0xFFE8EDE8), CircleShape), contentAlignment = Alignment.Center) { Text("${index + 1}", color = if (index < 3) Color.White else Color.Unspecified, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold) }
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(client.mtStr("name") ?: row.mtStr("queueName") ?: "-", fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(client.mtStr("zone") ?: (if (client != null) "—" else "Cola sin cliente en WispHub"), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    MtBadge(if (online) "En línea" else "Sin conexión", if (online) IspGreen else IspRed)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    row.mtStr("ip")?.let { MtIpChip(it, actions) }
                    Spacer(Modifier.width(8.dp))
                    Text(client.mtStr("plan")?.let { mtPlanLabel(it) } ?: mtFormatLimit("${row.mtNum("maxUploadBps").toLong()}/${row.mtNum("maxDownloadBps").toLong()}"), style = MaterialTheme.typography.bodySmall)
                }
                if (!totalMode) {
                    val usage = mtUsage(row)
                    Row {
                        MtDatum("Subida", mtFormatBps(row.mtNum("uploadBps")), Modifier.weight(1f), IspGreen)
                        MtDatum("Descarga", mtFormatBps(row.mtNum("downloadBps")), Modifier.weight(1f), IspBlue)
                        MtDatum("Uso del plan", "${"%.0f".format(usage)}%", Modifier.weight(1f), if (usage >= 90) IspRed else Color.Unspecified)
                        MtDatum("Del WAN", "${"%.1f".format(if (wanTotal > 0) minOf(100.0, (row.mtNum("uploadBps") + row.mtNum("downloadBps")) / wanTotal * 100) else 0.0)}%", Modifier.weight(1f))
                    }
                    LinearProgressIndicator(progress = { (usage.coerceIn(0.0, 100.0) / 100).toFloat() }, modifier = Modifier.fillMaxWidth(), color = if (usage >= 90) IspRed else IspGreen)
                } else {
                    Row {
                        MtDatum("Subida acumulada", mtFormatBytes(row.mtNum("totalUploadBytes")), Modifier.weight(1f))
                        MtDatum("Descarga acumulada", mtFormatBytes(row.mtNum("totalDownloadBytes")), Modifier.weight(1f))
                        MtDatum("Total", mtFormatBytes(row.mtNum("totalBytes")), Modifier.weight(1f))
                    }
                }
                HorizontalDivider()
            }
        }
    }
}

@Composable
private fun MtGlobalSearch(ui: MtUiState, actions: MtActions, clients: List<JSONObject>, unknown: List<JSONObject>, ipamRows: List<JSONObject>) {
    val query = ui.searchQuery
    val all = remember(query, clients, unknown, ipamRows) { mtSearch(query, clients, unknown, ipamRows) }
    val hits = all.take(12)
    MtCard {
        MtSearchField(query, "Buscar cliente, usuario, IP, MAC o cola en todo el router") { ui.searchQuery = it }
        if (query.trim().length >= 2) {
            if (hits.isEmpty()) Text("No hay coincidencias para «${query.trim()}».${if (ipamRows.isEmpty()) " Abra «IPs libres» para buscar también en el inventario de IP." else ""}", style = MaterialTheme.typography.bodySmall)
            hits.forEach { hit ->
                val color = when (hit.kind) { "client" -> IspGreen; "no-client", "no-queue" -> IspAmber; "unknown" -> IspRed; "free" -> IspGreen; else -> Color(0xFF52646B) }
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        MtBadge(hit.badge, color)
                        Spacer(Modifier.weight(1f))
                        if (hit.rate.isNotEmpty()) Text(hit.rate, style = MaterialTheme.typography.labelMedium, color = IspBlue, fontWeight = FontWeight.Bold)
                    }
                    Text(hit.title, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (hit.subtitle.isNotBlank()) Text(hit.subtitle, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (hit.ip.isNotEmpty()) MtIpChip(hit.ip, actions)
                        TextButton(onClick = { ui.openSearchResult(hit.tab, hit.ip.ifEmpty { hit.title }) }, modifier = Modifier.heightIn(min = 48.dp)) {
                            Text(when (hit.tab) { "reconciliation" -> "Ver en colas"; "unknown" -> "Ver en desconocidos"; else -> "Ver en IPs" })
                        }
                    }
                    HorizontalDivider()
                }
            }
            if (all.size > hits.size) Text("Se muestran ${hits.size} de ${all.size} coincidencias. Escriba más para afinar.", style = MaterialTheme.typography.labelSmall)
            val sources = mutableListOf("${clients.size} colas y clientes")
            if (unknown.isNotEmpty()) sources += "${unknown.size} desconocidos"
            if (ipamRows.isNotEmpty()) sources += "${ipamRows.size} IPs del inventario"
            Text("Buscando en ${sources.joinToString(", ")}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
