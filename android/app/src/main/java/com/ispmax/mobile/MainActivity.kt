package com.ispmax.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.ispmax.mobile.onu.LocalOnuProbe
import com.ispmax.mobile.onu.ProbeResult
import com.ispmax.mobile.ui.PhoneLinks
import com.ispmax.mobile.ui.*
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import com.ispmax.mobile.data.DEFAULT_SERVER
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { IspTheme { IspApp() } }
    }
}

internal fun JSONObject.text(key: String, fallback: String = "Sin dato"): String =
    if (isNull(key)) fallback else optString(key).ifBlank { fallback }
internal fun JSONArray?.objects(): List<JSONObject> = if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }
internal fun money(value: Double) = "RD$ " + NumberFormat.getNumberInstance(Locale.US).apply { minimumFractionDigits = 2; maximumFractionDigits = 2 }.format(value)
private fun timestamp(value: Long) = if (value == 0L) "" else SimpleDateFormat("dd/MM HH:mm", Locale.getDefault()).format(Date(value))
private fun encode(value: String) = URLEncoder.encode(value, "UTF-8")
private fun can(role: String, vararg allowed: String) = role in listOf("admin", "super_admin") || role in allowed
private data class Destination(val key: String, val label: String, val icon: ImageVector)
private val destinations = listOf(Destination("home", "Inicio", Icons.Outlined.SpaceDashboard), Destination("clients", "Clientes", Icons.Outlined.PeopleOutline), Destination("network", "Red", Icons.Outlined.Hub), Destination("billing", "Cobros", Icons.Outlined.AccountBalanceWallet), Destination("more", "Mas", Icons.Outlined.GridView))

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun IspApp(vm: MainViewModel = viewModel()) {
    val app by vm.app.collectAsStateWithLifecycle()
    val pages by vm.pages.collectAsStateWithLifecycle()
    var section by rememberSaveable { mutableStateOf("home") }
    var route by rememberSaveable { mutableStateOf("") }
    var clientId by rememberSaveable { mutableStateOf(0) }
    var screenOwner by rememberSaveable { mutableStateOf("") }
    var tr069Serial by rememberSaveable { mutableStateOf("") }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    LaunchedEffect(section, route, clientId) { focus.clearFocus(); keyboard?.hide() }
    if (!app.ready) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    if (app.user == null) { Login(app, vm::login); return }
    val user = app.user!!
    val role = user.text("role", "viewer")
    val visible = destinations.filter { it.key != "billing" || can(role, "cobranza") }.filter { it.key != "network" || can(role, "tecnico") }
    LaunchedEffect(app.server, user.optInt("id")) {
        val owner = "${app.server}|${user.optInt("id")}"
        if (screenOwner != owner) { section = "home"; route = ""; clientId = 0; screenOwner = owner }
    }
    val back: () -> Unit = { if (clientId != 0) clientId = 0 else route = "" }
    BackHandler(clientId != 0 || route.isNotEmpty(), back)
    val title = if (clientId != 0) "Expediente #$clientId" else if (route == "sessions") "Sesiones moviles" else if (route.startsWith("plan-clients:")) "Clientes · ${route.removePrefix("plan-clients:")}" else if (section == "home" && route.isEmpty()) "ISP Max" else labels[route] ?: visible.firstOrNull { it.key == section }?.label ?: "ISP Max"
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 720.dp
        Row {
            if (wide) NavigationRail {
                Spacer(Modifier.height(20.dp))
                visible.forEach { item -> NavigationRailItem(selected = section == item.key, onClick = { section = item.key; route = ""; clientId = 0 }, icon = { NavigationGlyph(item.icon, item.label, section == item.key) }, label = { Text(item.label) }) }
            }
            Scaffold(modifier = Modifier.weight(1f), containerColor = MaterialTheme.colorScheme.background,
                topBar = { TopAppBar(title = { Text(title, fontWeight = FontWeight.SemiBold) },
                    navigationIcon = { if (clientId != 0 || route.isNotEmpty()) IconButton(onClick = back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Volver") } },
                    actions = { if (section == "home") Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = CircleShape, modifier = Modifier.padding(end = 16.dp)) { Text(user.text("username").take(2).uppercase(), Modifier.padding(10.dp), color = IspGreen, fontWeight = FontWeight.Bold) } }) },
                bottomBar = { if (!wide) NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                    visible.forEach { item -> NavigationBarItem(selected = section == item.key, onClick = { section = item.key; route = ""; clientId = 0 }, icon = { NavigationGlyph(item.icon, item.label, section == item.key) }, label = { Text(item.label, maxLines = 1, fontSize = 11.sp) }) }
                } }
            ) { padding ->
                Box(Modifier.padding(padding).fillMaxSize()) {
                    val current = if (clientId != 0) "client-$clientId" else route.ifBlank { section }
                    key(app.server, user.optInt("id")) {
                    val screenStates = rememberSaveableStateHolder()
                    AnimatedContent(targetState = current, transitionSpec = { fadeIn(tween(180)) togetherWith fadeOut(tween(100)) }, label = "pantalla") { target ->
                        screenStates.SaveableStateProvider(target) {
                        when {
                            target.startsWith("client-") -> ClientDetail(target.removePrefix("client-").toInt(), role, vm, pages, app.capabilities?.optJSONObject("capabilities"))
                            target == "home" -> Overview(vm, pages["/overview"] ?: PageState(), onClients = { section = "clients" }, onNetwork = { section = "network" }, role = role, pages = pages, onIncidents = { section = "network"; route = "incidents" })
                            target == "clients" -> Collection("clients", vm, pages, onClient = { clientId = it })
                            target == "billing" -> MenuPage((if (app.capabilities?.optJSONObject("capabilities")?.optBoolean("collectionsQueue") == true) listOf("collection-queue") else emptyList()) + listOf("invoices", "pending") + (if (app.capabilities?.optJSONObject("capabilities")?.optBoolean("paymentsWrite") == true) listOf("payment-requests") else emptyList()) + (if (app.capabilities?.optJSONObject("capabilities")?.optBoolean("promisesWrite") == true) listOf("promises") else emptyList()) + (if (app.capabilities?.optJSONObject("capabilities")?.optBoolean("billingReport") == true) listOf("billing-report") else emptyList()), onOpen = { route = it })
                            target == "collection-queue" -> CollectionQueueScreen(vm, pages, role, app.capabilities?.optJSONObject("capabilities"), onClient = { clientId = it })
                            target == "surveys" -> SurveysScreen(vm, pages, onClient = { clientId = it })
                            target == "tickets" -> TicketsScreen(vm, pages, canWrite = app.capabilities?.optJSONObject("capabilities")?.optBoolean("ticketWrite") == true)
                            target.startsWith("plan-clients:") -> Collection("clients", vm, pages, onClient = { clientId = it }, initialFilters = "&plan=" + encode(target.removePrefix("plan-clients:")))
                            target == "payment-requests" -> PaymentRequestsScreen(vm, pages)
                            target == "promises" -> PromisesScreen(vm, pages)
                            target == "billing-report" -> BillingReportScreen(vm, pages)
                            target == "network" -> NetworkHome(vm, pages, app.capabilities?.optJSONObject("capabilities"), open = { route = it })
                            target == "more" -> More(user, app.server, role, { route = it }, vm::logout)
                            target == "onu-local" -> OnuReadiness()
                            target == "onus" -> OltScreen(vm, pages, onTr069 = { tr069Serial = it }, onClient = { clientId = it }, onOnuProvisioner = { _, _, _ -> route = "onu-provisioner" })
                            target == "onu-provisioner" -> OnuProvisionerScreen(vm, pages, onLocalProbe = { route = "onu-local" })
                            target == "incidents" -> IncidentsScreen(vm, pages, role)
                            target == "network-audit" -> NetworkAuditScreen(vm, pages)
                            target == "live" -> LiveNetworkScreen(vm, pages, onClient = { clientId = it })
                            target == "mikrotik" -> MikrotikAdminScreen(vm, pages)
                            target == "wan-history" -> WanHistoryScreen(vm, pages)
                            target == "ipam" -> IpamScreen(vm, pages)
                            target == "ip-ranges" -> IpRangeSettingsScreen(vm)
                            target == "map" -> ClientMapScreen(vm, pages)
                            target == "system" -> SystemStatusScreen(vm, pages)
                            target == "whatsapp" -> WhatsappScreen(vm, pages, onClient = { clientId = it })
                            target == "plans" -> PlansScreen(vm, pages, onPlanClients = { plan -> route = "plan-clients:$plan" })
                            target == "expenses" -> ExpensesScreen(vm, pages)
                            target == "inventory" && app.capabilities?.optJSONObject("capabilities")?.optBoolean("equipmentWrite") == true -> InventoryScreen(vm, pages)
                            target == "payroll" && app.capabilities?.optJSONObject("capabilities")?.optBoolean("payrollWrite") == true -> PayrollScreen(vm, pages)
                            target == "users" && app.capabilities?.optJSONObject("capabilities")?.optBoolean("usersManage") == true -> UsersScreen(vm, pages)
                            target == "sessions" -> MobileSessionsScreen(vm, pages)
                            target == "web-settings" -> WebParitySettingsScreen(vm, pages, role)
                            target == "web-whatsapp" -> WebParityWhatsappScreen(vm, pages, role)
                            target == "web-surveys" -> WebParitySurveysScreen(vm, pages, role, onClient = { clientId = it })
                            target == "web-bandwidth" -> WebParityBandwidthScreen(vm, pages, role)
                            target == "web-reports" -> WebParityReportsScreen(vm, pages, role)
                            target == "web-operations" -> WebParityOperationsScreen(vm, pages, role)
                            else -> Collection(target, vm, pages, onClient = { clientId = it })
                        }
                    }
                    }
                    }
                }
            }
        }
    }
    if (tr069Serial.isNotBlank()) Tr069Console(tr069Serial, vm, pages, onClose = { tr069Serial = "" })
}

@Composable private fun Login(state: AppState, onLogin: (String, String, String) -> Unit) {
    var server by rememberSaveable { mutableStateOf(state.server.ifBlank { DEFAULT_SERVER }) }
    var username by rememberSaveable { mutableStateOf("") }
    // Password intentionally stays out of saved instance state and disk.
    var password by remember { mutableStateOf("") }
    var showPassword by remember { mutableStateOf(false) }
    var advanced by rememberSaveable { mutableStateOf(false) }
    val keyboard = LocalSoftwareKeyboardController.current
    val focus = LocalFocusManager.current
    val submit = { focus.clearFocus(); keyboard?.hide(); onLogin(server, username, password) }
    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface), contentAlignment = Alignment.Center) {
        Column(Modifier.widthIn(max = 440.dp).fillMaxWidth().verticalScroll(rememberScrollState()).imePadding().padding(28.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                ReliefIcon(Icons.Outlined.Wifi, size = 64.dp)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("ISP Max", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text("Acceso del personal", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.Cloud, null, tint = IspBlue, modifier = Modifier.size(18.dp))
                Text(if (server == DEFAULT_SERVER) "Nube ISP Max" else "Servidor personalizado", style = MaterialTheme.typography.labelLarge, color = IspBlue)
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(username, { username = it }, label = { Text("Usuario") }, leadingIcon = { Icon(Icons.Outlined.PersonOutline, null) }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !state.busy, keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
            OutlinedTextField(password, { password = it }, label = { Text("Contrasena") }, leadingIcon = { Icon(Icons.Outlined.Lock, null) }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !state.busy,
                visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { if (!state.busy && username.isNotBlank() && password.isNotBlank()) submit() }),
                trailingIcon = { IconButton(onClick = { showPassword = !showPassword }) { Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility, "Mostrar u ocultar contrasena") } })
            if (state.error != null) Notice(state.error, error = true)
            Button(onClick = submit, enabled = !state.busy && username.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().height(52.dp)) {
                if (state.busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp) else { Icon(Icons.Outlined.Login, null, Modifier.size(20.dp)); Spacer(Modifier.width(10.dp)); Text("Iniciar sesion") }
            }
            if (BuildConfig.DEBUG) TextButton(onClick = { advanced = !advanced }, modifier = Modifier.align(Alignment.CenterHorizontally)) { Icon(Icons.Outlined.Dns, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Servidor QA") }
            AnimatedVisibility(BuildConfig.DEBUG && advanced) {
                Column {
                    OutlinedTextField(server, { server = it }, label = { Text("URL de ISP Max") }, modifier = Modifier.fillMaxWidth(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri), enabled = !state.busy)
                    TextButton(onClick = { server = DEFAULT_SERVER }, enabled = !state.busy) { Icon(Icons.Outlined.Restore, null); Spacer(Modifier.width(8.dp)); Text("Usar nube ISP Max") }
                }
            }
            HorizontalDivider()
            Text("Android  /  ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

@Composable internal fun Notice(text: String, error: Boolean = false) {
    Row(Modifier.fillMaxWidth().background(if (error) MaterialTheme.colorScheme.errorContainer else Color(0xFFFFF1D6), MaterialTheme.shapes.small).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(if (error) Icons.Outlined.ErrorOutline else Icons.Outlined.Info, null, modifier = Modifier.size(20.dp))
        Text(text, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable internal fun ReadStatus(state: PageState, retry: () -> Unit) {
    if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
    if (state.cached) Notice("Sin conexion. Copia guardada: ${timestamp(state.savedAt)}")
    state.error?.let { Notice(it, true); TextButton(onClick = retry) { Icon(Icons.Outlined.Refresh, null); Text("Reintentar") } }
}

@Composable private fun Overview(vm: MainViewModel, state: PageState, onClients: () -> Unit, onNetwork: () -> Unit, role: String, pages: Map<String, PageState> = emptyMap(), onIncidents: () -> Unit = onNetwork) {
    LaunchedEffect(Unit) { vm.load("/overview", true) }
    val data = state.body
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text("Resumen operativo", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text("${timestamp(state.savedAt)}  ·  SQLite", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            IconButton(onClick = { vm.load("/overview", true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar resumen") }
        }
        ReadStatus(state) { vm.load("/overview", true) }
        if (data != null) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Metric("Clientes", data.text("clients"), Icons.Outlined.PeopleOutline, IspBlue, Modifier.weight(1f), onClients)
                Metric("Activos", data.text("active"), Icons.Outlined.CheckCircleOutline, IspGreen, Modifier.weight(1f), onClients)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Metric("Suspendidos", data.text("suspended"), Icons.Outlined.PauseCircleOutline, IspAmber, Modifier.weight(1f), onClients)
                if (data.has("incidents")) Metric("Incidencias", data.text("incidents"), Icons.Outlined.WarningAmber, IspRed, Modifier.weight(1f), onNetwork)
            }
            Text("Estado de clientes", style = MaterialTheme.typography.titleMedium)
            val total = data.optInt("clients").coerceAtLeast(1).toFloat()
            val active = data.optInt("active").toFloat() / total
            val suspended = data.optInt("suspended").toFloat() / total
            Canvas(Modifier.fillMaxWidth().height(12.dp)) {
                drawRect(Color(0xFFDCE4E7))
                drawRect(IspGreen, size = size.copy(width = size.width * active.coerceIn(0f, 1f)))
                drawRect(IspAmber, topLeft = androidx.compose.ui.geometry.Offset(size.width * active, 0f), size = size.copy(width = size.width * suspended.coerceIn(0f, 1f - active.coerceIn(0f, 1f))))
            }
            Text("${data.text("active")} activos · ${data.text("suspended")} suspendidos · ${data.optInt("clients") - data.optInt("active") - data.optInt("suspended")} otros", style = MaterialTheme.typography.bodySmall)
            data.optJSONObject("wan")?.let { wan ->
                HorizontalDivider()
                Text("Enlace WAN", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Value("RX", "%.2f Mbps".format(wan.optDouble("rxBps", 0.0) / 1e6), Modifier.weight(1f))
                    Value("TX", "%.2f Mbps".format(wan.optDouble("txBps", 0.0) / 1e6), Modifier.weight(1f))
                }
                Text("${wan.text("ifaceName")} · Muestra ${wan.text("capturedAt")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            data.optJSONObject("billing")?.let { billing ->
                HorizontalDivider(); Text("Cartera historica", style = MaterialTheme.typography.titleMedium)
                Value("Facturado", money(billing.optDouble("billed", 0.0)))
                Value("Cobrado", money(billing.optDouble("collected", 0.0)))
                Value("Saldo registrado", money(billing.optDouble("balance", 0.0)))
            }
            if (can(role, "tecnico")) { HorizontalDivider(); MenuRow("OLT y ONU", "${data.text("onusOnline")} en linea de ${data.text("onus")}", Icons.Outlined.Hub, onNetwork) }
            WebParityDashboardPanel(vm, pages, role, onIncidents = onIncidents)
        } else if (!state.loading && state.error == null) EmptyState("Sin datos disponibles")
    }
}

@Composable private fun Metric(label: String, value: String, icon: ImageVector, color: Color, modifier: Modifier, onClick: () -> Unit) {
    OutlinedCard(onClick = onClick, modifier = modifier, colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            ReliefIcon(icon, color, 40.dp)
            Text(value, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private val labels = mapOf("onu-provisioner" to "Configurar ONU", "web-settings" to "Configuracion", "web-whatsapp" to "WhatsApp: conexion y envios", "web-surveys" to "Gestion de encuestas", "web-bandwidth" to "Prueba de velocidad", "web-reports" to "Reportes de cartera", "web-operations" to "Sincronizacion", "collection-queue" to "Cola de cobranza", "surveys" to "Encuestas", "tickets" to "Tickets", "payment-requests" to "Solicitudes de pago", "billing-report" to "Reporte de facturacion", "promises" to "Promesas de pago", "invoices" to "Facturas", "pending" to "Saldos pendientes", "onus" to "OLT y ONU", "incidents" to "Incidencias", "network-audit" to "Estabilidad de clientes", "live" to "Monitoreo en vivo", "mikrotik" to "MikroTik", "wan-history" to "Historico WAN", "ipam" to "Direcciones IP", "ip-ranges" to "Rangos IP locales", "map" to "Mapa de clientes", "system" to "Estado del sistema", "whatsapp" to "WhatsApp", "plans" to "Planes", "inventory" to "Inventario", "expenses" to "Gastos", "payroll" to "Nomina", "users" to "Usuarios", "onu-local" to "Prueba local de ONU")
private val moduleIcons = mapOf("onu-provisioner" to Icons.Outlined.SettingsInputAntenna, "web-settings" to Icons.Outlined.Settings, "web-whatsapp" to Icons.Outlined.QrCode2, "web-surveys" to Icons.Outlined.FactCheck, "web-bandwidth" to Icons.Outlined.Speed, "web-reports" to Icons.Outlined.Assessment, "web-operations" to Icons.Outlined.CloudSync, "collection-queue" to Icons.Outlined.PendingActions, "surveys" to Icons.Outlined.Poll, "tickets" to Icons.Outlined.ConfirmationNumber, "invoices" to Icons.Outlined.ReceiptLong, "pending" to Icons.Outlined.AccountBalanceWallet, "onus" to Icons.Outlined.Hub, "incidents" to Icons.Outlined.WarningAmber, "network-audit" to Icons.Outlined.QueryStats, "live" to Icons.Outlined.Podcasts, "mikrotik" to Icons.Outlined.Router, "wan-history" to Icons.Outlined.ShowChart, "ipam" to Icons.Outlined.Lan, "ip-ranges" to Icons.Outlined.AccountTree, "map" to Icons.Outlined.Map, "system" to Icons.Outlined.SettingsSuggest, "whatsapp" to Icons.Outlined.Chat, "plans" to Icons.Outlined.Speed, "inventory" to Icons.Outlined.Inventory2, "expenses" to Icons.Outlined.Payments, "payroll" to Icons.Outlined.Badge, "users" to Icons.Outlined.ManageAccounts, "onu-local" to Icons.Outlined.Router)

@Composable private fun MenuPage(keys: List<String>, onOpen: (String) -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        keys.forEach { key -> MenuRow(labels[key] ?: key, when (key) { "onu-local" -> "Compatibilidad Android"; "collection-queue" -> "Quien debe, WhatsApp, cobro y corte"; else -> "" }, if (key == "payment-requests") Icons.Outlined.Payments else if (key == "promises") Icons.Outlined.EventAvailable else if (key == "billing-report") Icons.Outlined.BarChart else moduleIcons[key] ?: Icons.Outlined.Folder, { onOpen(key) }) }
    }
}
@Composable internal fun MenuRow(title: String, subtitle: String, icon: ImageVector, click: () -> Unit) {
    val tint = when (title) { "Facturas", "Gastos", "Saldos pendientes", "Nomina" -> IspBlue; "Incidencias" -> IspAmber; else -> IspGreen }
    OutlinedCard(onClick = click, modifier = Modifier.fillMaxWidth(), colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        ListItem(headlineContent = { Text(title, fontWeight = FontWeight.SemiBold) }, supportingContent = if (subtitle.isBlank()) null else ({ Text(subtitle) }), leadingContent = { ReliefIcon(icon, tint, 40.dp) }, trailingContent = { Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant) }, modifier = Modifier.padding(vertical = 6.dp), colors = ListItemDefaults.colors(containerColor = Color.Transparent))
    }
}
@Composable private fun More(user: JSONObject, server: String, role: String, open: (String) -> Unit, logout: () -> Unit) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(user.text("fullName", user.text("username")), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(role, color = IspGreen)
        Text(server, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        HorizontalDivider()
        val modules = listOf("plans", "system") +
            (if (can(role, "tecnico")) listOf("map") else emptyList()) +
            (if (can(role, "tecnico")) listOf("tickets") else emptyList()) +
            (if (can(role, "cobranza")) listOf("whatsapp", "web-whatsapp", "surveys", "web-surveys") else emptyList()) +
            listOf("web-reports") +
            (if (can(role, "tecnico")) listOf("web-operations") else emptyList())
        (modules + if (can(role)) listOf("inventory", "expenses", "payroll", "users") else emptyList()).forEach { key -> MenuRow(labels.getValue(key), "", moduleIcons.getValue(key), { open(key) }) }
        if (can(role)) MenuRow(labels.getValue("ip-ranges"), "Segmentos usados al crear clientes", moduleIcons.getValue("ip-ranges"), { open("ip-ranges") })
        if (can(role)) MenuRow("Sesiones moviles", "Acceso desde celulares", Icons.Outlined.PhonelinkLock, { open("sessions") })
        if (can(role)) MenuRow(labels.getValue("web-settings"), "Empresa, avisos, corte y sistema", moduleIcons.getValue("web-settings"), { open("web-settings") })
        HorizontalDivider()
        TextButton(onClick = logout) { Icon(Icons.AutoMirrored.Outlined.Logout, null); Spacer(Modifier.width(8.dp)); Text("Cerrar sesion") }
        Text("Version ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable private fun Collection(kind: String, vm: MainViewModel, pages: Map<String, PageState>, onClient: (Int) -> Unit, fixedClient: Int? = null, pon: JSONObject? = null, initialFilters: String = "") {
    val app by vm.app.collectAsStateWithLifecycle()
    val filtersAvailable = app.capabilities?.optJSONObject("capabilities")?.optBoolean("advancedFilters") == true
    var search by rememberSaveable(kind, fixedClient) { mutableStateOf("") }
    var committed by rememberSaveable(kind, fixedClient) { mutableStateOf("") }
    var status by rememberSaveable(kind) { mutableStateOf("") }
    var page by rememberSaveable(kind, fixedClient) { mutableIntStateOf(1) }
    var selectedJson by rememberSaveable(kind, fixedClient) { mutableStateOf<String?>(null) }
    var documentId by rememberSaveable(kind, fixedClient) { mutableIntStateOf(0) }
    var paymentId by rememberSaveable(kind, fixedClient) { mutableIntStateOf(0) }
    var filters by rememberSaveable(kind, fixedClient, initialFilters) { mutableStateOf(initialFilters) }
    var filterDialog by rememberSaveable(kind, fixedClient) { mutableStateOf(false) }
    var newClient by rememberSaveable(kind) { mutableStateOf(false) }
    val invoice = kind == "invoices" || kind == "pending"
    val filteredQuery = buildString {
        append("q=${encode(committed)}")
        if (filtersAvailable) append(filters)
        if (fixedClient != null) append("&clientId=$fixedClient")
        if (kind == "pending") append("&pending=true")
        if (status.isNotEmpty()) append("&status=${encode(status)}")
        if (pon != null) append("&rack=${pon.optInt("rack")}&shelf=${pon.optInt("shelf")}&pon=${pon.optInt("pon")}")
    }
    val path = buildString {
        append(if (kind == "clients") "/clients" else if (invoice) "/invoices" else "/catalog/$kind")
        append("?$filteredQuery&page=$page&pageSize=30")
    }
    LaunchedEffect(search) { if (search != committed) { delay(350); committed = search; page = 1 } }
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    val list = rememberLazyListState()
    var lastListKey by rememberSaveable { mutableStateOf("$page|$committed|$status") }
    LaunchedEffect(page, committed, status, filters) {
        val next = "$page|$committed|$status|$filters"
        if (lastListKey != next) { list.scrollToItem(0); lastListKey = next }
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (kind == "clients" && app.capabilities?.optJSONObject("capabilities")?.optBoolean("clientProvisioningWrite") == true) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button(onClick = { newClient = true }) { Icon(Icons.Outlined.PersonAdd, null); Spacer(Modifier.width(8.dp)); Text("Nuevo cliente") }
        }
        OutlinedTextField(search, { search = it }, singleLine = true, label = { Text(if (kind == "clients") "Nombre, IP, telefono o serial" else "Buscar") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth(), trailingIcon = { if (search.isNotEmpty()) IconButton(onClick = { search = "" }) { Icon(Icons.Outlined.Close, "Limpiar busqueda") } })
        if (filtersAvailable && (invoice || kind == "clients")) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedButton(onClick = { filterDialog = true }) { Icon(Icons.Outlined.FilterAlt, null); Spacer(Modifier.width(6.dp)); Text(if (filters.isBlank()) "Mas filtros" else "Filtros aplicados") }
            if (filters.isNotBlank()) IconButton(onClick = { filters = ""; page = 1 }) { Icon(Icons.Outlined.FilterAltOff, "Limpiar filtros avanzados") }
        }
        if (invoice) state.body?.optJSONObject("summary")?.let { totals ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("billed" to "Facturado", "collected" to "Cobrado", "balance" to "Saldo").forEach { (key, label) -> Column(Modifier.weight(1f)) {
                    Text(label, modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelSmall, maxLines = 1)
                    Text(money(totals.optDouble(key)), modifier = Modifier.fillMaxWidth(), style = MaterialTheme.typography.labelMedium)
                } }
            }
            HorizontalDivider()
        }
        if (kind == "clients") Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("" to "Todos", "Activo" to "Activos", "Suspendido" to "Suspendidos").forEach { (value, label) -> FilterChip(status == value, { status = value; page = 1 }, label = { Text(label) }) }
        }
        if (kind == "invoices") Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("" to "Todas", "Pagada" to "Pagadas", "Pendiente de Pago" to "Pendientes").forEach { (value, label) -> FilterChip(status == value, { status = value; page = 1 }, label = { Text(label) }) }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(state.body?.let { "${it.optInt("total")} resultados" } ?: if (state.loading) "Consultando..." else "Sin consulta disponible", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar listado") }
            ExportButton(rows, labels[kind] ?: "Clientes", if (kind == "clients" || invoice) ({
                val section = if (kind == "clients") "clients" else "invoices"
                vm.exportRows("/exports/$section?$filteredQuery").objects()
            }) else null)
        }
        ReadStatus(state) { vm.load(path, true) }
        if (rows.isEmpty() && !state.loading && state.error == null) EmptyState("No hay resultados para esta busqueda")
        LazyColumn(Modifier.weight(1f), state = list, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 12.dp)) {
            items(rows, key = { it.text(if (kind == "clients") "idServicio" else if (invoice) "idFactura" else state.body?.text("idField", "id") ?: "id") }) { row ->
                val title = when { kind == "clients" -> row.text("aliasNombre", row.text("nombre")); invoice -> row.text("clienteNombre"); kind == "onus" -> row.text("name", row.text("serial")); else -> row.text(state.body?.text("titleField", "id") ?: "id") }
                val subtitle = when { kind == "clients" -> "${row.text("ip")} · ${row.text("planInternetName")}"; invoice -> "#${row.text("idFactura")} · ${money(row.optDouble("total", 0.0))}"; kind == "onus" -> "${row.text("onuIndex")} · ${row.text("serial")}"; else -> row.text("status", row.text("estado", row.text("tipo", "#${row.text("id")}"))) }
                OutlinedCard(onClick = { if (kind == "clients") onClient(row.optInt("idServicio")) else selectedJson = row.toString() }, colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Row(Modifier.fillMaxWidth().padding(14.dp), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (kind == "clients") Box(Modifier.size(40.dp).background(MaterialTheme.colorScheme.primaryContainer, MaterialTheme.shapes.small), contentAlignment = Alignment.Center) { Text(title.take(2).uppercase(), color = IspGreen, fontWeight = FontWeight.Bold) }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Text(title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(catalogValue("status", subtitle), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            if (kind == "expenses") Text(money(row.optDouble("amount", 0.0)), fontWeight = FontWeight.Medium)
                            if (kind == "payroll") Text(money(row.optDouble("netAmount", 0.0)), fontWeight = FontWeight.Medium)
                            if (row.has("estado")) StatusBadge(row.text("estado"))
                            if (kind == "onus") { StatusBadge(if (row.optBoolean("online")) "En linea" else "Sin conexion"); Text("RX ${row.text("rxPowerDbm")} dBm", style = MaterialTheme.typography.bodySmall) }
                        }
                        Icon(Icons.Outlined.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
            Text("Pagina $page", style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
        }
    }
    selectedJson?.let { json -> val row = JSONObject(json); DetailsDialog(row, labels[kind] ?: kind,
        document = if (invoice) ({ documentId = row.optInt("idFactura"); selectedJson = null }) else null,
        payment = if (invoice && app.capabilities?.optJSONObject("capabilities")?.optBoolean("paymentsWrite") == true) ({ paymentId = row.optInt("idFactura"); selectedJson = null }) else null,
        close = { selectedJson = null }) }
    if (paymentId > 0) PaymentScreen(paymentId, vm, onDocument = { documentId = paymentId; paymentId = 0 }, close = { paymentId = 0; vm.load(path, true) })
    if (documentId > 0) InvoiceDocumentDialog(documentId, vm, pages) { documentId = 0 }
    if (filterDialog) CollectionFilters(invoice, filters, { filters = it; page = 1; filterDialog = false }, { filterDialog = false })
    if (newClient) NewClientEditor(vm, pages) { id -> newClient = false; if (id != null) onClient(id) else vm.load(path, true) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ClientDetail(id: Int, role: String, vm: MainViewModel, pages: Map<String, PageState>, capabilities: JSONObject? = null) {
    val equipmentWrite = capabilities?.optBoolean("equipmentWrite") == true
    val recordsWrite = capabilities?.optBoolean("clientRecordsWrite") == true
    val promisesWrite = capabilities?.optBoolean("promisesWrite") == true
    val serviceActions = capabilities?.optBoolean("clientServiceActions") == true
    val gpsWrite = capabilities?.optBoolean("gpsWrite") == true
    val linkTest = capabilities?.optBoolean("linkTest") == true
    val clientContext = LocalContext.current
    val externalWrite = capabilities?.optBoolean("clientExternalWrite") == true
    val path = "/clients/$id"
    LaunchedEffect(id) { vm.load(path, true) }
    val state = pages[path] ?: PageState(loading = true)
    var tab by rememberSaveable(id) { mutableIntStateOf(0) }
    var wallet by rememberSaveable(id) { mutableStateOf(false) }
    var note by remember { mutableStateOf(false) }
    var manageEquipment by rememberSaveable(id) { mutableStateOf(false) }
    var editRecord by rememberSaveable(id) { mutableStateOf(false) }
    var managePromises by rememberSaveable(id) { mutableStateOf(false) }
    var manageService by rememberSaveable(id) { mutableStateOf(false) }
    var linkTestOpen by rememberSaveable(id) { mutableStateOf(false) }
    var editGps by rememberSaveable(id) { mutableStateOf(false) }
    var editExternal by rememberSaveable(id) { mutableStateOf<String?>(null) }
    val client = state.body?.optJSONObject("client")
    if (managePromises && promisesWrite) {
        BackHandler { managePromises = false }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Promesas del cliente", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                IconButton(onClick = { managePromises = false }) { Icon(Icons.Outlined.Close, "Cerrar promesas del cliente") }
            }
            Box(Modifier.weight(1f)) { PromisesScreen(vm, pages, clientId = id) }
        }
        return
    }
    if (manageEquipment && equipmentWrite && can(role)) {
        BackHandler { manageEquipment = false }
        Column(Modifier.fillMaxSize()) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Equipos del cliente", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                IconButton(onClick = { manageEquipment = false }) { Icon(Icons.Outlined.Close, "Cerrar inventario del cliente") }
            }
            Box(Modifier.weight(1f)) { EquipmentScreen(vm, pages, clientId = id) }
        }
        return
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) { Text(client?.text("aliasNombre", client.text("nombre")) ?: "Cliente #$id", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); client?.let { StatusBadge(it.text("estado")) } }
            IconButton(onClick = { vm.load(path, true) }) { Icon(Icons.Outlined.Refresh, "Actualizar expediente") }
        }
        if (can(role, "cobranza")) TextButton(onClick = { wallet = true }, modifier = Modifier.padding(horizontal = 8.dp)) { Icon(Icons.Outlined.AccountBalanceWallet, null); Spacer(Modifier.width(8.dp)); Text("Abrir cartera y facturas") }
        if (serviceActions) TextButton(onClick = { manageService = true }, modifier = Modifier.padding(horizontal = 8.dp)) { Icon(Icons.Outlined.Router, null); Spacer(Modifier.width(8.dp)); Text("Administrar servicio") }
        // Contacto directo y prueba del enlace, igual que en el expediente web.
        // optString convierte null en el texto "null": se usa text() para respetar los vacios.
        val phone = client?.text("aliasTelefono", "")?.takeIf(String::isNotBlank) ?: client?.text("telefono", "")
        if (PhoneLinks.international(phone) != null || linkTest) Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (PhoneLinks.international(phone) != null) {
                OutlinedButton(onClick = { PhoneLinks.openDialer(clientContext, phone) }) { Icon(Icons.Outlined.Call, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Llamar") }
                OutlinedButton(onClick = { PhoneLinks.openWhatsapp(clientContext, phone, null) }) { Icon(Icons.Outlined.Chat, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("WhatsApp") }
            }
            if (linkTest && client?.optString("ip").orEmpty().isNotBlank()) OutlinedButton(onClick = { linkTestOpen = true }) { Icon(Icons.Outlined.NetworkCheck, null, Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Probar enlace") }
        }
        PrimaryScrollableTabRow(tab.coerceAtMost(if (recordsWrite) 5 else 4), edgePadding = 0.dp) { (listOf("Datos", "Servicio", "Equipos", "Notas") + (if (recordsWrite) listOf("Historial") else emptyList()) + listOf("Más")).forEachIndexed { index, label -> Tab(selected = tab == index, onClick = { tab = index }, text = { Text(label, maxLines = 1, fontSize = 13.sp) }) } }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            ReadStatus(state) { vm.load(path, true) }
            if (client != null) when (tab) {
                0 -> {
                    if (externalWrite) Button(onClick = { editExternal = "profile" }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.CloudSync, null); Spacer(Modifier.width(8.dp)); Text("Editar datos en WispHub") }
                    if (recordsWrite) OutlinedButton(onClick = { editRecord = true }) { Icon(Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text("Editar expediente local") }
                    if (gpsWrite) OutlinedButton(onClick = { editGps = true }) { Icon(Icons.Outlined.MyLocation, null); Spacer(Modifier.width(8.dp)); Text("Ubicacion GPS") }
                    listOf("usuario", "telefono", "email", "cedula", "direccion", "zonaNombre").forEach { Value(fieldLabels[it] ?: it, client.text(if (it == "telefono") "aliasTelefono" else if (it == "cedula") "aliasCedula" else it, client.text(it))) }
                    if (!client.isNull("gpsLat") && !client.isNull("gpsLng")) Value("GPS tecnico", "${client.optDouble("gpsLat")}, ${client.optDouble("gpsLng")} · precision ${client.text("gpsAccuracy", "sin dato")} m")
                    if (!client.isNull("aliasNotas")) Value("Observaciones locales", client.text("aliasNotas"))
                    if (promisesWrite) OutlinedButton(onClick = { managePromises = true }) { Icon(Icons.Outlined.EventAvailable, null); Spacer(Modifier.width(8.dp)); Text("Promesas del cliente") }
                }
                1 -> {
                    if (externalWrite) Button(onClick = { editExternal = "service" }, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.SettingsEthernet, null); Spacer(Modifier.width(8.dp)); Text("Editar servicio en WispHub") }
                    listOf("planInternetName", "precioPlan", "ip", "snOnu", "mtQueueName", "mtQueueLimit", "fechaCorte", "mtSyncedAt").forEach { Value(fieldLabels[it] ?: it, client.text(it)) }
                }
                2 -> {
                    if (equipmentWrite && can(role)) OutlinedButton(onClick = { manageEquipment = true }) { Icon(Icons.Outlined.Inventory2, null); Spacer(Modifier.width(8.dp)); Text("Gestionar equipos") }
                    val equipment = state.body?.optJSONArray("equipment").objects(); if (equipment.isEmpty()) EmptyState("Sin equipos asignados"); equipment.forEach { Value(it.text("model"), "${it.text("brand")} · ${it.text("serialNumber")}") }
                }
                3 -> {
                    if (can(role, "tecnico", "cobranza")) OutlinedButton(onClick = { note = true }) { Icon(Icons.Outlined.Add, null); Text("Agregar nota") }
                    val notes = state.body?.optJSONArray("notes").objects()
                    if (notes.isEmpty()) EmptyState("Sin notas registradas")
                    notes.forEach { Value(it.text("createdAt"), it.text("note")); HorizontalDivider() }
                }
                4 -> if (recordsWrite) ClientRecordHistory(id, vm, pages) else WebParityClientActions(id, vm, pages, role)
                5 -> WebParityClientActions(id, vm, pages, role)
            }
        }
    }
    if (wallet) ModalBottomSheet(onDismissRequest = { wallet = false }, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxWidth().fillMaxHeight(0.9f)) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Cartera del cliente", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                IconButton(onClick = { wallet = false }) { Icon(Icons.Outlined.Close, "Cerrar cartera") }
            }
            Collection("invoices", vm, pages, {}, fixedClient = id)
        }
    }
    if (note) NoteDialog(id, vm) { note = false }
    if (editRecord && recordsWrite) ClientRecordEditor("alias", id, id, vm, pages) { editRecord = false }
    if (manageService && serviceActions) ClientServiceDialog(id, role, vm, pages) { manageService = false }
    if (linkTestOpen && linkTest) LinkTestDialog(id, vm) { linkTestOpen = false }
    if (editGps && gpsWrite && client != null) ClientGpsDialog(id, client, vm) { editGps = false }
    editExternal?.takeIf { externalWrite }?.let { section -> ExternalClientEditor(id, section, vm) { editExternal = null } }
}

@Composable private fun ClientGpsDialog(id: Int, client: JSONObject, vm: MainViewModel, close: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var latitude by rememberSaveable(id) { mutableStateOf(if (client.isNull("gpsLat")) "" else client.optDouble("gpsLat").toString()) }
    var longitude by rememberSaveable(id) { mutableStateOf(if (client.isNull("gpsLng")) "" else client.optDouble("gpsLng").toString()) }
    var accuracy by rememberSaveable(id) { mutableStateOf(if (client.isNull("gpsAccuracy")) "" else client.optDouble("gpsAccuracy").toString()) }
    var key by rememberSaveable(id) { mutableStateOf(UUID.randomUUID().toString()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val capture = {
        scope.launch {
            busy = true; error = null
            try {
                val location = com.ispmax.mobile.location.captureCurrentLocation(context)
                latitude = location.latitude.toString(); longitude = location.longitude.toString(); accuracy = location.accuracy.toString(); key = UUID.randomUUID().toString()
            } catch (failure: Exception) { error = failure.message ?: "No se pudo obtener la ubicacion" }
            finally { busy = false }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (grants.values.any { it }) capture() else error = "Permiso de ubicacion denegado"
    }
    val lat = latitude.toDoubleOrNull(); val lng = longitude.toDoubleOrNull(); val acc = accuracy.takeIf { it.isNotBlank() }?.toDoubleOrNull()
    val valid = lat != null && lat in -90.0..90.0 && lng != null && lng in -180.0..180.0 && (accuracy.isBlank() || acc != null && acc in 0.0..10_000.0)
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text("Ubicacion del cliente") }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(client.text("aliasNombre", client.text("nombre")), fontWeight = FontWeight.SemiBold)
            OutlinedButton(onClick = {
                if (com.ispmax.mobile.location.hasLocationPermission(context)) capture()
                else permission.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION))
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Icon(Icons.Outlined.MyLocation, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Obteniendo ubicacion" else "Capturar ubicacion actual") }
            OutlinedTextField(latitude, { latitude = it.take(30); key = UUID.randomUUID().toString() }, label = { Text("Latitud") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            OutlinedTextField(longitude, { longitude = it.take(30); key = UUID.randomUUID().toString() }, label = { Text("Longitud") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            OutlinedTextField(accuracy, { accuracy = it.take(20); key = UUID.randomUUID().toString() }, label = { Text("Precision en metros (opcional)") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
            Text("La ubicacion queda en ISP Max y no cambia la ficha externa de WispHub.", style = MaterialTheme.typography.bodySmall)
            error?.let { Notice(it, true) }
        }
    }, confirmButton = { Button(onClick = { scope.launch { busy = true; error = null; try { vm.saveClientGps(id, lat!!, lng!!, acc, key); close() } catch (failure: Exception) { error = failure.message } finally { busy = false } } }, enabled = valid && !busy) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text("Guardar GPS") } }, dismissButton = { TextButton(onClick = close, enabled = !busy) { Text("Cancelar") } })
}

@Composable internal fun ClientServiceDialog(id: Int, role: String, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    val path = "/clients/$id/service-actions"; LaunchedEffect(id) { vm.load(path, true) }; val state = pages[path] ?: PageState(loading = true); val body = state.body; val client = body?.optJSONObject("client"); val caps = body?.optJSONObject("capabilities")
    var action by rememberSaveable(id) { mutableStateOf("") }; var reason by rememberSaveable(id) { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }; var result by rememberSaveable(id) { mutableStateOf<String?>(null) }; var error by rememberSaveable(id) { mutableStateOf<String?>(null) }; val scope = rememberCoroutineScope()
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text("Administrar servicio") }, text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        ReadStatus(state) { vm.load(path, true) }; client?.let { Text(it.text("aliasNombre", it.text("nombre")), fontWeight = FontWeight.Bold); Text("${it.text("ip")} · ${it.text("estado")}"); it.optString("crmAction").takeIf(String::isNotBlank)?.let { current -> Notice("Accion actual: $current · ${it.text("crmActionReason")}") } }
        Row(horizontalArrangement = Arrangement.spacedBy(7.dp)) { FilterChip(selected = action == "moroso", enabled = caps?.optBoolean("moroso") == true, onClick = { action = "moroso"; reason = "Falta de pago" }, label = { Text("Moroso") }); FilterChip(selected = action == "clear", enabled = caps?.optBoolean("clear") == true, onClick = { action = "clear"; reason = "Pago confirmado" }, label = { Text("Reactivar") }); if (role in listOf("admin", "super_admin")) FilterChip(selected = action == "block", enabled = caps?.optBoolean("block") == true, onClick = { action = "block"; reason = "Bloqueo manual" }, label = { Text("Bloquear") }) }
        if (action.isNotBlank()) OutlinedTextField(reason, { reason = it.take(240) }, label = { Text("Motivo") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
        if (action == "block") Notice("El cliente esta inscrito en el piloto. El bloqueo total mostrara el portal de pago y cortara conexiones activas.", true)
        result?.let { Notice(it) }; error?.let { Notice(it, true) }
        Text("Historial", fontWeight = FontWeight.SemiBold); body?.optJSONArray("events").objects().take(10).forEach { event -> Text("${event.text("action")} · ${event.text("reason")} · ${event.text("createdAt")}", style = MaterialTheme.typography.bodySmall) }
    } }, confirmButton = { if (action.isNotBlank()) Button(enabled = !busy && reason.isNotBlank(), onClick = { scope.launch { busy = true; error = null; try { val response = vm.executeClientServiceAction(id, JSONObject().put("action", action).put("reason", reason).put("pilotConfirmed", action == "block"), UUID.randomUUID().toString()); result = when (response.text("state")) { "complete" -> "Accion aplicada y registrada"; "pending_review" -> "Resultado incierto: revisar antes de repetir"; else -> "No aplicada: ${response.text("error")}" }; action = ""; vm.load(path, true) } catch (e: Exception) { error = e.message } finally { busy = false } } }) { Text("Aplicar") } }, dismissButton = { TextButton(onClick = close, enabled = !busy) { Text("Cerrar") } })
}

@Composable private fun NoteDialog(id: Int, vm: MainViewModel, close: () -> Unit) {
    val keyboard = LocalSoftwareKeyboardController.current
    var text by remember { mutableStateOf("") }
    var key by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var loaded by remember { mutableStateOf(false) }
    var attempted by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(id) { vm.draft(id)?.let { text = it.optString("note"); key = it.optString("key", key); attempted = it.optBoolean("attempted") }; loaded = true }
    LaunchedEffect(text, key, loaded, attempted) { if (loaded) { delay(300); vm.saveDraft(id, text, key, attempted) } }
    val saveAndClose: () -> Unit = { if (!busy) scope.launch { vm.saveDraft(id, text, key, attempted); close() }; Unit }
    AlertDialog(onDismissRequest = saveAndClose, title = { Text("Nota del cliente") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(text, { if (it.length <= 4000) { text = it; key = UUID.randomUUID().toString() } }, label = { Text("Nota") }, minLines = 4, enabled = !busy && !attempted)
            if (attempted) Notice("Solicitud sin confirmar. El reintento conserva la misma nota para no duplicarla.")
            error?.let { Notice(it, true) }
        } },
        confirmButton = { Button(enabled = loaded && text.isNotBlank() && !busy, onClick = {
            scope.launch { busy = true; error = null; keyboard?.hide(); try { attempted = true; vm.saveDraft(id, text, key, true); vm.sendNote(id, text, key); loaded = false; close() } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                error = e.message ?: "No se pudo guardar"
                if (e is com.ispmax.mobile.data.ApiFailure && e.status in listOf(400, 401, 403, 404)) attempted = false
                vm.saveDraft(id, text, key, attempted)
            } finally { busy = false } }
        }) { Icon(Icons.Outlined.Save, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else if (attempted) "Consultar y reintentar" else "Guardar en servidor") } },
        dismissButton = { TextButton(onClick = saveAndClose, enabled = !busy) { Text("Guardar borrador") } })
}

@Composable internal fun StatusBadge(value: String) {
    val color = when (value.lowercase()) { "activo", "pagada", "en linea" -> IspGreen; "suspendido", "pendiente de pago" -> IspAmber; "sin conexion", "vencida" -> IspRed; else -> IspBlue }
    Text(value, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.background(color.copy(alpha = 0.09f), MaterialTheme.shapes.extraSmall).padding(horizontal = 8.dp, vertical = 4.dp))
}
@Composable private fun Value(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, style = MaterialTheme.typography.bodyLarge) }
}
@Composable internal fun EmptyState(text: String) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) { Icon(Icons.Outlined.Inbox, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(32.dp)); Text(text, style = MaterialTheme.typography.bodyMedium) }
}
private val fieldLabels = mapOf("usuario" to "Usuario", "telefono" to "Telefono", "email" to "Correo", "cedula" to "Documento", "direccion" to "Direccion", "zonaNombre" to "Zona", "planInternetName" to "Plan", "precioPlan" to "Precio del plan", "ip" to "Direccion IP", "snOnu" to "Serial ONU", "mtQueueName" to "Cola MikroTik", "mtQueueLimit" to "Limite MikroTik", "fechaCorte" to "Fecha de corte", "mtSyncedAt" to "Ultima lectura MikroTik", "idFactura" to "Factura", "clienteNombre" to "Cliente", "total" to "Total", "totalCobrado" to "Cobrado", "saldo" to "Saldo", "estado" to "Estado", "fechaEmision" to "Emision", "fechaVencimiento" to "Vencimiento", "fechaPago" to "Pago", "formaPagoNombre" to "Forma de pago", "rxPowerDbm" to "RX (dBm)", "txPowerDbm" to "TX (dBm)", "lastSeenAt" to "Ultima lectura", "serial" to "Serial", "model" to "Modelo", "onuIndex" to "Ubicacion OLT")

@Composable private fun DetailsDialog(row: JSONObject, title: String, document: (() -> Unit)? = null, payment: (() -> Unit)? = null, close: () -> Unit) {
    AlertDialog(onDismissRequest = close, title = { Text(title) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            row.keys().asSequence().filter { !row.isNull(it) }.forEach { key -> Value(fieldLabels[key] ?: catalogFieldLabels[key] ?: key, if (key in listOf("total", "totalCobrado", "saldo", "amount", "netAmount", "unitCost")) money(row.optDouble(key, 0.0)) else catalogValue(key, row.text(key))) }
        }
    }, confirmButton = { Column { if (payment != null) TextButton(onClick = payment) { Icon(Icons.Outlined.Payments, null); Spacer(Modifier.width(8.dp)); Text("Registrar o consultar pago") }; if (document != null) TextButton(onClick = document) { Icon(Icons.Outlined.ReceiptLong, null); Spacer(Modifier.width(8.dp)); Text("Ver documento") } else TextButton(onClick = close) { Text("Cerrar") } } },
        dismissButton = { if (document != null) TextButton(onClick = close) { Text("Cerrar") } })
}

private fun csvValue(value: String): String {
    val safe = if (value.trimStart().firstOrNull() in listOf('=', '+', '-', '@', '\t', '\r')) "'$value" else value
    return "\"${safe.replace("\"", "\"\"")}\""
}
@Composable internal fun ExportButton(rows: List<JSONObject>, title: String, loadRows: (suspend () -> List<JSONObject>)? = null) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pending by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri != null) runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(pending.toByteArray(Charsets.UTF_8)) } ?: throw java.io.IOException("No se pudo abrir el archivo") }.onFailure { error = "No se pudo exportar el archivo" }
        pending = ""
        busy = false
    }
    IconButton(enabled = rows.isNotEmpty() && !busy, onClick = {
        scope.launch {
            busy = true
            error = null
            try {
                val exportRows = loadRows?.invoke() ?: rows
                val keys = exportRows.flatMap { it.keys().asSequence().toList() }.distinct()
                pending = "\uFEFF" + keys.joinToString(",") { csvValue(fieldLabels[it] ?: catalogFieldLabels[it] ?: it) } + "\r\n" + exportRows.joinToString("\r\n") { row -> keys.joinToString(",") { csvValue(catalogValue(it, row.text(it, ""))) } }
                launcher.launch("ISP-Max-$title-${if (loadRows == null) "pagina" else "completo"}.csv")
            } catch (failure: Exception) {
                error = failure.message ?: "No se pudo consultar la exportacion completa"
                busy = false
            }
        }
    }) {
        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        else Icon(Icons.Outlined.FileDownload, if (loadRows == null) "Exportar pagina visible a CSV" else "Exportar todos los resultados filtrados")
    }
    error?.let { AlertDialog(onDismissRequest = { error = null }, text = { Text(it) }, confirmButton = { TextButton(onClick = { error = null }) { Text("Cerrar") } }) }
}

@Composable private fun OnuReadiness() {
    val context = LocalContext.current
    val probe = remember { LocalOnuProbe(context) }
    val scope = rememberCoroutineScope()
    var links by remember { mutableStateOf(probe.links()) }
    var selected by remember { mutableStateOf(links.firstOrNull()?.network?.toString()) }
    var target by remember { mutableStateOf(links.firstOrNull()?.gateway ?: "192.168.1.1") }
    var result by remember { mutableStateOf<ProbeResult?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var generation by remember { mutableIntStateOf(0) }
    DisposableEffect(Unit) {
        val manager = context.getSystemService(android.net.ConnectivityManager::class.java)
        fun changed() { scope.launch {
            links = probe.links(); result = null; generation++
            if (links.none { it.network.toString() == selected }) selected = links.firstOrNull()?.network?.toString()
        } }
        val callback = object : android.net.ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: android.net.Network) = changed()
            override fun onLost(network: android.net.Network) = changed()
            override fun onLinkPropertiesChanged(network: android.net.Network, properties: android.net.LinkProperties) = changed()
        }
        manager.registerNetworkCallback(android.net.NetworkRequest.Builder().build(), callback)
        onDispose { manager.unregisterNetworkCallback(callback) }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Icon(Icons.Outlined.Router, null, Modifier.size(40.dp), tint = IspGreen)
        Text("Conectar e identificar", style = MaterialTheme.typography.titleLarge)
        OutlinedButton(onClick = { context.startActivity(android.content.Intent(android.provider.Settings.ACTION_WIFI_SETTINGS)) }) { Icon(Icons.Outlined.Wifi, null); Spacer(Modifier.width(8.dp)); Text("Conectar WiFi") }
        if (links.isEmpty()) Notice("No hay una conexion local WiFi o Ethernet disponible.")
        links.forEach { link ->
            FilterChip(selected = selected == link.network.toString(), onClick = { selected = link.network.toString(); target = link.gateway ?: target; result = null; generation++ }, label = { Text("${link.name}  ${link.addresses.joinToString { "${it.first}/${it.second}" }}") }, leadingIcon = { Icon(Icons.Outlined.SettingsEthernet, null) })
        }
        OutlinedTextField(target, { target = it; result = null; generation++ }, label = { Text("IP local de la ONU") }, singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !busy, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
        Button(enabled = !busy && links.any { it.network.toString() == selected }, onClick = {
            val link = links.firstOrNull { it.network.toString() == selected }
            if (link != null) scope.launch {
                busy = true; result = null; error = null
                val revision = generation
                try { val detected = probe.probe(link, target.trim()); if (generation == revision) result = detected }
                catch (e: Exception) { if (generation == revision) error = e.message ?: "No se pudo consultar el equipo" }
                finally { busy = false }
            }
        }, modifier = Modifier.fillMaxWidth()) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White) else Icon(Icons.Outlined.Search, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Consultando..." else "Detectar equipo") }
        error?.let { Notice(it, true) }
        result?.let { found ->
            Value("Respuesta", "${found.target} · ${found.httpStatus}")
            Value("Panel detectado", found.identity.family)
            Value("Modelo publicado", found.identity.model ?: "No identificado")
            Value("Serial GPON", "Requiere lectura autenticada; no verificado")
        }
        Notice("Escritura bloqueada: falta certificar autenticacion y configuracion Android para EG8141A5 y F670L.")
        HorizontalDivider()
        Value("Agente Windows", "Se mantiene disponible en ISP Max")
        Value("TR-069", "Conserva el servidor GenieACS actual")
    }
}

@Composable private fun PonPage(vm: MainViewModel, pages: Map<String, PageState>) {
    LaunchedEffect(Unit) { vm.load("/pons", true) }
    val state = pages["/pons"] ?: PageState(loading = true)
    var selectedJson by rememberSaveable { mutableStateOf<String?>(null) }
    val selected = selectedJson?.let { JSONObject(it) }
    if (selected != null) {
        Column(Modifier.fillMaxSize()) {
            TextButton(onClick = { selectedJson = null }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, null); Text("PON ${selected.text("key")}") }
            Collection("onus", vm, pages, {}, pon = selected)
        }
        BackHandler { selectedJson = null }
        return
    }
    LazyColumn(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item { Row(verticalAlignment = Alignment.CenterVertically) { Text("Puertos PON", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); IconButton(onClick = { vm.load("/pons", true) }) { Icon(Icons.Outlined.Refresh, "Actualizar PON") } } }
        item { ReadStatus(state) { vm.load("/pons", true) } }
        if (state.body?.optJSONArray("items").objects().isEmpty() && !state.loading) item { EmptyState("Sin puertos con ONU registradas") }
        items(state.body?.optJSONArray("items").objects(), key = { it.text("key") }) { port ->
            OutlinedCard(onClick = { selectedJson = port.toString() }, colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Hub, null, tint = IspGreen); Spacer(Modifier.width(10.dp)); Text("PON ${port.text("key")}", Modifier.weight(1f), fontWeight = FontWeight.Bold); Text("${port.text("total")} ONU") }
                    LinearProgressIndicator(progress = { port.optInt("online").toFloat() / port.optInt("total").coerceAtLeast(1) }, modifier = Modifier.fillMaxWidth().height(8.dp), color = IspGreen, trackColor = Color(0xFFFBE6E8))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { Text("${port.text("online")} en linea", color = IspGreen); Text("${port.text("offline")} sin conexion", color = IspRed) }
                    Text("Ultima lectura: ${port.text("lastSeenAt")}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
