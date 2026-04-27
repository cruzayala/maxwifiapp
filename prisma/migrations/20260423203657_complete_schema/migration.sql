-- CreateTable
CREATE TABLE "Client" (
    "idServicio" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "usuario" TEXT,
    "nombre" TEXT NOT NULL,
    "email" TEXT,
    "emailCc" TEXT,
    "razonSocial" TEXT,
    "tipoPersona" TEXT,
    "cedula" TEXT,
    "rfc" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "localidad" TEXT,
    "ciudad" TEXT,
    "coordenadas" TEXT,
    "planInternetId" INTEGER,
    "planInternetName" TEXT,
    "precioPlan" TEXT,
    "descuento" TEXT,
    "saldo" TEXT,
    "estadoFacturas" TEXT,
    "estado" TEXT,
    "ip" TEXT,
    "ipLocal" TEXT,
    "macCpe" TEXT,
    "interfazLan" TEXT,
    "snOnu" TEXT,
    "modeloRouterWifi" TEXT,
    "ipRouterWifi" TEXT,
    "macRouterWifi" TEXT,
    "ssidRouterWifi" TEXT,
    "passwordSsidWifi" TEXT,
    "zonaId" INTEGER,
    "zonaNombre" TEXT,
    "routerId" INTEGER,
    "routerNombre" TEXT,
    "sectorialId" INTEGER,
    "sectorialNombre" TEXT,
    "modeloAntenaId" INTEGER,
    "modeloAntenaName" TEXT,
    "tecnicoId" INTEGER,
    "tecnicoNombre" TEXT,
    "firewall" BOOLEAN NOT NULL DEFAULT true,
    "autoActivar" BOOLEAN NOT NULL DEFAULT false,
    "formaContratacion" TEXT,
    "comentarios" TEXT,
    "fechaInstalacion" TEXT,
    "fechaCancelacion" TEXT,
    "fechaCorte" TEXT,
    "ultimoCambio" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Invoice" (
    "idFactura" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "folio" TEXT,
    "fechaEmision" TEXT,
    "fechaVencimiento" TEXT,
    "fechaPago" TEXT,
    "estado" TEXT,
    "tipo" INTEGER,
    "subTotal" REAL NOT NULL DEFAULT 0,
    "descuento" REAL NOT NULL DEFAULT 0,
    "impuestosTotal" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "totalCobrado" REAL NOT NULL DEFAULT 0,
    "saldo" REAL NOT NULL DEFAULT 0,
    "saldoNuevo" REAL NOT NULL DEFAULT 0,
    "comprobantePago" TEXT,
    "referencia" TEXT,
    "referenciaOxxo" TEXT,
    "totalPasarela" REAL NOT NULL DEFAULT 0,
    "totalOpenpay" REAL NOT NULL DEFAULT 0,
    "totalOxxo" REAL NOT NULL DEFAULT 0,
    "idMercadopago" TEXT,
    "idPayu" TEXT,
    "urlPayu" TEXT,
    "retencionPorcentaje" REAL NOT NULL DEFAULT 0,
    "retencionesTotal" REAL NOT NULL DEFAULT 0,
    "zonaId" INTEGER,
    "zonaNombre" TEXT,
    "formaPagoId" INTEGER,
    "formaPagoNombre" TEXT,
    "cajeroId" INTEGER,
    "cajeroNombre" TEXT,
    "clienteIdServicio" INTEGER,
    "clienteNombre" TEXT NOT NULL,
    "clienteUsuario" TEXT,
    "clienteCedula" TEXT,
    "clienteTelefono" TEXT,
    "clienteDireccion" TEXT,
    "clienteEmail" TEXT,
    "clienteRfc" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invoice_clienteIdServicio_fkey" FOREIGN KEY ("clienteIdServicio") REFERENCES "Client" ("idServicio") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceArticle" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idFactura" INTEGER NOT NULL,
    "remoteId" INTEGER,
    "uuidEquipo" TEXT,
    "categoriaStock" TEXT,
    "cantidad" INTEGER NOT NULL DEFAULT 1,
    "descripcion" TEXT NOT NULL,
    "precio" TEXT NOT NULL DEFAULT '0',
    "idServicio" INTEGER,
    CONSTRAINT "InvoiceArticle_idFactura_fkey" FOREIGN KEY ("idFactura") REFERENCES "Invoice" ("idFactura") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Ticket" (
    "idTicket" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asunto" TEXT,
    "descripcion" TEXT,
    "estado" TEXT,
    "prioridad" TEXT,
    "asignado" TEXT,
    "clienteIdServicio" INTEGER,
    "clienteNombre" TEXT,
    "fechaCreacion" TEXT,
    "fechaActualizacion" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "InternetPlan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Zone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Router" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "ip" TEXT,
    "fallaGeneral" BOOLEAN NOT NULL DEFAULT false,
    "fallaGeneralDescripcion" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AntennaModel" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "marca" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT,
    "nombre" TEXT NOT NULL,
    "email" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Sectorial" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nombre" TEXT NOT NULL,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "entity" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PaymentLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idFactura" INTEGER NOT NULL,
    "idServicio" INTEGER,
    "clientName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "paymentMethodId" INTEGER,
    "paymentMethodName" TEXT,
    "paidAt" DATETIME NOT NULL,
    "notes" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "receiptPrinted" BOOLEAN NOT NULL DEFAULT false,
    "wasRegisteredOnWisphub" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentLog_idFactura_fkey" FOREIGN KEY ("idFactura") REFERENCES "Invoice" ("idFactura") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentLog_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentPromise" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER NOT NULL,
    "clientName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "promisedDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notes" TEXT,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "PaymentPromise_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsappLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "phone" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "idServicio" INTEGER,
    "clientName" TEXT,
    "messageType" TEXT,
    "campaignId" INTEGER,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappLog_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WhatsappLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "WhatsappCampaign" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsappTemplate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "content" TEXT NOT NULL,
    "variables" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WhatsappCampaign" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "templateId" INTEGER,
    "messageContent" TEXT NOT NULL,
    "targetFilter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "totalTargets" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledFor" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "NotificationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "daysOffset" INTEGER NOT NULL DEFAULT 0,
    "scheduleHour" INTEGER NOT NULL DEFAULT 10,
    "messageTemplate" TEXT NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "lastRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotificationSentLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ruleId" INTEGER,
    "phone" TEXT NOT NULL,
    "idServicio" INTEGER,
    "type" TEXT NOT NULL,
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "PingHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "totalAttempts" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" REAL,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PingHistory_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SpeedTest" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER,
    "clientName" TEXT,
    "clientIp" TEXT,
    "downloadMbps" REAL NOT NULL,
    "uploadMbps" REAL NOT NULL,
    "pingMs" REAL NOT NULL,
    "jitterMs" REAL NOT NULL,
    "location" TEXT,
    "testServer" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SpeedTest_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NetworkScan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "totalScanned" INTEGER NOT NULL DEFAULT 0,
    "onlineCount" INTEGER NOT NULL DEFAULT 0,
    "offlineCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "notes" TEXT
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER NOT NULL,
    "clientName" TEXT NOT NULL,
    "title" TEXT,
    "note" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientNote_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientTag" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ClientTagAssignment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER NOT NULL,
    "tagId" INTEGER NOT NULL,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientTagAssignment_idServicio_fkey" FOREIGN KEY ("idServicio") REFERENCES "Client" ("idServicio") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ClientTagAssignment_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ClientTag" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ClientAttachment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "idServicio" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "description" TEXT,
    "category" TEXT,
    "filePath" TEXT,
    "fileData" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "entityName" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "exportType" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'csv',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "fileName" TEXT,
    "filters" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "DailySnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "date" DATETIME NOT NULL,
    "totalClients" INTEGER NOT NULL DEFAULT 0,
    "activeClients" INTEGER NOT NULL DEFAULT 0,
    "suspendedClients" INTEGER NOT NULL DEFAULT 0,
    "freeClients" INTEGER NOT NULL DEFAULT 0,
    "totalBilled" REAL NOT NULL DEFAULT 0,
    "totalCollected" REAL NOT NULL DEFAULT 0,
    "totalPending" REAL NOT NULL DEFAULT 0,
    "paidInvoices" INTEGER NOT NULL DEFAULT 0,
    "pendingInvoices" INTEGER NOT NULL DEFAULT 0,
    "monthlyRevenue" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Client_nombre_idx" ON "Client"("nombre");

-- CreateIndex
CREATE INDEX "Client_estado_idx" ON "Client"("estado");

-- CreateIndex
CREATE INDEX "Client_telefono_idx" ON "Client"("telefono");

-- CreateIndex
CREATE INDEX "Client_ip_idx" ON "Client"("ip");

-- CreateIndex
CREATE INDEX "Client_cedula_idx" ON "Client"("cedula");

-- CreateIndex
CREATE INDEX "Client_zonaId_idx" ON "Client"("zonaId");

-- CreateIndex
CREATE INDEX "Client_planInternetId_idx" ON "Client"("planInternetId");

-- CreateIndex
CREATE INDEX "Client_estadoFacturas_idx" ON "Client"("estadoFacturas");

-- CreateIndex
CREATE INDEX "Client_fechaCorte_idx" ON "Client"("fechaCorte");

-- CreateIndex
CREATE INDEX "Invoice_clienteIdServicio_idx" ON "Invoice"("clienteIdServicio");

-- CreateIndex
CREATE INDEX "Invoice_clienteNombre_idx" ON "Invoice"("clienteNombre");

-- CreateIndex
CREATE INDEX "Invoice_estado_idx" ON "Invoice"("estado");

-- CreateIndex
CREATE INDEX "Invoice_fechaEmision_idx" ON "Invoice"("fechaEmision");

-- CreateIndex
CREATE INDEX "Invoice_fechaVencimiento_idx" ON "Invoice"("fechaVencimiento");

-- CreateIndex
CREATE INDEX "Invoice_formaPagoId_idx" ON "Invoice"("formaPagoId");

-- CreateIndex
CREATE INDEX "InvoiceArticle_idFactura_idx" ON "InvoiceArticle"("idFactura");

-- CreateIndex
CREATE INDEX "InvoiceArticle_idServicio_idx" ON "InvoiceArticle"("idServicio");

-- CreateIndex
CREATE INDEX "Ticket_estado_idx" ON "Ticket"("estado");

-- CreateIndex
CREATE INDEX "Ticket_prioridad_idx" ON "Ticket"("prioridad");

-- CreateIndex
CREATE INDEX "Ticket_clienteIdServicio_idx" ON "Ticket"("clienteIdServicio");

-- CreateIndex
CREATE INDEX "InternetPlan_nombre_idx" ON "InternetPlan"("nombre");

-- CreateIndex
CREATE INDEX "SyncLog_entity_startedAt_idx" ON "SyncLog"("entity", "startedAt");

-- CreateIndex
CREATE INDEX "PaymentLog_idFactura_idx" ON "PaymentLog"("idFactura");

-- CreateIndex
CREATE INDEX "PaymentLog_idServicio_idx" ON "PaymentLog"("idServicio");

-- CreateIndex
CREATE INDEX "PaymentLog_paidAt_idx" ON "PaymentLog"("paidAt");

-- CreateIndex
CREATE INDEX "PaymentLog_createdAt_idx" ON "PaymentLog"("createdAt");

-- CreateIndex
CREATE INDEX "PaymentLog_success_idx" ON "PaymentLog"("success");

-- CreateIndex
CREATE INDEX "PaymentLog_clientName_idx" ON "PaymentLog"("clientName");

-- CreateIndex
CREATE INDEX "PaymentPromise_idServicio_idx" ON "PaymentPromise"("idServicio");

-- CreateIndex
CREATE INDEX "PaymentPromise_status_idx" ON "PaymentPromise"("status");

-- CreateIndex
CREATE INDEX "PaymentPromise_promisedDate_idx" ON "PaymentPromise"("promisedDate");

-- CreateIndex
CREATE INDEX "WhatsappLog_phone_idx" ON "WhatsappLog"("phone");

-- CreateIndex
CREATE INDEX "WhatsappLog_idServicio_idx" ON "WhatsappLog"("idServicio");

-- CreateIndex
CREATE INDEX "WhatsappLog_status_idx" ON "WhatsappLog"("status");

-- CreateIndex
CREATE INDEX "WhatsappLog_messageType_idx" ON "WhatsappLog"("messageType");

-- CreateIndex
CREATE INDEX "WhatsappLog_createdAt_idx" ON "WhatsappLog"("createdAt");

-- CreateIndex
CREATE INDEX "WhatsappLog_campaignId_idx" ON "WhatsappLog"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappTemplate_name_key" ON "WhatsappTemplate"("name");

-- CreateIndex
CREATE INDEX "WhatsappTemplate_category_idx" ON "WhatsappTemplate"("category");

-- CreateIndex
CREATE INDEX "WhatsappCampaign_status_idx" ON "WhatsappCampaign"("status");

-- CreateIndex
CREATE INDEX "WhatsappCampaign_scheduledFor_idx" ON "WhatsappCampaign"("scheduledFor");

-- CreateIndex
CREATE INDEX "NotificationRule_active_idx" ON "NotificationRule"("active");

-- CreateIndex
CREATE INDEX "NotificationRule_type_idx" ON "NotificationRule"("type");

-- CreateIndex
CREATE INDEX "NotificationSentLog_phone_type_sentAt_idx" ON "NotificationSentLog"("phone", "type", "sentAt");

-- CreateIndex
CREATE INDEX "NotificationSentLog_idServicio_type_idx" ON "NotificationSentLog"("idServicio", "type");

-- CreateIndex
CREATE INDEX "PingHistory_idServicio_createdAt_idx" ON "PingHistory"("idServicio", "createdAt");

-- CreateIndex
CREATE INDEX "PingHistory_createdAt_idx" ON "PingHistory"("createdAt");

-- CreateIndex
CREATE INDEX "PingHistory_success_idx" ON "PingHistory"("success");

-- CreateIndex
CREATE INDEX "SpeedTest_idServicio_idx" ON "SpeedTest"("idServicio");

-- CreateIndex
CREATE INDEX "SpeedTest_createdAt_idx" ON "SpeedTest"("createdAt");

-- CreateIndex
CREATE INDEX "NetworkScan_startedAt_idx" ON "NetworkScan"("startedAt");

-- CreateIndex
CREATE INDEX "ClientNote_idServicio_idx" ON "ClientNote"("idServicio");

-- CreateIndex
CREATE INDEX "ClientNote_priority_idx" ON "ClientNote"("priority");

-- CreateIndex
CREATE INDEX "ClientNote_isPinned_idx" ON "ClientNote"("isPinned");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTag_name_key" ON "ClientTag"("name");

-- CreateIndex
CREATE INDEX "ClientTagAssignment_idServicio_idx" ON "ClientTagAssignment"("idServicio");

-- CreateIndex
CREATE INDEX "ClientTagAssignment_tagId_idx" ON "ClientTagAssignment"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTagAssignment_idServicio_tagId_key" ON "ClientTagAssignment"("idServicio", "tagId");

-- CreateIndex
CREATE INDEX "ClientAttachment_idServicio_idx" ON "ClientAttachment"("idServicio");

-- CreateIndex
CREATE INDEX "ClientAttachment_category_idx" ON "ClientAttachment"("category");

-- CreateIndex
CREATE INDEX "AppSetting_category_idx" ON "AppSetting"("category");

-- CreateIndex
CREATE INDEX "Activity_action_idx" ON "Activity"("action");

-- CreateIndex
CREATE INDEX "Activity_entityType_entityId_idx" ON "Activity"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");

-- CreateIndex
CREATE INDEX "ExportLog_exportType_idx" ON "ExportLog"("exportType");

-- CreateIndex
CREATE INDEX "ExportLog_createdAt_idx" ON "ExportLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailySnapshot_date_key" ON "DailySnapshot"("date");

-- CreateIndex
CREATE INDEX "DailySnapshot_date_idx" ON "DailySnapshot"("date");
