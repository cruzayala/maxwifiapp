package com.ispmax.mobile

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.ispmax.mobile.ui.IspPrimaryButton as Button
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder
import java.util.UUID

private val roleLabels = linkedMapOf(
    "viewer" to "Consulta", "tecnico" to "Tecnico", "cobranza" to "Cobranza",
    "admin" to "Administrador", "super_admin" to "Super administrador",
)

@Composable
fun UsersScreen(vm: MainViewModel, pages: Map<String, PageState>) {
    val app by vm.app.collectAsState()
    val me = app.user
    val canCreate = app.capabilities?.optJSONObject("capabilities")?.optBoolean("usersCreate") == true
    var search by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("") }
    var page by rememberSaveable { mutableIntStateOf(1) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var editor by rememberSaveable { mutableIntStateOf(-1) }
    val path = "/users?q=${URLEncoder.encode(search, "UTF-8")}&role=$role&page=$page&pageSize=30"
    LaunchedEffect(path) { vm.load(path) }
    val state = pages[path] ?: PageState(loading = true)
    val rows = state.body?.optJSONArray("items").objects()
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${state.body?.optJSONObject("summary")?.optInt("active") ?: 0} usuarios activos", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text("${state.body?.optJSONObject("summary")?.optInt("admins") ?: 0} administradores", style = MaterialTheme.typography.bodySmall)
            }
            if (canCreate) FilledTonalIconButton(onClick = { editor = 0 }) { Icon(Icons.Outlined.PersonAdd, "Crear usuario") }
        }
        OutlinedTextField(search, { search = it; page = 1 }, label = { Text("Buscar usuario") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            FilterChip(selected = role.isBlank(), onClick = { role = ""; page = 1 }, label = { Text("Todos") })
            FilterChip(selected = role == "admin", onClick = { role = "admin"; page = 1 }, label = { Text("Admin") })
            FilterChip(selected = role == "tecnico", onClick = { role = "tecnico"; page = 1 }, label = { Text("Tecnicos") })
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar usuarios") }
        }
        ReadStatus(state) { vm.load(path, true) }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (rows.isEmpty() && !state.loading && state.error == null) item { EmptyState("No hay usuarios para estos filtros") }
            items(rows, key = { it.optInt("id") }) { row ->
                OutlinedCard(onClick = { selected = row.toString() }, modifier = Modifier.fillMaxWidth()) {
                    ListItem(
                        headlineContent = { Text(row.text("fullName", row.text("username")), fontWeight = FontWeight.SemiBold) },
                        supportingContent = { Text("@${row.text("username")} · ${roleLabels[row.optString("role")] ?: row.text("role")}") },
                        leadingContent = { Icon(if (row.optBoolean("isActive")) Icons.Outlined.VerifiedUser else Icons.Outlined.PersonOff, null) },
                        trailingContent = { StatusBadge(if (row.optBoolean("isActive")) "Activo" else "Inactivo") },
                    )
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { page-- }, enabled = page > 1 && !state.loading) { Icon(Icons.Outlined.ChevronLeft, "Pagina anterior") }
            Text("Pagina $page")
            IconButton(onClick = { page++ }, enabled = state.body?.optBoolean("hasMore") == true && !state.loading) { Icon(Icons.Outlined.ChevronRight, "Pagina siguiente") }
        }
    }
    selected?.let { UserActions(JSONObject(it), me, vm, { editor = JSONObject(it).optInt("id"); selected = null }, { selected = null }, { vm.load(path, true) }) }
    if (editor >= 0) UserEditor(editor, me, vm) { editor = -1; vm.load(path, true) }
}

@Composable
private fun UserActions(row: JSONObject, me: JSONObject?, vm: MainViewModel, edit: () -> Unit, close: () -> Unit, changed: () -> Unit) {
    var password by rememberSaveable { mutableStateOf(false) }
    var deleting by rememberSaveable { mutableStateOf(false) }
    var current by remember { mutableStateOf("") }
    var next by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val key = rememberSaveable(password, deleting) { UUID.randomUUID().toString() }
    val scope = rememberCoroutineScope()
    val superAdmin = me?.optString("role") == "super_admin"
    val self = me?.optInt("id") == row.optInt("id")
    AlertDialog(onDismissRequest = { if (!busy) close() }, title = { Text(if (password) "Cambiar clave" else if (deleting) "Eliminar usuario" else row.text("username")) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!password && !deleting) {
                Text(row.text("fullName", "Sin nombre completo")); Text(roleLabels[row.optString("role")] ?: row.text("role")); Text(row.text("email", "Sin correo"))
            }
            if (password) {
                if (self && !superAdmin) OutlinedTextField(current, { current = it }, label = { Text("Clave actual") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                OutlinedTextField(next, { next = it }, label = { Text("Nueva clave") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
                Notice("El cambio revocara todas las sesiones moviles de esta cuenta.")
            }
            if (deleting) Notice("La cuenta y sus sesiones moviles se eliminaran. La auditoria permanece.")
            error?.let { Notice(it, true) }
        }
    }, confirmButton = {
        Button(enabled = !busy && (!password || next.length >= 8), onClick = {
            when {
                password -> scope.launch { busy = true; error = null; try {
                    vm.changeUserPassword(row.optInt("id"), JSONObject().put("currentPassword", current).put("newPassword", next), key, row.getString("version")); close()
                } catch (e: Exception) { error = e.message } finally { busy = false } }
                deleting -> scope.launch { busy = true; error = null; try { vm.deleteUser(row.optInt("id"), key, row.getString("version")); changed(); close() } catch (e: Exception) { error = e.message } finally { busy = false } }
                else -> edit()
            }
        }) { Icon(if (password) Icons.Outlined.Password else if (deleting) Icons.Outlined.DeleteOutline else Icons.Outlined.Edit, null); Spacer(Modifier.width(8.dp)); Text(if (password) "Cambiar clave" else if (deleting) "Eliminar" else "Editar") }
    }, dismissButton = {
        Row {
            if (!password && !deleting && (self || superAdmin)) IconButton(onClick = { password = true }) { Icon(Icons.Outlined.Password, "Cambiar clave") }
            if (!password && !deleting && superAdmin && !self) IconButton(onClick = { deleting = true }) { Icon(Icons.Outlined.DeleteOutline, "Eliminar usuario") }
            TextButton(onClick = { if (password) { password = false; current = ""; next = "" } else if (deleting) deleting = false else close() }, enabled = !busy) { Text(if (password || deleting) "Volver" else "Cerrar") }
        }
    })
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun UserEditor(id: Int, me: JSONObject?, vm: MainViewModel, close: () -> Unit) {
    var raw by rememberSaveable(id) { mutableStateOf("{}") }
    var password by remember { mutableStateOf("") }
    var loaded by rememberSaveable(id) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by rememberSaveable(id) { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val superAdmin = me?.optString("role") == "super_admin"
    LaunchedEffect(id) {
        try {
            raw = (if (id == 0) JSONObject().put("role", "viewer").put("isActive", true) else vm.userForEdit(id)).put("key", UUID.randomUUID().toString()).toString()
            loaded = true
        } catch (e: Exception) { error = e.message }
    }
    fun update(field: String, value: Any) { raw = JSONObject(raw).put(field, value).put("key", UUID.randomUUID().toString()).toString() }
    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Scaffold(topBar = { TopAppBar(title = { Text(if (id == 0) "Crear usuario" else "Editar usuario") }, navigationIcon = { IconButton(onClick = close, enabled = !busy) { Icon(Icons.Outlined.Close, "Cerrar") } }) }, bottomBar = {
                Button(enabled = loaded && !busy && (id != 0 || password.length >= 8), onClick = {
                    scope.launch { busy = true; error = null; try {
                        val form = JSONObject(raw); val body = JSONObject()
                        if (id == 0) { body.put("username", form.optString("username")).put("password", password) }
                        body.put("fullName", form.optString("fullName")).put("email", form.optString("email"))
                        if (superAdmin) body.put("role", form.optString("role", "viewer"))
                        if (id > 0) body.put("isActive", form.optBoolean("isActive", true))
                        vm.saveUser(id, body, form.getString("key"), if (id == 0) null else form.getString("version")); close()
                    } catch (e: Exception) { error = e.message } finally { busy = false } }
                }, modifier = Modifier.fillMaxWidth().padding(16.dp)) { Icon(Icons.Outlined.Save, null); Spacer(Modifier.width(8.dp)); Text(if (busy) "Guardando..." else "Guardar usuario") }
            }) { padding ->
                val form = JSONObject(raw)
                Column(Modifier.padding(padding).fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (!loaded && error == null) LinearProgressIndicator(Modifier.fillMaxWidth())
                    error?.let { Notice(it, true) }
                    if (id == 0) {
                        OutlinedTextField(form.text("username", ""), { update("username", it) }, label = { Text("Usuario") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(password, { password = it }, label = { Text("Clave inicial") }, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), singleLine = true, modifier = Modifier.fillMaxWidth())
                        Text("La clave no se guarda en borradores ni en Room.", style = MaterialTheme.typography.bodySmall)
                    } else Text("@${form.text("username")}", style = MaterialTheme.typography.titleMedium)
                    OutlinedTextField(form.text("fullName", ""), { update("fullName", it) }, label = { Text("Nombre completo") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(form.text("email", ""), { update("email", it) }, label = { Text("Correo") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), singleLine = true, modifier = Modifier.fillMaxWidth())
                    if (superAdmin) OptionField("Rol", form.optString("role", "viewer"), roleLabels) { update("role", it) }
                    if (id > 0) Row(verticalAlignment = Alignment.CenterVertically) { Switch(form.optBoolean("isActive", true), { update("isActive", it) }, enabled = me?.optInt("id") != id); Spacer(Modifier.width(10.dp)); Text("Cuenta activa") }
                }
            }
        }
    }
}
