package com.ispmax.mobile.ui

import android.content.Context
import android.content.Intent
import android.print.PrintAttributes
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.ispmax.mobile.MainViewModel
import com.ispmax.mobile.PageState
import java.io.File

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun InvoiceDocumentDialog(id: Int, vm: MainViewModel, pages: Map<String, PageState>, close: () -> Unit) {
    var paper by remember { mutableStateOf("A4") }
    var renderer by remember { mutableStateOf<WebView?>(null) }
    var ready by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val path = "/invoices/$id/document?paper=$paper"
    val state = pages[path] ?: PageState(loading = true)
    val html = state.body?.optString("html").orEmpty()
    val filename = "ISP-Max-factura-$id-$paper.html"
    val download = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/html")) { uri ->
        if (uri != null) runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(html.toByteArray()) } ?: throw java.io.IOException() }.onFailure { error = "No se pudo guardar el documento" }
    }
    LaunchedEffect(path) { ready = false; vm.load(path) }
    com.ispmax.mobile.ui.IspFullScreenDialog(onDismissRequest = close) {
        Column(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding()) {
            TopAppBar(title = { Text("Factura #$id") }, navigationIcon = { IconButton(onClick = close) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Cerrar documento") } }, windowInsets = WindowInsets(0, 0, 0, 0))
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                listOf("A4", "80mm", "58mm").forEach { size -> FilterChip(paper == size, { paper = size }, label = { Text(size) }) }
            }
            if (state.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (state.cached) Text("Documento guardado sin conexion", Modifier.padding(12.dp), color = IspAmber)
            (error ?: state.error)?.let { Text(it, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error) }
            val documentContent: @Composable () -> Unit = {
                if (html.isNotBlank()) key(path, html) {
                    // This isolated renderer is only for the shared invoice, never app navigation.
                    AndroidView(modifier = Modifier.fillMaxSize().clipToBounds(), factory = { ctx ->
                        WebView(ctx).apply {
                            settings.javaScriptEnabled = false
                            settings.allowFileAccess = false
                            settings.allowContentAccess = false
                            settings.blockNetworkLoads = true
                            settings.builtInZoomControls = true
                            settings.displayZoomControls = false
                            settings.useWideViewPort = true
                            settings.loadWithOverviewMode = true
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?) = true
                                override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?) = WebResourceResponse("text/plain", "UTF-8", java.io.ByteArrayInputStream(byteArrayOf()))
                                override fun onPageFinished(view: WebView?, url: String?) { ready = true }
                            }
                            renderer = this
                            loadDataWithBaseURL("https://document.ispmax.invalid/", html, "text/html", "UTF-8", null)
                        }
                    }, onRelease = { if (renderer === it) renderer = null; it.destroy() })
                }
            }
            BottomAppBar(windowInsets = WindowInsets(0, 0, 0, 0)) {
                IconButton(enabled = ready, onClick = {
                    val web = renderer
                    if (web != null) {
                        val attributes = PrintAttributes.Builder().setMediaSize(if (paper == "A4") PrintAttributes.MediaSize.ISO_A4 else PrintAttributes.MediaSize("receipt", paper, if (paper == "58mm") 2283 else 3150, 11000)).setMinMargins(PrintAttributes.Margins.NO_MARGINS).build()
                        runCatching { (context.getSystemService(Context.PRINT_SERVICE) as PrintManager).print("ISP Max #$id", web.createPrintDocumentAdapter("Factura #$id"), attributes) }.onFailure { error = "No se pudo abrir la impresion" }
                    }
                }) { Icon(Icons.Outlined.Print, "Imprimir o guardar PDF") }
                IconButton(enabled = html.isNotBlank(), onClick = { download.launch(filename) }) { Icon(Icons.Outlined.FileDownload, "Guardar documento HTML") }
                IconButton(enabled = html.isNotBlank(), onClick = {
                    runCatching {
                        val directory = File(context.cacheDir, "documents").apply { mkdirs() }
                        val file = File(directory, filename).apply { writeText(html) }
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
                        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/html").putExtra(Intent.EXTRA_STREAM, uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "Compartir factura"))
                    }.onFailure { error = "No se pudo compartir el documento" }
                }) { Icon(Icons.Outlined.Share, "Compartir documento HTML") }
                Spacer(Modifier.weight(1f))
                IconButton(onClick = { vm.load(path, true) }, enabled = !state.loading) { Icon(Icons.Outlined.Refresh, "Actualizar documento") }
            }
            Box(Modifier.weight(1f).fillMaxWidth().clipToBounds()) { documentContent() }
        }
    }
}
