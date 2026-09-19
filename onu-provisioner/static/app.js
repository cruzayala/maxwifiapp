const $ = (id) => document.getElementById(id);
let activeJobId = null;
let pollTimer = null;
let toastTimer = null;
let cloudJobId = null;
let cloudReservationToken = null;
let cloudIpCatalog = null;
let selectedCloudIp = null;
let discoveryTimer = null;
let detectedDeviceKey = null;
let discoveryDetected = false;
let wizardStep = 1;
let maxWizardStep = 1;
let cloudPrepared = false;
let autoIdentityRequestedFor = null;
let activeJobAutomatic = false;
let currentOnuInventory = null;
let cloudConnected = false;
let recoveredCloudJobId = null;
let serviceOperation = 'new_client';
let selectedExistingClient = null;
let agentDefaults = null;
let deviceAbsentScans = 0;
let operationBusy = false;
let lastProvisionSucceeded = false;
let lastRenderedJob = null;
let jobStartedAt = null;
let agentMode = 'desktop';
let previewMode = false;
let networkRanges = [];

const wizardCopy = {
  1: ['Paso 1 de 5', 'Confirma la ONU detectada', 'Continuar al cliente'],
  2: ['Paso 2 de 5', 'Prepara el cliente y reserva su IP', 'Esperando preparación'],
  3: ['Paso 3 de 5', 'Revisa la IP, VLAN y gateway', 'Continuar a WiFi'],
  4: ['Paso 4 de 5', 'Personaliza el nombre y la clave', 'Revisar instalación'],
  5: ['Paso 5 de 5', 'Confirma y aprovisiona la ONU', ''],
};

const wizardMeta = {
  1: {
    eyebrow: 'Paso 1 de 5', title: 'Detectar y preparar la ONU',
    description: 'Conecta la ONU por Ethernet. Prepararemos la red local y leeremos el equipo.',
    footer: 'Confirma la ONU detectada', next: 'Continuar al cliente',
  },
  2: {
    eyebrow: 'Paso 2 de 5', title: 'Cliente y operación',
    description: 'Vincula el cliente, protege su historial y reserva una dirección disponible.',
    footer: 'Prepara el cliente y reserva su IP', next: 'Continuar a Internet',
  },
  3: {
    eyebrow: 'Paso 3 de 5', title: 'Internet WAN',
    description: 'Revisa la VLAN, la dirección WAN y las interfaces que entregarán el servicio.',
    footer: 'Revisa la IP, VLAN y gateway', next: 'Continuar a WiFi',
  },
  4: {
    eyebrow: 'Paso 4 de 5', title: 'WiFi y gestión remota',
    description: 'Configura el acceso WiFi, TR-069 y la administración HTTP restringida.',
    footer: 'Personaliza el nombre, la clave y el ACS', next: 'Revisar instalación',
  },
  5: {
    eyebrow: 'Paso 5 de 5', title: 'Revisar y aprovisionar',
    description: 'Confirma los valores. El agente respaldará, aplicará y verificará cada etapa.',
    footer: 'Confirma y aprovisiona la ONU', next: '',
  },
};

function showToast(message, type = 'info') {
  const toast = $('toast');
  toast.textContent = message;
  toast.className = `toast visible ${type === 'error' ? 'error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 4200);
}

function value(id) { return $(id).value.trim(); }
function checked(id) { return $(id).checked; }
function numberValue(id) { return Number($(id).value); }
function serviceMode() { return document.querySelector('input[name="serviceMode"]:checked')?.value || 'router'; }

function applyServiceModeUi() {
  const bridge = serviceMode() === 'bridge';
  document.querySelectorAll('.service-mode-chooser label').forEach((label) => {
    label.classList.toggle('active', label.querySelector('input')?.checked);
  });
  $('openCloudIpPicker').disabled = bridge;
  $('cloudIp').placeholder = bridge ? 'Bridge no reserva IP' : 'Elegir del inventario';
  $('natEnabled').checked = !bridge;
  $('bindSsid1').checked = !bridge;
  $('tr069Enabled').checked = !bridge;
  $('remoteEnabled').checked = !bridge;
  if (bridge) {
    $('cloudIp').value = '';
    $('cloudNote').textContent = 'Bridge entregará la VLAN por Ethernet y no reservará una IP de cliente.';
  }
  wizardMeta[3].title = bridge ? 'Servicio Bridge' : 'Internet WAN';
  wizardMeta[3].description = bridge ? 'Revisa la VLAN y los puertos Ethernet que entregarán el servicio.' : 'Revisa la VLAN, la dirección WAN y las interfaces que entregarán el servicio.';
  renderReview();
}

function renderCloudSession(cloud = {}) {
  const state = cloud.session_state || (cloud.connected ? 'connected' : 'disconnected');
  $('cloudSessionCard').dataset.state = state;
  $('cloudLoginForm').hidden = state === 'connected';
  $('cloudLogout').hidden = state !== 'connected';
  const username = cloud.user?.username || '';
  const fingerprint = cloud.token_fingerprint ? `Token ${cloud.token_fingerprint}` : '';
  const protectedBy = cloud.credential_protection || 'Windows DPAPI CurrentUser';
  const copy = {
    connected: ['PC autorizada', `Conectado como ${username || 'administrador'}`, [fingerprint, protectedBy, cloud.last_verified_at ? `Verificada ${new Date(cloud.last_verified_at).toLocaleString('es-DO')}` : ''].filter(Boolean).join(' · ')],
    connecting: ['Conexión segura', 'Restaurando sesión', 'Validando esta PC con ISP Max...'],
    revoked: ['Sesión revocada', 'Autorización administrativa requerida', cloud.revoked_reason || 'Inicia sesión como admin para emitir un token nuevo.'],
    offline: ['Railway sin respuesta', 'Sesión guardada', 'Se reintentará cuando vuelva la conexión.'],
    disconnected: ['Conexión segura', 'Conectar con ISP Max', 'La contraseña no se guardará.'],
  }[state] || ['Conexión segura', 'Conectar con ISP Max', 'La contraseña no se guardará.'];
  $('cloudSessionEyebrow').textContent = copy[0];
  $('cloudSessionTitle').textContent = copy[1];
  $('cloudSessionMeta').textContent = copy[2];
  $('cloudStatus').textContent = state === 'connected' ? (username || 'Conectado') : state === 'connecting' ? 'Conectando' : state === 'revoked' ? 'Revocada' : 'Sin conectar';
  $('cloudStatus').closest('.cloud-health')?.classList.toggle('connected', state === 'connected');
}

const serviceOperationCopy = {
  new_client: { button: 'Preparar cliente nuevo', note: 'Se crearán WispHub, MikroTik y una reserva de IP.' },
  restore_same_onu: { button: 'Preparar restauración', note: 'Se reconfigurará la misma ONU sin recrear el servicio.' },
  replace_onu: { button: 'Preparar reemplazo', note: 'La ONU anterior quedará pendiente de retiro controlado después del corte.' },
  migrate_pon: { button: 'Preparar migración de PON', note: 'Se conservará la ONU y se registrará el PON de destino.' },
};

function operationIsExisting() { return serviceOperation !== 'new_client'; }

function setProtectedCloudFields(protectedState) {
  for (const id of ['cloudNetwork', 'cloudIp', 'cloudZone', 'cloudPlan', 'cloudUpload', 'cloudDownload']) {
    $(id).disabled = protectedState;
  }
  $('openCloudIpPicker').disabled = protectedState;
}

function setServiceOperation(mode, { preserveSelection = false } = {}) {
  serviceOperation = serviceOperationCopy[mode] ? mode : 'new_client';
  document.body.dataset.serviceOperation = serviceOperation;
  document.querySelectorAll('[data-operation-card]').forEach((card) => {
    const active = card.dataset.operationCard === serviceOperation;
    card.classList.toggle('active', active);
    card.querySelector('input').checked = active;
  });
  document.querySelectorAll('[data-operation-shortcut]').forEach((button) => {
    const active = button.dataset.operationShortcut === serviceOperation;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('intentNote').textContent = serviceOperationCopy[serviceOperation].note;
  const existing = operationIsExisting();
  $('preservationStrip').hidden = !existing;
  $('existingClientPicker').hidden = !existing;
  $('clientNameField').hidden = existing;
  $('targetPonField').hidden = serviceOperation !== 'migrate_pon';
  $('operationReasonField').hidden = !existing;
  setProtectedCloudFields(existing);
  if (existing) $('replaceConflictingWan').checked = true;
  $('cloudReserve').textContent = serviceOperationCopy[serviceOperation].button;
  if (!preserveSelection) {
    selectedExistingClient = null;
    $('selectedExistingClient').hidden = true;
    $('existingClientResults').hidden = true;
    $('existingClientSearch').value = '';
    if (existing) {
      for (const id of ['cloudClientName', 'cloudIp', 'cloudUpload', 'cloudDownload']) $(id).value = '';
      for (const id of ['cloudZone', 'cloudPlan', 'cloudNetwork']) $(id).value = '';
    }
  }
  cloudPrepared = false;
  cloudJobId = null;
  cloudReservationToken = null;
  $('cloudReserve').disabled = !cloudConnected;
  $('cloudNote').textContent = serviceOperationCopy[serviceOperation].note;
  updateDerived();
  renderWizard();
}

function networkFromIp(ip) {
  const parts = String(ip || '').split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.0/24` : '';
}

function selectExistingClient(client) {
  selectedExistingClient = client;
  $('cloudClientName').value = client.nombre || client.usuario || `Cliente #${client.idServicio}`;
  $('cloudIp').value = client.ip || '';
  $('wanIp').value = client.ip || '';
  $('cloudZone').value = client.zonaId ? String(client.zonaId) : '';
  $('cloudPlan').value = client.planInternetId ? String(client.planInternetId) : '';
  $('cloudUpload').value = client.uploadMbps || '';
  $('cloudDownload').value = client.downloadMbps || '';
  const cidr = networkFromIp(client.ip);
  $('cloudNetwork').value = cidr;
  applyNetworkProfile(cidr);
  const olt = client.oltOnu;
  $('selectedExistingClient').innerHTML = `
    <div><strong>${escapeHtml(client.nombre || client.usuario || `Cliente #${client.idServicio}`)}</strong>
    <span>#${escapeHtml(client.idServicio)} · ${escapeHtml(client.planInternetName || 'Plan sin identificar')} · ${escapeHtml(olt?.onuIndex || 'Sin ONU vinculada')}</span></div>
    <b>${escapeHtml(client.ip || 'Sin IP')}</b>`;
  $('selectedExistingClient').hidden = false;
  $('existingClientResults').hidden = true;
  if (client.ssidRouterWifi) $('ssid').value = client.ssidRouterWifi;
  else $('ssid').value = window.OnuWizard.buildSsid(value('cloudClientName'), client.ip);
  $('wifiPassword').value = window.OnuWizard.generateWifiPassword();
  updateDerived();
  showToast('Cliente seleccionado; su servicio comercial quedó bloqueado para esta operación');
}

async function searchExistingClients() {
  const search = value('existingClientSearch');
  if (search.length < 2) return showToast('Escribe al menos dos caracteres para buscar', 'error');
  const target = $('existingClientResults');
  target.hidden = false;
  target.innerHTML = '<div class="ip-modal-empty">Buscando cliente...</div>';
  try {
    const clients = await cloudFetch(`/api/cloud/clients?q=${encodeURIComponent(search)}`);
    if (!clients.length) {
      target.innerHTML = '<div class="ip-modal-empty">No se encontraron clientes.</div>';
      return;
    }
    target.innerHTML = clients.map((client, index) => `
      <button type="button" data-client-index="${index}">
        <span><strong>${escapeHtml(client.nombre || client.usuario || `Cliente #${client.idServicio}`)}</strong>
        <small>#${escapeHtml(client.idServicio)} · ${escapeHtml(client.usuario || 'Sin usuario')} · ${escapeHtml(client.planInternetName || 'Sin plan')}</small></span>
        <b>${escapeHtml(client.ip || 'Sin IP')}</b>
      </button>`).join('');
    target.querySelectorAll('[data-client-index]').forEach((button) => {
      button.addEventListener('click', () => selectExistingClient(clients[Number(button.dataset.clientIndex)]));
    });
  } catch (error) {
    target.innerHTML = `<div class="ip-modal-empty">${escapeHtml(error.message)}</div>`;
  }
}

function updateDerived() {
  $('remoteUrl').textContent = `http://${value('wanIp') || '—'}`;
  $('wanReady').textContent = value('wanIp') || 'Sin definir';
  const option = $('adapterIndex').selectedOptions[0];
  $('adapterReady').textContent = option?.dataset?.name || 'Sin seleccionar';
  const profile = (agentDefaults?.supported_devices || []).find((row) => row.model === value('deviceModel'));
  $('deviceSummary').textContent = `${profile?.vendor || 'ONU'} ${value('deviceModel')} · ${value('deviceHost')}`;
  renderReview();
}

function renderReviewLegacy() {
  if (!$('reviewClient')) return;
  $('reviewClient').textContent = value('cloudClientName') || 'Configuración local';
  $('reviewOnu').textContent = `${value('deviceModel') || 'ONU'} · ${value('deviceHost') || 'Sin IP'}`;
  const wanService = checked('tr069Enabled') ? 'TR069_INTERNET' : 'INTERNET';
  $('reviewWan').textContent = `${wanService} · ${value('wanIp') || 'Sin IP'} · VLAN ${value('vlanId') || '—'} · ${value('gateway') || 'Sin gateway'}`;
  $('reviewWifi').textContent = `${value('ssid') || 'Sin nombre'} · WPA2/AES`;
  $('reviewRemote').textContent = checked('remoteEnabled') ? value('remoteSource') || 'Sin origen' : 'Desactivado';
  $('reviewCloud').textContent = cloudPrepared && cloudJobId ? `Expediente ${cloudJobId.slice(0, 8)} preparado` : 'Solo configuración local';
}

function renderWizardLegacy(scroll = false) {
  document.body.dataset.wizardStep = String(wizardStep);
  const copy = wizardCopy[wizardStep];
  $('wizardHint').textContent = copy[0];
  $('wizardFooterTitle').textContent = wizardStep === 2 && operationIsExisting()
    ? 'Selecciona el cliente y protege su servicio'
    : copy[1];
  $('wizardNext').textContent = copy[2];
  $('wizardBack').disabled = wizardStep === 1;
  $('wizardNext').hidden = wizardStep === 5;
  $('wizardNext').disabled = wizardStep === 2 && (!cloudPrepared || !cloudConnected);
  document.querySelectorAll('[data-wizard-target]').forEach((button) => {
    const target = Number(button.dataset.wizardTarget);
    button.classList.toggle('active', target === wizardStep);
    button.classList.toggle('complete', target < wizardStep || target < maxWizardStep);
    button.disabled = target > maxWizardStep;
  });
  renderReview();
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateWizardStepLegacy(step) {
  if (step === 1 && !discoveryDetected && !detectedDeviceKey) {
    showToast('Conecta la ONU y espera a que sea detectada', 'error');
    return false;
  }
  if (step === 2 && (!cloudPrepared || !cloudConnected)) {
    showToast(cloudPrepared ? 'Conecta ONU Studio con ISP Max para recuperar la instalación' : 'Prepara la instalación y reserva una IP antes de continuar', 'error');
    return false;
  }
  if (step === 3) {
    for (const id of ['vlanId', 'wanIp', 'subnetMask', 'gateway', 'primaryDns']) {
      if (!$(id).reportValidity()) return false;
    }
    if (checked('tr069Enabled')) {
      for (const id of ['tr069AcsUrl', 'tr069Username', 'tr069ConnectionUsername']) {
        if (!$(id).reportValidity()) return false;
      }
    }
  }
  if (step === 4) {
    if (!$('ssid').reportValidity() || !$('wifiPassword').reportValidity()) return false;
  }
  return true;
}

function setWizardStep(step) {
  const target = Math.max(1, Math.min(5, Number(step)));
  if (target > wizardStep && !validateWizardStep(wizardStep)) return;
  maxWizardStep = Math.max(maxWizardStep, target);
  wizardStep = target;
  renderWizard(true);
}

function applyNetworkProfile(cidr) {
  if (!cidr) return;
  try {
    const profile = window.OnuWizard.deriveNetworkProfile(cidr);
    const configured = networkRanges.find((item) => item.cidr === cidr);
    $('subnetMask').value = profile.subnetMask;
    $('gateway').value = configured?.gateway || profile.gateway;
    $('primaryDns').value = configured?.primary_dns || '8.8.8.8';
    $('secondaryDns').value = configured?.secondary_dns || '';
    $('vlanId').value = configured?.vlan || $('vlanId').value;
    $('remoteSource').value = `${configured?.gateway || profile.gateway}/32`;
  } catch (error) {
    showToast(`La IP fue elegida, pero revisa la red: ${error.message}`, 'error');
  }
}

function generateWifiDefaults() {
  $('ssid').value = window.OnuWizard.buildSsid(value('cloudClientName'), value('cloudIp') || value('wanIp'));
  $('wifiPassword').value = window.OnuWizard.generateWifiPassword();
  renderReview();
  showToast('Nombre y clave WiFi generados; puedes editarlos');
}

function inventoryValue(content) {
  if (content === null || content === undefined || content === '' || content === '--') return 'No disponible';
  return String(content);
}

function renderInventoryFacts(targetId, facts) {
  $(targetId).innerHTML = facts.map(([label, content]) =>
    `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(inventoryValue(content))}</dd></div>`
  ).join('');
}

function renderOnuInventoryLegacy(inventory) {
  if (!inventory) return;
  currentOnuInventory = inventory;
  $('onuInventory').hidden = false;
  const identity = inventory.identity || {};
  const device = inventory.device || {};
  const optical = inventory.optical || {};
  const wan = (inventory.wan || []).find((item) => String(item.service || '').includes('INTERNET')) || inventory.wan?.[0];
  const ports = inventory.ethernet?.ports || [];
  const radio = inventory.wifi?.radios?.[0];
  const errors = Object.values(inventory.errors || {});

  $('inventoryStatus').textContent = errors.length ? 'Lectura parcial' : 'Datos reales';
  $('inventoryStatus').className = `inventory-status ${errors.length ? 'warning' : 'ready'}`;
  $('inventoryCollectedAt').textContent = inventory.collected_at
    ? `Leido ${new Date(inventory.collected_at).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'medium' })}`
    : 'Leido directamente de la ONU';
  $('inventorySerial').textContent = inventoryValue(identity.serial);
  $('inventoryRawSerial').textContent = inventoryValue(identity.serial_raw);
  $('inventoryPonState').textContent = inventoryValue(device.registration_status);
  $('inventoryPonState').className = String(device.registration_status || '').startsWith('O5') ? 'text-success' : 'text-warning';
  $('inventoryFirmware').textContent = `${inventoryValue(device.hardware_version)} / ${inventoryValue(device.software_version)}`;
  $('inventoryMac').textContent = inventoryValue(device.mac || inventory.ethernet?.mac);
  $('inventoryResources').textContent = `CPU ${inventoryValue(device.cpu_usage)} / RAM ${inventoryValue(device.memory_usage)}`;

  const noSignal = !optical.signal_available;
  const alerts = [];
  if (noSignal) alerts.push('La ONU no recibe senal optica; RX y TX se mediran al conectarla a la fibra.');
  if (errors.length) alerts.push(errors.join(' '));
  $('inventoryAlert').hidden = !alerts.length;
  $('inventoryAlert').textContent = alerts.join(' ');

  $('inventoryWanState').textContent = wan ? `${inventoryValue(wan.status)} - ${inventoryValue(wan.name)}` : 'Sin perfiles';
  $('inventoryWanState').className = String(wan?.status || '').toLowerCase() === 'connected' ? 'text-success' : 'text-warning';
  $('useCurrentWan').disabled = !wan;
  renderInventoryFacts('inventoryWan', wan ? [
    ['VLAN / prioridad', `${inventoryValue(wan.vlan_id)} / ${inventoryValue(wan.priority)}`],
    ['Modo', `${inventoryValue(wan.encapsulation)} - ${inventoryValue(wan.mode)}`],
    ['IP configurada', wan.ip_address], ['Mascara', wan.subnet_mask], ['Gateway', wan.gateway],
    ['DNS', [wan.primary_dns, wan.secondary_dns].filter(Boolean).join(', ') || null],
    ['NAT', wan.nat_enabled ? 'Activo' : 'Inactivo'], ['MAC WAN', wan.mac]
  ] : [['Perfil', null]]);

  $('inventoryOpticalState').textContent = noSignal ? 'Sin enlace PON' : 'Senal disponible';
  $('inventoryOpticalState').className = noSignal ? 'text-warning' : 'text-success';
  renderInventoryFacts('inventoryOptical', [
    ['RX', optical.rx_power_dbm == null ? null : `${optical.rx_power_dbm} dBm`],
    ['TX', optical.tx_power_dbm == null ? null : `${optical.tx_power_dbm} dBm`],
    ['Temperatura', optical.temperature_c == null ? null : `${optical.temperature_c} C`],
    ['Voltaje', optical.voltage_mv == null ? null : `${optical.voltage_mv} mV`],
    ['Modulo', optical.module_vendor], ['Serial optico', optical.module_serial]
  ]);

  const upPorts = ports.filter((port) => String(port.link).toLowerCase() === 'up').length;
  $('inventoryLanState').textContent = `${upPorts} de ${ports.length || 4} enlazados`;
  $('inventoryPorts').innerHTML = ports.length ? ports.map((port) => `
    <div class="${String(port.link).toLowerCase() === 'up' ? 'up' : ''}">
      <span>LAN ${port.port}</span><strong>${escapeHtml(port.link)}</strong><small>${escapeHtml(port.speed || '-')}</small>
    </div>`).join('') : '<span class="inventory-empty">No disponible</span>';

  $('inventoryWifiState').textContent = radio ? `${radio.enabled ? 'Activo' : 'Inactivo'} - ${inventoryValue(radio.ssid)}` : 'Sin radios';
  $('inventoryWifiState').className = radio?.enabled ? 'text-success' : 'text-warning';
  $('useCurrentWifi').disabled = !radio?.ssid;
  renderInventoryFacts('inventoryWifi', radio ? [
    ['SSID', radio.ssid], ['Canal', radio.channel], ['Estandar', radio.standard],
    ['Seguridad', `${inventoryValue(radio.authentication)} / ${inventoryValue(radio.encryption)}`],
    ['Difusion', radio.hidden ? 'Oculto' : 'Visible'], ['Clientes', String(inventory.wifi?.clients?.length || 0)]
  ] : [['Radio', null]]);

  renderInventoryFacts('inventoryTechnical', [
    ['Modelo', device.model], ['Descripcion', device.description], ['Fabricante', device.manufacturer_info],
    ['ONT ID', device.ont_id], ['Autenticacion', identity.authentication_mode === 'loid' ? 'LOID' : 'Serial + password'],
    ['Fecha firmware', device.firmware_release], ['Hora interna', device.system_time],
    ['Acceso remoto', inventory.remote_access?.rules?.length ? `${inventory.remote_access.rules.length} regla(s) HTTP` : null],
    ['Longitud de onda TX/RX', optical.tx_wavelength_nm && optical.rx_wavelength_nm ? `${optical.tx_wavelength_nm}/${optical.rx_wavelength_nm} nm` : null]
  ]);
}

function useCurrentWanConfiguration() {
  const wan = (currentOnuInventory?.wan || []).find((item) => String(item.service || '').includes('INTERNET')) || currentOnuInventory?.wan?.[0];
  if (!wan) return;
  const values = { vlanId: wan.vlan_id, priority: wan.priority, wanIp: wan.ip_address, subnetMask: wan.subnet_mask, gateway: wan.gateway, primaryDns: wan.primary_dns, secondaryDns: wan.secondary_dns, mtu: wan.mtu };
  Object.entries(values).forEach(([id, content]) => { if (content !== null && content !== undefined && $(id)) $(id).value = content; });
  updateDerived();
  showToast('Configuracion WAN actual copiada al formulario');
}

function useCurrentWifiConfiguration() {
  const radio = currentOnuInventory?.wifi?.radios?.[0];
  if (!radio?.ssid) return;
  $('ssid').value = radio.ssid;
  $('broadcast').checked = Boolean(radio.broadcast);
  $('wmmEnabled').checked = Boolean(radio.wmm_enabled);
  renderReview();
  showToast('SSID actual copiado; la clave existente nunca se lee');
}

function updateResetDeviceAction() {
  $('resetDeviceSession').hidden = !(detectedDeviceKey || currentOnuInventory || value('cloudSerial'));
}

function resetDeviceSession({ preserveCloud = false, notify = true } = {}) {
  clearTimeout(pollTimer);
  document.body.classList.remove('provision-complete');
  $('completionPanel').hidden = true;
  activeJobId = null;
  activeJobAutomatic = false;
  detectedDeviceKey = null;
  discoveryDetected = false;
  autoIdentityRequestedFor = null;
  currentOnuInventory = null;
  deviceAbsentScans = 0;
  lastProvisionSucceeded = false;
  lastRenderedJob = null;
  jobStartedAt = null;
  $('provisionForm').reset();
  if (agentDefaults) populateDefaults(agentDefaults);
  for (const id of ['devicePassword', 'wifiPassword', 'tr069Password', 'tr069ConnectionPassword']) $(id).value = '';
  $('ssid').value = '';
  $('onuInventory').hidden = true;
  $('discoverySerial').textContent = '—';
  $('cloudSerial').value = '';
  $('cloudSerialNote').textContent = 'Lectura automática pendiente';
  $('resultBox').hidden = true;
  $('timeline').innerHTML = '<li class="empty-state">No hay una ejecución activa.</li>';
  $('progressBar').style.width = '0';
  $('progressPercent').textContent = '0%';
  $('progressStage').textContent = 'En espera';
  $('jobBadge').className = 'job-badge idle';
  $('jobBadge').textContent = 'En espera';
  $('jobTitle').textContent = 'Listo para comenzar';
  document.querySelectorAll('[data-wizard-target]').forEach((button) => button.classList.remove('complete'));

  if (!preserveCloud) {
    cloudJobId = null;
    cloudReservationToken = null;
    selectedCloudIp = null;
    cloudPrepared = false;
    recoveredCloudJobId = null;
    selectedExistingClient = null;
    for (const id of ['cloudClientName', 'cloudIp', 'cloudUpload', 'cloudDownload', 'operationReason', 'targetPonIndex']) $(id).value = '';
    for (const id of ['cloudNetwork', 'cloudZone', 'cloudPlan']) $(id).value = '';
    $('selectedExistingClient').hidden = true;
    $('existingClientResults').hidden = true;
    $('existingClientSearch').value = '';
    $('cloudReserve').disabled = !cloudConnected;
    $('cloudNote').textContent = cloudConnected
      ? 'Sesión de ISP Max conservada. Detecta la nueva ONU para preparar el cliente.'
      : 'Conecta ONU Studio con ISP Max para preparar el cliente.';
    setServiceOperation('new_client');
  } else {
    $('cloudNote').textContent = 'La ONU fue retirada; el expediente pendiente se conserva para reanudarlo sin duplicar recursos.';
  }

  wizardStep = 1;
  maxWizardStep = 1;
  updateResetDeviceAction();
  updateDerived();
  renderWizard(true);
  if (notify) showToast(preserveCloud ? 'Equipo retirado; expediente pendiente conservado' : 'Sesión limpia; conecta la siguiente ONU');
}

function populateDefaults(data) {
  const select = $('adapterIndex');
  select.innerHTML = '';
  data.adapters.forEach((adapter) => {
    const option = document.createElement('option');
    option.value = adapter.index;
    option.dataset.name = adapter.name;
    const ips = [...(adapter.addresses || []), ...(adapter.ipv6_addresses || [])].join(', ');
    option.disabled = adapter.supported === false;
    option.textContent = `${adapter.name} · ${adapter.description}${ips ? ` · ${ips}` : ''}${adapter.supported === false ? ' · No apta' : ''}`;
    option.selected = adapter.index === data.local_network.adapter_index;
    select.appendChild(option);
  });
  if (!data.adapters.length) {
    select.innerHTML = '<option value="">No se detectaron tarjetas de red</option>';
  }
  const modelSelect = $('deviceModel');
  (data.supported_devices || []).forEach((profile) => {
    let option = Array.from(modelSelect.options).find((row) => row.value === profile.model);
    if (!option) {
      option = document.createElement('option');
      option.value = profile.model;
      modelSelect.appendChild(option);
    }
    option.textContent = `${profile.vendor} ${profile.model}`;
  });
  modelSelect.value = data.device.model;
  $('deviceUsername').value = data.device.username;
  $('localAddress').value = data.local_network.address;
  $('prefixLength').value = data.local_network.prefix_length;
  $('deviceHost').value = data.device.host;
  $('vlanId').value = data.wan.vlan_id;
  $('priority').value = data.wan.priority;
  $('wanIp').value = data.wan.ip_address;
  $('subnetMask').value = data.wan.subnet_mask;
  $('gateway').value = data.wan.gateway;
  $('primaryDns').value = data.wan.primary_dns;
  $('secondaryDns').value = data.wan.secondary_dns || '';
  $('mtu').value = data.wan.mtu;
  if (data.tr069) {
    $('tr069Enabled').checked = data.tr069.enabled !== false;
    $('tr069AcsUrl').value = data.tr069.acs_url;
    $('tr069Username').value = data.tr069.username;
    $('tr069ConnectionUsername').value = data.tr069.connection_request_username;
    $('tr069Interval').value = String(data.tr069.periodic_inform_interval || 900);
    const protectedCredentials = data.tr069.has_password && data.tr069.has_connection_request_password;
    $('tr069CredentialStatus').textContent = protectedCredentials ? 'Credenciales protegidas listas' : 'Completa las claves antes de aprovisionar';
  }
  if (data.cloud?.base_url) $('cloudUrl').value = data.cloud.base_url;
  cloudConnected = Boolean(data.cloud?.connected);
  renderCloudSession(data.cloud || {});
  const handoff = new URLSearchParams(window.location.search);
  if (handoff.get('wanIp')) $('wanIp').value = handoff.get('wanIp');
  if (handoff.get('vlan')) $('vlanId').value = handoff.get('vlan');
  if (handoff.get('ssid')) $('ssid').value = handoff.get('ssid').slice(0, 32);
  updateDerived();
}

function applyDetectedDevice(device) {
  if (!device) return;
  const key = `${device.host}:${device.model || ''}:${device.adapter_index || ''}`;
  if (detectedDeviceKey === key) return;
  detectedDeviceKey = key;
  $('deviceHost').value = device.host;
  if (device.adapter_index) $('adapterIndex').value = String(device.adapter_index);
  if (device.model && device.model !== 'Modelo no identificado' && device.model !== 'Panel HTTP detectado') {
    let option = Array.from($('deviceModel').options).find((row) => row.value === device.model);
    if (!option) {
      option = document.createElement('option');
      option.value = device.model;
      option.textContent = device.model;
      $('deviceModel').appendChild(option);
    }
    $('deviceModel').value = device.model;
    const profile = (agentDefaults?.supported_devices || []).find((row) => row.model === device.model);
    if (profile) {
      $('deviceUsername').value = profile.username || '';
      $('devicePassword').value = '';
      $('deviceUsername').placeholder = profile.username ? 'Usuario técnico' : 'Usuario de la etiqueta';
      $('devicePassword').placeholder = profile.has_password ? 'Usar la guardada en el agente' : 'Contraseña de la etiqueta';
    }
  }
  updateDerived();
  const profile = (agentDefaults?.supported_devices || []).find((row) => row.model === device.model);
  const credentialsReady = Boolean(value('deviceUsername') && (value('devicePassword') || profile?.has_password));
  if (!value('cloudSerial') && autoIdentityRequestedFor !== key && credentialsReady) {
    autoIdentityRequestedFor = key;
    $('discoverySerial').textContent = 'Leyendo...';
    $('cloudSerialNote').textContent = 'Autenticando en modo lectura';
    setTimeout(() => startJob('check', { automatic: true }), 0);
  } else if (!credentialsReady) {
    $('discoverySerial').textContent = 'Credenciales requeridas';
    $('cloudSerialNote').textContent = 'Ingresa los datos impresos en la etiqueta del equipo';
  }
}

function renderDiscovery(state) {
  const panel = $('discoveryPanel');
  panel.className = `discovery-panel ${state.status || 'scanning'}`;
  const device = state.device;
  if (state.detected && device) {
    deviceAbsentScans = 0;
    discoveryDetected = true;
    maxWizardStep = Math.max(maxWizardStep, 2);
    $('discoveryTitle').textContent = `${device.vendor || 'ONU'} ${device.model || ''}`.trim();
    $('discoveryBadge').textContent = 'ONU detectada';
    $('discoveryModel').textContent = device.model || 'Panel HTTP';
    $('discoveryHost').textContent = device.host;
    $('discoveryAdapter').textContent = device.adapter_name || 'Ethernet';
    $('discoveryLatency').textContent = device.latency_ms == null ? 'HTTP activo' : `${device.latency_ms} ms`;
    if (!$('cloudSerial').value && autoIdentityRequestedFor !== `${device.host}:${device.model || ''}:${device.adapter_index || ''}`) {
      $('discoverySerial').textContent = 'Pendiente';
    }
    applyDetectedDevice(device);
    updateResetDeviceAction();
  } else {
    if (['cable_disconnected', 'not_detected'].includes(state.status)) deviceAbsentScans += 1;
    else deviceAbsentScans = 0;
    if (detectedDeviceKey && window.OnuWizard.shouldResetForAbsence(state.status, deviceAbsentScans, operationBusy)) {
      resetDeviceSession({ preserveCloud: cloudPrepared && !lastProvisionSucceeded });
    }
    discoveryDetected = Boolean(detectedDeviceKey);
    const labels = {
      scanning: ['Buscando una ONU conectada', 'Escaneando'],
      network_setup_required: ['Ethernet conectado; falta preparar la red', 'Requiere preparación'],
      not_detected: ['No se encontró la ONU', 'Sin respuesta'],
      cable_disconnected: ['Conecta la ONU por Ethernet', 'Sin enlace'],
      error: ['No se pudo consultar la red', 'Error']
    };
    const label = labels[state.status] || labels.scanning;
    $('discoveryTitle').textContent = label[0];
    $('discoveryBadge').textContent = label[1];
    $('discoveryModel').textContent = 'No detectado';
    $('discoveryHost').textContent = '—';
    $('discoveryAdapter').textContent = state.wired_adapters?.[0]?.name || '—';
    $('discoveryLatency').textContent = '—';
    if (!value('cloudSerial')) $('discoverySerial').textContent = '—';
  }
  $('discoveryAction').textContent = state.next_action || 'El agente seguirá revisando la conexión local.';
  renderWizard();
}

async function loadDiscovery(force = false) {
  if (previewMode) return;
  const button = $('scanNow');
  if (force) button.disabled = true;
  try {
    const response = await fetch(force ? '/api/discovery/scan' : '/api/discovery', {
      method: force ? 'POST' : 'GET',
      cache: 'no-store'
    });
    const state = await response.json();
    if (!response.ok) throw new Error(formatApiError(state));
    renderDiscovery(state);
  } catch (error) {
    renderDiscovery({ status: 'error', next_action: error.message });
  } finally {
    button.disabled = false;
  }
}

async function loadStartup() {
  try {
    const [startupResponse, installationResponse] = await Promise.all([
      fetch('/api/startup', { cache: 'no-store' }),
      fetch('/api/installation', { cache: 'no-store' }),
    ]);
    const state = await startupResponse.json();
    const installation = installationResponse.ok ? await installationResponse.json() : {};
    $('startupEnabled').checked = Boolean(state.enabled);
    $('startupEnabled').disabled = !state.supported;
    $('startupNote').textContent = state.supported
      ? state.enabled ? 'Agente residente activo' : 'Recomendado para Railway'
      : state.reason || 'Disponible en el EXE';
    $('installationTitle').textContent = installation.installed
      ? `ONU Studio v${installation.version || '--'} instalado`
      : 'Ejecución portátil';
    $('installationPath').textContent = installation.installPath || 'Abre el EXE para instalarlo en este usuario de Windows';
    $('credentialProtection').textContent = installation.credentialProtection || 'Windows DPAPI CurrentUser';
    $('installationBadge').textContent = installation.installed && installation.startupEnabled ? 'Activo' : installation.installed ? 'Instalado' : 'Portátil';
    $('installationBadge').classList.toggle('active', Boolean(installation.installed && installation.startupEnabled));
  } catch {
    $('startupEnabled').disabled = true;
    $('startupNote').textContent = 'Estado no disponible';
    $('installationTitle').textContent = 'Estado no disponible';
    $('installationBadge').textContent = 'Sin lectura';
  }
}

async function changeStartup() {
  const control = $('startupEnabled');
  control.disabled = true;
  try {
    const response = await fetch('/api/startup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: control.checked })
    });
    const state = await response.json();
    if (!response.ok) throw new Error(formatApiError(state));
    showToast(state.enabled ? 'ONU Studio iniciará con Windows' : 'Inicio automático desactivado');
  } catch (error) {
    control.checked = !control.checked;
    showToast(error.message, 'error');
  } finally {
    loadStartup();
  }
}

function buildDevice() {
  const device = {
    host: value('deviceHost'),
    model: value('deviceModel'),
    username: value('deviceUsername')
  };
  if (value('devicePassword')) device.password = value('devicePassword');
  return device;
}

function buildLocalNetwork() {
  return {
    adapter_index: numberValue('adapterIndex'),
    address: value('localAddress'),
    prefix_length: numberValue('prefixLength')
  };
}

function buildPayload() {
  const lanPorts = [1, 2, 3, 4].filter((port) => checked(`bindLan${port}`));
  return {
    device: buildDevice(),
    local_network: buildLocalNetwork(),
    wan: {
      vlan_id: numberValue('vlanId'),
      priority: numberValue('priority'),
      ip_address: value('wanIp'),
      subnet_mask: value('subnetMask'),
      gateway: value('gateway'),
      primary_dns: value('primaryDns'),
      secondary_dns: value('secondaryDns') || null,
      mtu: numberValue('mtu'),
      nat_enabled: serviceMode() === 'router' && checked('natEnabled'),
      bind_lan_ports: lanPorts,
      bind_ssid1: serviceMode() === 'router' && checked('bindSsid1')
    },
    wifi: {
      enabled: checked('wifiEnabled'),
      ssid: value('ssid'),
      password: serviceMode() === 'bridge' ? '12345678' : value('wifiPassword'),
      broadcast: checked('broadcast'),
      wmm_enabled: checked('wmmEnabled'),
      wps_enabled: checked('wpsEnabled'),
      max_clients: numberValue('maxClients')
    },
    tr069: {
      enabled: serviceMode() === 'router' && checked('tr069Enabled'),
      acs_url: value('tr069AcsUrl'),
      username: value('tr069Username'),
      password: value('tr069Password') || null,
      connection_request_username: value('tr069ConnectionUsername'),
      connection_request_password: value('tr069ConnectionPassword') || null,
      periodic_inform_interval: numberValue('tr069Interval')
    },
    remote_access: {
      enabled: serviceMode() === 'router' && checked('remoteEnabled'),
      source: value('remoteSource'),
      http: true,
      telnet: false,
      ssh: false,
      ftp: false,
      icmp: false
    },
    save_configuration: checked('saveConfiguration'),
    create_backups: checked('createBackups'),
    replace_conflicting_wan: checked('replaceConflictingWan'),
    cloud_job_id: cloudJobId,
    service_operation: serviceOperation,
    service_mode: serviceMode()
  };
}

function optionLabel(item) {
  return item.nombre || item.name || item.descripcion || `#${item.id}`;
}

function fillSelect(id, items, placeholder) {
  const select = $(id);
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>`;
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = optionLabel(item);
    select.appendChild(option);
  });
}

function inferPlanSpeed(label) {
  const match = String(label || '').match(/(\d+(?:\.\d+)?)\s*(?:m|mb|mbps)/i);
  if (!match) return null;
  const speed = Number(match[1]);
  return Number.isFinite(speed) && speed > 0 ? speed : null;
}

async function cloudFetch(path, options) {
  const response = await fetch(path, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(formatApiError(payload));
  return payload;
}

async function loadCloudCatalog(selectedCidr = '') {
  const [ipam, commercial] = await Promise.all([
    cloudFetch(`/api/cloud/ip-catalog${selectedCidr ? `?cidr=${encodeURIComponent(selectedCidr)}` : ''}`),
    cloudFetch('/api/cloud/commercial-catalog')
  ]);
  if (!selectedCidr) {
    $('cloudNetwork').innerHTML = '<option value="">Todos los segmentos</option>' + ipam.networks
      .map((network) => `<option value="${escapeHtml(network.cidr)}">${escapeHtml(network.cidr)} - ${network.available} libres</option>`).join('');
  }
  cloudIpCatalog = ipam;
  selectedCloudIp = ipam.recommended || null;
  $('cloudIpNetwork').innerHTML = '<option value="">Todos los segmentos</option>' + ipam.networks
    .map((network) => `<option value="${escapeHtml(network.cidr)}">${escapeHtml(network.cidr)} - ${network.available} libres</option>`).join('');
  $('cloudIpNetwork').value = selectedCidr;
  renderCloudIpCatalog();
  fillSelect('cloudZone', commercial.zones || [], 'Seleccionar zona');
  fillSelect('cloudPlan', commercial.plans || [], 'Seleccionar plan');
}

function renderCloudIpCatalog() {
  const list = $('cloudIpList');
  const search = value('cloudIpSearch').toLowerCase();
  const rows = (cloudIpCatalog?.rows || [])
    .filter((row) => !row.reservation)
    .filter((row) => !search || row.ip.toLowerCase().includes(search));
  $('cloudIpNote').textContent = cloudIpCatalog?.stale
    ? 'Inventario guardado: la disponibilidad se comprobara nuevamente al reservar.'
    : `${rows.length} direcciones disponibles en el filtro actual.`;
  if (!rows.length) {
    list.innerHTML = '<div class="ip-modal-empty">No hay direcciones disponibles con este filtro.</div>';
    return;
  }
  list.innerHTML = rows.map((row) => `
    <button type="button" data-ip="${escapeHtml(row.ip)}" class="${selectedCloudIp?.ip === row.ip ? 'selected' : ''}">
      <span><strong>${escapeHtml(row.ip)}</strong><small>${escapeHtml(row.cidr || 'Segmento sin identificar')}</small></span>
      <b class="${row.availabilityConfidence === 'probe_required' ? 'probe' : ''}">${row.recommended ? 'Recomendada' : row.availabilityConfidence === 'probe_required' ? 'Requiere prueba' : 'Verificada'}</b>
    </button>`).join('');
  list.querySelectorAll('[data-ip]').forEach((button) => button.addEventListener('click', () => {
    selectedCloudIp = rows.find((row) => row.ip === button.dataset.ip) || null;
    $('cloudIpSelected').textContent = selectedCloudIp?.ip || 'Ninguna';
    $('confirmCloudIp').disabled = !selectedCloudIp;
    renderCloudIpCatalog();
  }));
}

function openCloudIpPicker() {
  if (!cloudIpCatalog) return showToast('Conecta primero ONU Studio con ISP Max', 'error');
  selectedCloudIp = (cloudIpCatalog.rows || []).find((row) => row.ip === value('cloudIp')) || selectedCloudIp || cloudIpCatalog.recommended || null;
  $('cloudIpSelected').textContent = selectedCloudIp?.ip || 'Ninguna';
  $('confirmCloudIp').disabled = !selectedCloudIp;
  $('cloudIpBackdrop').hidden = false;
  $('cloudIpModal').hidden = false;
  renderCloudIpCatalog();
}

function closeCloudIpPicker() {
  $('cloudIpBackdrop').hidden = true;
  $('cloudIpModal').hidden = true;
}

function confirmCloudIp() {
  if (!selectedCloudIp) return;
  $('cloudIp').value = selectedCloudIp.ip;
  $('wanIp').value = selectedCloudIp.ip;
  $('cloudNetwork').value = selectedCloudIp.cidr || '';
  applyNetworkProfile(selectedCloudIp.cidr);
  updateDerived();
  closeCloudIpPicker();
}

async function connectCloud() {
  try {
    $('cloudConnect').disabled = true;
    renderCloudSession({ session_state: 'connecting' });
    const result = await cloudFetch('/api/cloud/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base_url: value('cloudUrl'), username: value('cloudUsername'), password: value('cloudPassword') })
    });
    $('cloudPassword').value = '';
    $('cloudStatus').textContent = `Conectado: ${result.user?.username || value('cloudUsername')}`;
    $('cloudStatus').className = 'cloud-status connected';
    cloudConnected = true;
    renderCloudSession(result);
    renderCoordinationState(true);
    await loadCloudCatalog();
    if (recoveredCloudJobId) {
      const recovered = await cloudFetch(`/api/cloud/jobs/${encodeURIComponent(recoveredCloudJobId)}`);
      if (!window.OnuWizard.isRecoverableCloudJobStatus(recovered.status)) {
        const terminalStatus = recovered.status || 'cerrado';
        recoveredCloudJobId = null;
        cloudJobId = null;
        cloudPrepared = false;
        cloudReservationToken = null;
        $('cloudClientName').value = '';
        $('cloudIp').value = '';
        $('wanIp').value = '';
        $('ssid').value = '';
        $('wifiPassword').value = '';
        $('cloudReserve').disabled = false;
        $('cloudNote').textContent = `El expediente anterior esta ${terminalStatus} y no se reutilizara. Prepara un cliente nuevo.`;
        wizardStep = 2;
        maxWizardStep = 2;
        updateDerived();
        renderWizard(true);
        showToast(`El expediente anterior esta ${terminalStatus}; no se aplicara a la ONU`, 'error');
        return;
      }
      setServiceOperation(recovered.mode || 'new_client', { preserveSelection: true });
      $('cloudClientName').value = recovered.clientName || '';
      $('cloudIp').value = recovered.ip || value('wanIp');
      $('cloudSerial').value = recovered.serial || value('cloudSerial');
      if (recovered.zoneId) $('cloudZone').value = String(recovered.zoneId);
      if (recovered.planId) $('cloudPlan').value = String(recovered.planId);
      if (recovered.uploadMbps) $('cloudUpload').value = recovered.uploadMbps;
      if (recovered.downloadMbps) $('cloudDownload').value = recovered.downloadMbps;
      if (recovered.clientIdServicio && operationIsExisting()) {
        const clients = await cloudFetch(`/api/cloud/clients?q=${encodeURIComponent(recovered.clientIdServicio)}`);
        const matched = clients.find((client) => client.idServicio === recovered.clientIdServicio);
        if (matched) selectExistingClient(matched);
      }
      cloudPrepared = true;
      cloudJobId = recovered.id;
      $('cloudReserve').disabled = true;
      $('cloudNote').textContent = `Instalación ${recovered.id.slice(0, 8)} recuperada sin duplicar WispHub ni MikroTik. Revisa la clave WiFi y aprovisiona.`;
      wizardStep = 4;
      maxWizardStep = 5;
      renderWizard(true);
      $('wifiPassword').focus();
      showToast('Instalación recuperada; vuelve a colocar la clave WiFi');
    } else {
      $('cloudReserve').disabled = false;
      showToast('ONU Studio conectado con ISP Max');
    }
  } catch (error) {
    cloudConnected = false;
    renderCoordinationState(false);
    $('cloudStatus').textContent = 'Sin conectar';
    $('cloudStatus').className = 'cloud-status';
    const denied = /revoc|admin|autoriz/i.test(error.message);
    renderCloudSession({ session_state: denied ? 'revoked' : 'disconnected', revoked_reason: denied ? error.message : null });
    showToast(error.message, 'error');
  } finally {
    $('cloudConnect').disabled = false;
  }
}

async function logoutCloud() {
  try {
    await cloudFetch('/api/cloud/logout', { method: 'POST' });
  } catch {}
  cloudConnected = false;
  cloudPrepared = false;
  cloudJobId = null;
  cloudReservationToken = null;
  renderCloudSession({ session_state: 'disconnected' });
  $('cloudLoginForm').hidden = false;
  $('cloudPassword').value = '';
  $('cloudReserve').disabled = true;
  showToast('Sesión cerrada en esta PC');
}

async function reserveCloudInstallation() {
  const routed = serviceMode() === 'router';
  const required = ['cloudClientName', 'cloudSerial', 'cloudZone', 'cloudPlan', 'cloudUpload', 'cloudDownload', ...(routed ? ['cloudIp'] : [])];
  if (required.some((id) => !value(id))) return showToast(operationIsExisting() ? 'Selecciona un cliente que tenga zona y plan' : `Completa cliente, serial${routed ? ', IP' : ''}, zona, plan y velocidades`, 'error');
  if (operationIsExisting() && !selectedExistingClient) return showToast('Busca y selecciona el cliente existente', 'error');
  if (operationIsExisting() && !value('operationReason')) return showToast('Indica el motivo técnico para dejar trazabilidad', 'error');
  if (serviceOperation === 'migrate_pon' && !value('targetPonIndex')) return showToast('Indica el PON de destino', 'error');
  const detectedSerial = currentOnuInventory?.identity?.serial;
  if (!detectedSerial || value('cloudSerial') !== detectedSerial) {
    return showToast('Vuelve a detectar la ONU: la reserva requiere el serial real leido del equipo', 'error');
  }
  try {
    $('cloudReserve').disabled = true;
    let reservation = cloudReservationToken
      ? { token: cloudReservationToken, cidr: selectedCloudIp?.cidr || networkFromIp(value('cloudIp')) }
      : null;
    if (!operationIsExisting() && routed && !cloudReservationToken) {
      reservation = await cloudFetch('/api/cloud/reservations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: value('cloudIp'), client_name: value('cloudClientName'), serial: value('cloudSerial') })
      });
      cloudReservationToken = reservation.token;
    } else {
      cloudReservationToken = null;
    }
    const job = cloudJobId
      ? await cloudFetch(`/api/cloud/jobs/${encodeURIComponent(cloudJobId)}`)
      : await cloudFetch('/api/cloud/jobs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: serviceOperation, client_id: selectedExistingClient?.idServicio || null,
        service_mode: serviceMode(),
        reservation_token: cloudReservationToken, ip: value('cloudIp'), client_name: value('cloudClientName'),
        serial: value('cloudSerial'), model: value('deviceModel'),
        mac_address: currentOnuInventory?.device?.mac || currentOnuInventory?.ethernet?.mac || null,
        zone_id: numberValue('cloudZone'),
        plan_id: numberValue('cloudPlan'), upload_mbps: numberValue('cloudUpload'),
        download_mbps: numberValue('cloudDownload'), vlan: numberValue('vlanId'),
        inventory: currentOnuInventory, host: value('deviceHost'),
        target_pon_index: value('targetPonIndex') || null,
        operation_reason: value('operationReason') || null,
        configuration_manifest: {
          schemaVersion: 1, serviceMode: serviceMode(), serial: value('cloudSerial'), model: value('deviceModel'),
          firmware: currentOnuInventory?.device?.software_version || null, vlan: numberValue('vlanId'),
          wan: { mode: routed ? 'static' : 'bridge', ip: routed ? value('cloudIp') : null, gateway: routed ? value('gateway') : null, nat: routed },
          lanPorts: [1, 2, 3, 4].filter((port) => checked('bindLan' + port)), ssidBinding: routed && checked('bindSsid1'),
          wifi: routed ? { enabled: checked('wifiEnabled'), ssid: value('ssid') } : null,
          channels: { tr069: routed && checked('tr069Enabled'), omci: true, webLocal: true }, verified: false,
        }
      })
    });
    cloudJobId = job.id;
    let provisioned = null;
    if (!operationIsExisting() && routed) {
      provisioned = await cloudFetch('/api/cloud/provision-client', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: job.id, ip: value('cloudIp'), service_name: value('cloudClientName'),
          zone_id: numberValue('cloudZone'), plan_id: numberValue('cloudPlan'),
          upload_mbps: numberValue('cloudUpload'), download_mbps: numberValue('cloudDownload')
        })
      });
    }
    if (routed) {
      $('wanIp').value = value('cloudIp');
      applyNetworkProfile(reservation?.cidr || selectedCloudIp?.cidr || networkFromIp(value('cloudIp')) || value('cloudNetwork'));
      if (!value('ssid') || !value('wifiPassword')) generateWifiDefaults();
    }
    cloudPrepared = true;
    maxWizardStep = Math.max(maxWizardStep, 3);
    $('cloudNote').textContent = operationIsExisting()
      ? `Expediente ${job.id.slice(0, 8)} listo. WispHub, facturas, IP, plan y MikroTik permanecen sin cambios.`
      : routed
        ? `Expediente ${job.id.slice(0, 8)} listo: WispHub #${provisioned.wisphub?.idServicio || '?'}, MikroTik e IP verificados. Continúa con Internet WAN.`
        : `Expediente ${job.id.slice(0, 8)} listo en modo Bridge, sin reservar IP. Continúa con VLAN y puertos LAN.`;
    updateDerived();
    renderWizard();
    $('cloudReserve').textContent = serviceOperationCopy[serviceOperation].button;
    showToast(operationIsExisting() ? 'Operación preparada sin recrear el servicio' : 'Instalación preparada; IP y perfil WAN completados');
    setWizardStep(3);
  } catch (error) {
    showToast(error.message, 'error');
    $('cloudReserve').disabled = false;
    if (cloudJobId && cloudReservationToken) {
      $('cloudReserve').textContent = 'Reintentar alta';
      $('cloudNote').textContent = `El expediente ${cloudJobId.slice(0, 8)} y su IP siguen reservados. Reintenta sin crear otro cliente.`;
    }
  }
}

function setBusy(busy) {
  operationBusy = busy;
  $('resetDeviceSession').disabled = busy;
  $('checkButton').disabled = busy;
  $('provisionButton').disabled = busy;
  Array.from($('provisionForm').elements).forEach((element) => { element.disabled = busy; });
  $('wizardBack').disabled = busy || wizardStep === 1;
  $('wizardNext').disabled = busy || (wizardStep === 2 && (!cloudPrepared || !cloudConnected));
}

function formatApiError(payload) {
  if (Array.isArray(payload?.detail)) return payload.detail.map((item) => item.msg).join(' · ');
  return payload?.detail || payload?.error || 'No se pudo completar la solicitud';
}

async function startJob(kind, options = {}) {
  if (kind === 'provision' && !$('provisionForm').reportValidity()) return;
  if (kind === 'check' && (!value('deviceHost') || !value('localAddress'))) {
    showToast('Completa la IP local y la IP de la ONU', 'error');
    return;
  }
  if (!numberValue('adapterIndex')) {
    showToast('Selecciona una tarjeta Ethernet', 'error');
    return;
  }
  if (kind === 'provision' && cloudJobId && !cloudConnected) {
    showToast('Conecta ONU Studio con ISP Max antes de aprovisionar', 'error');
    return;
  }
  const endpoint = kind === 'check' ? '/api/check' : '/api/provision';
  const body = kind === 'check'
    ? { device: buildDevice(), local_network: buildLocalNetwork(), prepare_adapter: !options.automatic }
    : buildPayload();
  try {
    if (kind === 'provision') jobStartedAt = Date.now();
    activeJobAutomatic = Boolean(options.automatic);
    setBusy(true);
    resetOperation(kind);
    if (activeJobAutomatic) showToast('Leyendo identidad y serial GPON de la ONU');
    const response = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(formatApiError(data));
    activeJobId = data.job_id;
    localStorage.setItem('onuStudio.activeJobId', activeJobId);
    pollJob();
  } catch (error) {
    setBusy(false);
    setJobStatus('error', error.message);
    showToast(error.message, 'error');
  }
}

function resetOperation(kind) {
  $('jobTitle').textContent = kind === 'check' ? 'Comprobando ONU' : 'Aprovisionando ONU';
  $('timeline').innerHTML = '<li class="running">Trabajo en cola</li>';
  $('resultBox').hidden = true;
  $('progressBar').style.width = '4%';
  $('progressPercent').textContent = '4%';
  $('progressStage').textContent = 'Trabajo en cola';
  $('jobBadge').className = 'job-badge running';
  $('jobBadge').textContent = 'En proceso';
}

function setJobStatus(status, error) {
  const badge = $('jobBadge');
  badge.className = `job-badge ${status}`;
  badge.textContent = status === 'success' ? 'Completado' : status === 'error' ? 'Con error' : 'En proceso';
  if (status === 'success') $('jobTitle').textContent = 'Configuración verificada';
  if (status === 'error') $('jobTitle').textContent = error || 'La operación falló';
}

function renderJob(job) {
  lastRenderedJob = job;
  const timeline = $('timeline');
  timeline.innerHTML = job.events.length ? '' : '<li class="running">Preparando ejecución</li>';
  job.events.forEach((event) => {
    const item = document.createElement('li');
    item.className = event.status;
    const time = new Date(event.at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    item.innerHTML = `<span>${escapeHtml(event.message)}</span><span class="event-time">${time}</span>`;
    timeline.appendChild(item);
  });
  const terminal = ['success', 'error'].includes(job.status);
  const progress = job.status === 'success' ? 100 : Math.max(0, Math.min(100, Number(job.progress_percent || 0)));
  $('progressBar').style.width = `${progress}%`;
  $('progressPercent').textContent = `${progress}%`;
  $('progressStage').textContent = job.stage_label || 'Preparando ejecución';
  setJobStatus(job.status === 'queued' ? 'running' : job.status, job.error);
  if (job.result) renderResult(job.result);
  if (terminal) {
    localStorage.removeItem('onuStudio.activeJobId');
    setBusy(false);
    clearTimeout(pollTimer);
    loadHistory();
    showToast(job.status === 'success' ? 'Operación terminada correctamente' : job.error, job.status === 'error' ? 'error' : 'info');
    if (activeJobAutomatic && job.status === 'error' && !value('cloudSerial')) {
      $('discoverySerial').textContent = 'No leído';
      $('cloudSerialNote').textContent = 'Pulsa Preparar red y comprobar para reintentar';
    }
    if (job.status === 'success' && job.kind === 'provision') {
      lastProvisionSucceeded = true;
      document.querySelectorAll('[data-wizard-target]').forEach((button) => button.classList.add('complete'));
      $('wizardFooterTitle').textContent = 'ONU configurada y verificada';
      showCompletion(job);
    }
  }
}

function renderResult(result) {
  const box = $('resultBox');
  const remote = result.remote_access ? `<br>Remoto: http://${escapeHtml(result.wan.ip_address)} desde ${escapeHtml(result.remote_access.source)}` : '';
  const tr069 = result.tr069 ? `<br>ACS: ${escapeHtml(result.tr069.acs_url)} cada ${escapeHtml(String(result.tr069.periodic_inform_interval))} s` : '';
  box.innerHTML = `<strong>${escapeHtml(result.model || 'ONU verificada')}</strong><br>Host: ${escapeHtml(result.host || '')}${remote}${tr069}`;
  box.hidden = false;
  if (result.serial) {
    $('cloudSerial').value = result.serial;
    $('discoverySerial').textContent = result.serial;
    $('cloudSerialNote').textContent = 'Leído directamente de ONT Authentication';
    renderReview();
  }
  if (result.inventory) renderOnuInventory(result.inventory);
  updateResetDeviceAction();
}

async function pollJob() {
  if (!activeJobId) return;
  try {
    const response = await fetch(`/api/jobs/${activeJobId}`);
    const job = await response.json();
    if (!response.ok) throw new Error(formatApiError(job));
    renderJob(job);
    if (!['success', 'error'].includes(job.status)) pollTimer = setTimeout(pollJob, 850);
  } catch (error) {
    setBusy(false);
    setJobStatus('error', error.message);
    showToast(error.message, 'error');
  }
}

async function loadHistory() {
  const body = $('historyBody');
  try {
    const response = await fetch('/api/history?limit=20');
    const rows = await response.json();
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="6" class="table-empty">Aún no hay configuraciones registradas.</td></tr>';
      return;
    }
    body.innerHTML = rows.map((row) => {
      const date = new Date(row.created_at).toLocaleString('es-DO', { dateStyle: 'short', timeStyle: 'short' });
      const label = row.status === 'success' ? 'Completado' : row.status === 'error' ? 'Error' : 'En proceso';
      return `<tr><td>${date}</td><td>${row.kind === 'check' ? 'Comprobación' : 'Aprovisionamiento'}</td><td>${escapeHtml(row.device_host || '')}</td><td>${escapeHtml(row.wan_ip || '—')}</td><td>${escapeHtml(row.ssid || '—')}</td><td><span class="status-label ${row.status}">${label}</span></td></tr>`;
    }).join('');
    const lastProvision = rows.find((row) => row.kind === 'provision');
    if (lastProvision?.status === 'error' && !recoveredCloudJobId && !cloudPrepared) {
      await restoreFailedProvision(lastProvision.id);
    }
  } catch {
    body.innerHTML = '<tr><td colspan="6" class="table-empty">No se pudo leer el historial local.</td></tr>';
  }
}

async function restoreFailedProvision(jobId) {
  try {
    const template = await cloudFetch(`/api/jobs/${encodeURIComponent(jobId)}/retry-template`);
    const request = template.request || {};
    const wan = request.wan || {};
    const wifi = request.wifi || {};
    const tr069 = request.tr069 || {};
    const remote = request.remote_access || {};
    const local = request.local_network || {};
    const device = request.device || {};

    if (device.host) $('deviceHost').value = device.host;
    if (device.model) $('deviceModel').value = device.model;
    if (device.username) $('deviceUsername').value = device.username;
    if (local.adapter_index) $('adapterIndex').value = String(local.adapter_index);
    if (local.address) $('localAddress').value = local.address;
    if (local.prefix_length) $('prefixLength').value = local.prefix_length;
    const values = {
      vlanId: wan.vlan_id, priority: wan.priority, wanIp: wan.ip_address,
      subnetMask: wan.subnet_mask, gateway: wan.gateway, primaryDns: wan.primary_dns,
      secondaryDns: wan.secondary_dns || '', mtu: wan.mtu,
      ssid: wifi.ssid, maxClients: wifi.max_clients,
      tr069AcsUrl: tr069.acs_url, tr069Username: tr069.username,
      tr069ConnectionUsername: tr069.connection_request_username,
      tr069Interval: tr069.periodic_inform_interval, remoteSource: remote.source,
    };
    Object.entries(values).forEach(([id, content]) => {
      if ($(id) && content !== undefined && content !== null) $(id).value = String(content);
    });
    for (let port = 1; port <= 4; port += 1) $('bindLan' + port).checked = (wan.bind_lan_ports || []).includes(port);
    $('natEnabled').checked = wan.nat_enabled !== false;
    $('bindSsid1').checked = wan.bind_ssid1 !== false;
    $('wifiEnabled').checked = wifi.enabled !== false;
    $('broadcast').checked = wifi.broadcast !== false;
    $('wmmEnabled').checked = wifi.wmm_enabled !== false;
    $('wpsEnabled').checked = Boolean(wifi.wps_enabled);
    $('wifiPassword').value = '';
    $('tr069Enabled').checked = tr069.enabled !== false;
    $('remoteEnabled').checked = remote.enabled !== false;
    $('saveConfiguration').checked = request.save_configuration !== false;
    $('createBackups').checked = request.create_backups !== false;
    $('replaceConflictingWan').checked = Boolean(request.replace_conflicting_wan || request.service_operation !== 'new_client');

    cloudJobId = request.cloud_job_id || null;
    recoveredCloudJobId = cloudJobId;
    cloudPrepared = Boolean(cloudJobId);
    wizardStep = 2;
    maxWizardStep = 5;
    $('cloudReserve').disabled = true;
    $('cloudNote').textContent = `Intento recuperado: conecta ISP Max para reutilizar el expediente ${cloudJobId?.slice(0, 8) || ''}. No prepares otro cliente.`;
    updateDerived();
    renderWizard(true);
    showToast('Se recuperó el intento fallido sin guardar ninguna contraseña');
  } catch (error) {
    showToast(`No se pudo recuperar el intento: ${error.message}`, 'error');
  }
}

function setText(id, content) {
  const element = $(id);
  if (element) element.textContent = content;
}

function serviceOperationLabel() {
  return {
    new_client: 'Cliente nuevo',
    restore_same_onu: 'Restaurar misma ONU',
    replace_onu: 'Cambiar ONU',
    migrate_pon: 'Mover de PON',
  }[serviceOperation] || 'Cliente nuevo';
}

function refreshSidebarSummary() {
  const identity = currentOnuInventory?.identity || {};
  const device = currentOnuInventory?.device || {};
  const optical = currentOnuInventory?.optical || {};
  const wan = (currentOnuInventory?.wan || []).find((item) => String(item.service || '').includes('INTERNET')) || currentOnuInventory?.wan?.[0];
  const radio = currentOnuInventory?.wifi?.radios?.[0];
  setText('summarySerial', identity.serial || value('cloudSerial') || '--');
  setText('summaryModel', device.model || value('deviceModel') || 'ONU');
  setText('summaryFirmware', device.software_version || '--');
  const opticalText = optical.signal_available
    ? `${optical.rx_power_dbm ?? '--'} dBm / ${device.registration_status || 'PON'}`
    : (currentOnuInventory ? 'Sin enlace PON' : 'Sin lectura');
  setText('summaryOptical', opticalText);
  $('summaryOptical')?.classList.toggle('text-success', Boolean(optical.signal_available));
  $('summaryOptical')?.classList.toggle('text-warning', !optical.signal_available);
  setText('summaryWan', `${value('wanIp') || wan?.ip_address || '--'} / VLAN ${value('vlanId') || wan?.vlan_id || '--'}`);
  setText('summaryWifi', value('ssid') || radio?.ssid || '--');
  setText('summaryTr069', checked('tr069Enabled') ? 'Preparado' : 'Desactivado');
  setText('summaryVerified', currentOnuInventory?.collected_at
    ? new Date(currentOnuInventory.collected_at).toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' })
    : '--');
}

function renderReview() {
  if (!$('reviewClient')) return;
  setText('reviewOperation', serviceOperationLabel());
  setText('reviewClient', value('cloudClientName') || 'Configuracion local');
  setText('reviewOnu', `${value('deviceModel') || 'ONU'} / ${value('deviceHost') || 'Sin IP'}`);
  const wanService = checked('tr069Enabled') ? 'TR069_INTERNET' : 'INTERNET';
  setText('reviewWan', `${wanService} / ${value('wanIp') || 'Sin IP'} / VLAN ${value('vlanId') || '--'} / ${value('gateway') || 'Sin gateway'}`);
  setText('reviewWifi', `${value('ssid') || 'Sin nombre'} / WPA2-AES`);
  setText('reviewRemote', checked('remoteEnabled') ? value('remoteSource') || 'Sin origen' : 'Desactivado');
  setText('reviewCloud', cloudPrepared && cloudJobId ? `Expediente ${cloudJobId.slice(0, 8)} preparado` : 'Solo configuracion local');
  refreshSidebarSummary();
}

function renderWizard(scroll = false) {
  document.body.dataset.wizardStep = String(wizardStep);
  const copy = wizardMeta[wizardStep];
  setText('stepEyebrow', 'Consola local de aprovisionamiento');
  setText('stepTitle', 'Centro de control ONU');
  setText('stepDescription', 'Detecta el equipo y completa cada etapa sin abandonar esta consola.');
  setText('wizardHint', copy.eyebrow);
  setText('wizardFooterTitle', wizardStep === 2 && operationIsExisting()
    ? 'Selecciona el cliente y protege su servicio'
    : copy.footer);
  setText('wizardNext', copy.next);
  $('wizardBack').disabled = wizardStep === 1;
  $('wizardNext').hidden = wizardStep === 5;
  $('wizardNext').disabled = wizardStep === 2 && (!cloudPrepared || !cloudConnected);
  document.querySelectorAll('[data-wizard-target]').forEach((button) => {
    const target = Number(button.dataset.wizardTarget);
    button.classList.toggle('active', target === wizardStep);
    button.classList.toggle('complete', target < wizardStep || target < maxWizardStep);
    button.disabled = target > maxWizardStep;
  });
  renderReview();
  if (scroll && wizardStep === 1) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function validateWizardStep(step) {
  if (step === 1 && !discoveryDetected && !detectedDeviceKey) {
    showToast('Conecta la ONU y espera a que sea detectada', 'error');
    return false;
  }
  if (step === 2 && (!cloudPrepared || !cloudConnected)) {
    showToast(cloudPrepared ? 'Conecta ONU Studio con ISP Max para recuperar la instalacion' : 'Prepara la instalacion y reserva una IP antes de continuar', 'error');
    return false;
  }
  if (step === 3) {
    for (const id of ['vlanId', 'wanIp', 'subnetMask', 'gateway', 'primaryDns']) {
      if (!$(id).reportValidity()) return false;
    }
  }
  if (step === 4) {
    if (!$('ssid').reportValidity() || !$('wifiPassword').reportValidity()) return false;
    if (checked('tr069Enabled')) {
      for (const id of ['tr069AcsUrl', 'tr069Username', 'tr069ConnectionUsername']) {
        if (!$(id).reportValidity()) return false;
      }
    }
    if (checked('remoteEnabled') && !$('remoteSource').reportValidity()) return false;
  }
  return true;
}

function renderOnuInventory(inventory) {
  renderOnuInventoryLegacy(inventory);
  const wan = (inventory?.wan || []).find((item) => String(item.service || '').includes('INTERNET')) || inventory?.wan?.[0];
  const radio = inventory?.wifi?.radios?.[0];
  setText('wanCompatibilityName', wan?.name || 'No se detecto un perfil existente');
  setText('wanCompatibilityStatus', wan ? 'Compatible para reutilizar' : 'Se creara un perfil nuevo');
  $('useCurrentWanTop').disabled = !wan;
  $('useCurrentWifiTop').disabled = !radio?.ssid;
  setText('capabilityWifi', radio ? 'Verificado' : 'Pendiente');
  setText('capabilityTr069', checked('tr069Enabled') ? 'Preparado' : 'Desactivado');
  setText('capabilityAcl', checked('remoteEnabled') ? 'Preparado' : 'Desactivado');
  refreshSidebarSummary();
}

function renderCoordinationState(connected) {
  document.querySelector('.cloud-health')?.classList.toggle('connected', connected);
  for (const id of ['cloudWisphubState', 'cloudMikrotikState', 'cloudIpamState']) {
    const element = $(id);
    if (!element) continue;
    element.textContent = connected ? 'Conectado' : 'Pendiente';
    element.classList.toggle('ready', connected);
  }
}

function showCompletion(job) {
  lastProvisionSucceeded = true;
  document.body.classList.add('provision-complete');
  $('completionPanel').hidden = false;
  setText('stepEyebrow', 'Proceso completado');
  setText('stepTitle', 'ONU configurada y verificada');
  setText('stepDescription', 'La configuracion fue aplicada, leida nuevamente y registrada en el historial.');
  const elapsed = jobStartedAt ? Math.max(1, Math.round((Date.now() - jobStartedAt) / 1000)) : null;
  setText('completionElapsed', elapsed ? `${elapsed} s` : 'Completado');
  setText('completionSerial', job.result?.serial || value('cloudSerial') || '--');
  setText('completionClient', value('cloudClientName') || 'Configuracion local');
  setText('completionJob', job.id ? job.id.slice(0, 8) : '--');
  setText('summaryVerified', 'Ahora');
  document.querySelectorAll('[data-wizard-target]').forEach((button) => button.classList.add('complete'));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function downloadProvisionReport() {
  if (!lastRenderedJob) return showToast('Todavia no hay un informe de aprovisionamiento', 'error');
  const report = {
    exportedAt: new Date().toISOString(),
    agentVersion: $('agentVersion').textContent,
    operation: serviceOperation,
    client: value('cloudClientName') || null,
    serial: value('cloudSerial') || lastRenderedJob.result?.serial || null,
    wan: { ip: value('wanIp'), vlan: numberValue('vlanId'), gateway: value('gateway') },
    wifi: { ssid: value('ssid'), enabled: checked('wifiEnabled') },
    tr069: { enabled: checked('tr069Enabled'), acsUrl: value('tr069AcsUrl') },
    job: lastRenderedJob,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `onu-${report.serial || 'informe'}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function applyDevelopmentPreview() {
  if (agentMode !== 'development') return;
  const params = new URLSearchParams(window.location.search);
  const step = Number(params.get('previewStep'));
  if (!Number.isInteger(step) || step < 1 || step > 5) return;
  previewMode = true;
  clearInterval(discoveryTimer);
  discoveryDetected = true;
  detectedDeviceKey = 'preview-onu';
  cloudConnected = true;
  cloudPrepared = true;
  cloudJobId = 'preview-7f0d-42c8';
  maxWizardStep = step;
  wizardStep = step;
  $('cloudClientName').value = 'Francis Valerio';
  $('cloudSerial').value = 'HWTC26D9D8AF';
  $('cloudIp').value = '192.168.16.22';
  $('wanIp').value = '192.168.16.22';
  $('ssid').value = 'WiFi Prueba';
  $('wifiPassword').value = '12345678';
  currentOnuInventory = {
    identity: { serial: 'HWTC26D9D8AF' },
    device: { model: 'EG8141A5', software_version: 'V5R019C00S050', registration_status: 'O1' },
    optical: { signal_available: false },
    wan: [{ service: 'TR069_INTERNET', name: '1_TR069_INTERNET_R_VID_101', ip_address: '192.168.16.22', vlan_id: 101 }],
    wifi: { radios: [{ ssid: 'WiFi Prueba', enabled: true }] },
    collected_at: new Date().toISOString(),
  };
  setText('discoveryTitle', 'ONU detectada y lista');
  setText('discoveryBadge', 'Verificada');
  setText('discoveryAction', 'Identidad y conectividad local verificadas. Puedes continuar.');
  setText('discoveryModel', 'Huawei EG8141A5');
  setText('discoveryAdapter', 'Ethernet');
  setText('discoveryHost', '192.168.100.1');
  setText('discoveryLatency', '2 ms');
  setText('discoverySerial', 'HWTC26D9D8AF');
  $('discoveryPanel').classList.remove('scanning');
  $('discoveryPanel').classList.add('detected');
  $('cloudStatus').textContent = 'Conectado';
  $('cloudStatus').className = 'cloud-status connected';
  $('adminReady').textContent = 'Administrador';
  $('adminReady').className = 'text-success';
  renderCoordinationState(true);
  updateResetDeviceAction();
  setText('capabilityWifi', 'Verificado');
  setText('capabilityTr069', 'Verificado');
  setText('capabilityAcl', 'Verificado');
  $('jobTitle').textContent = 'Equipo identificado';
  $('jobBadge').className = 'job-badge success';
  $('jobBadge').textContent = 'Verificado';
  $('progressBar').style.width = '100%';
  $('timeline').innerHTML = [
    'ONU detectada en 192.168.100.1',
    'Identidad y serial leídos correctamente',
    'Cliente e IP validados',
    'Perfil WAN compatible',
    'Estado óptico: equipo en banco',
  ].map((message, index) => `<li class="${index === 4 ? 'running' : 'success'}"><span>${message}</span><span class="event-time">Ahora</span></li>`).join('');
  renderWizard();
  if (params.get('previewComplete') === '1') {
    lastRenderedJob = { id: 'preview-7f0d', kind: 'provision', status: 'success', result: { serial: 'HWTC26D9D8AF' }, events: [] };
    showCompletion(lastRenderedJob);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function rangeTemplate(item = {}) {
  const id = item.id || `range-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
  return `<article class="range-row" data-range-id="${escapeHtml(id)}">
    <label>Nombre<input data-field="name" value="${escapeHtml(item.name || 'Nuevo segmento')}" maxlength="80" required></label>
    <label>CIDR<input data-field="cidr" value="${escapeHtml(item.cidr || '192.168.16.0/24')}" required></label>
    <label>VLAN<input data-field="vlan" type="number" min="1" max="4094" value="${Number(item.vlan || 101)}" required></label>
    <label>Gateway<input data-field="gateway" value="${escapeHtml(item.gateway || '192.168.16.1')}" required></label>
    <label>DNS<input data-field="primary_dns" value="${escapeHtml(item.primary_dns || '8.8.8.8')}" required></label>
    <label>Prioridad<input data-field="priority" type="number" min="1" max="9999" value="${Number(item.priority || 100)}" required></label>
    <label>Inicio<input data-field="allocation_start" value="${escapeHtml(item.allocation_start || '')}" placeholder="Opcional"></label>
    <label>Fin<input data-field="allocation_end" value="${escapeHtml(item.allocation_end || '')}" placeholder="Opcional"></label>
    <label>Exclusiones<input data-field="exclusions" value="${escapeHtml((item.exclusions || []).join(', '))}" placeholder="Separadas por coma"></label>
    <label>Activo<input data-field="active" type="checkbox" ${item.active !== false ? 'checked' : ''}></label>
    <button class="range-remove" type="button" aria-label="Eliminar rango">×</button>
  </article>`;
}

function renderNetworkRanges() {
  $('networkRangeList').innerHTML = networkRanges.map(rangeTemplate).join('');
  $('networkRangeList').querySelectorAll('.range-remove').forEach((button) => button.addEventListener('click', () => {
    button.closest('.range-row').remove();
  }));
}

async function openAgentSettings() {
  try {
    const result = await cloudFetch('/api/settings/network-ranges');
    networkRanges = result.ranges || [];
    renderNetworkRanges();
    $('agentSettingsBackdrop').hidden = false;
    $('agentSettingsModal').hidden = false;
  } catch (error) { showToast(error.message, 'error'); }
}

function closeAgentSettings() {
  $('agentSettingsBackdrop').hidden = true;
  $('agentSettingsModal').hidden = true;
}

async function saveNetworkRanges() {
  const rows = [...$('networkRangeList').querySelectorAll('.range-row')];
  if (!rows.length) return showToast('Debe existir al menos un rango', 'error');
  const ranges = rows.map((row) => {
    const field = (name) => row.querySelector(`[data-field="${name}"]`);
    return {
      id: row.dataset.rangeId, name: field('name').value.trim(), cidr: field('cidr').value.trim(),
      vlan: Number(field('vlan').value), gateway: field('gateway').value.trim(), primary_dns: field('primary_dns').value.trim(),
      secondary_dns: null, priority: Number(field('priority').value),
      allocation_start: field('allocation_start').value.trim() || null,
      allocation_end: field('allocation_end').value.trim() || null,
      exclusions: field('exclusions').value.split(',').map((item) => item.trim()).filter(Boolean),
      active: field('active').checked,
    };
  });
  try {
    $('saveNetworkRanges').disabled = true;
    const result = await cloudFetch('/api/settings/network-ranges', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ranges }),
    });
    networkRanges = result.ranges;
    closeAgentSettings();
    if (cloudConnected) await loadCloudCatalog();
    showToast('Rangos locales guardados y validados');
  } catch (error) { showToast(error.message, 'error'); }
  finally { $('saveNetworkRanges').disabled = false; }
}

async function initialize() {
  try {
    const [healthResponse, defaultsResponse] = await Promise.all([fetch('/api/health'), fetch('/api/defaults')]);
    const health = await healthResponse.json();
    const defaults = await defaultsResponse.json();
    if (!health.ok) throw new Error('Agente no disponible');
    agentMode = health.mode || 'desktop';
    $('agentVersion').textContent = `v${health.version}`;
    $('agentReady').textContent = 'Conectado';
    $('agentReady').className = 'text-success';
    $('adminReady').textContent = health.admin ? 'Administrador' : 'Requiere reinicio';
    $('adminReady').className = health.admin ? 'text-success' : 'text-warning';
    agentDefaults = defaults;
    populateDefaults(defaults);
    const [, , rangeConfig] = await Promise.all([loadDiscovery(), loadStartup(), cloudFetch('/api/settings/network-ranges')]);
    networkRanges = rangeConfig.ranges || [];
    if (cloudConnected) {
      renderCoordinationState(true);
      await loadCloudCatalog();
      $('cloudReserve').disabled = false;
    }
    const recoveredLocalJob = localStorage.getItem('onuStudio.activeJobId');
    if (recoveredLocalJob) {
      activeJobId = recoveredLocalJob;
      pollJob();
    }
    discoveryTimer = setInterval(() => loadDiscovery(), 5000);
  } catch (error) {
    $('agentState').classList.add('error');
    $('agentVersion').textContent = 'Sin conexión';
    $('agentReady').textContent = 'Desconectado';
    $('agentReady').className = 'text-error';
    showToast(error.message, 'error');
  }
  loadHistory();
  renderWizard();
  applyDevelopmentPreview();
}

$('checkButton').addEventListener('click', () => startJob('check'));
$('wizardBack').addEventListener('click', () => setWizardStep(wizardStep - 1));
$('wizardNext').addEventListener('click', () => setWizardStep(wizardStep + 1));
$('generateWifi').addEventListener('click', generateWifiDefaults);
document.querySelectorAll('[data-wizard-target]').forEach((button) => button.addEventListener('click', () => setWizardStep(Number(button.dataset.wizardTarget))));
$('scanNow').addEventListener('click', () => loadDiscovery(true));
$('resetDeviceSession').addEventListener('click', () => resetDeviceSession({ preserveCloud: false }));
$('startupEnabled').addEventListener('change', changeStartup);
$('provisionButton').addEventListener('click', () => startJob('provision'));
$('refreshHistory').addEventListener('click', loadHistory);
$('adapterIndex').addEventListener('change', updateDerived);
$('wanIp').addEventListener('input', updateDerived);
$('deviceHost').addEventListener('input', updateDerived);
$('deviceModel').addEventListener('change', () => {
  const profile = (agentDefaults?.supported_devices || []).find((row) => row.model === value('deviceModel'));
  if (profile) {
    $('deviceUsername').value = profile.username || '';
    $('devicePassword').value = '';
    $('deviceUsername').placeholder = profile.username ? 'Usuario técnico' : 'Usuario de la etiqueta';
    $('devicePassword').placeholder = profile.has_password ? 'Usar la guardada en el agente' : 'Contraseña de la etiqueta';
  }
  updateDerived();
});
$('cloudConnect').addEventListener('click', connectCloud);
$('cloudLogout').addEventListener('click', logoutCloud);
$('openAgentSettings').addEventListener('click', openAgentSettings);
$('closeAgentSettings').addEventListener('click', closeAgentSettings);
$('agentSettingsBackdrop').addEventListener('click', closeAgentSettings);
$('addNetworkRange').addEventListener('click', () => {
  $('networkRangeList').insertAdjacentHTML('beforeend', rangeTemplate());
  const row = $('networkRangeList').lastElementChild;
  row.querySelector('.range-remove').addEventListener('click', () => row.remove());
});
$('saveNetworkRanges').addEventListener('click', saveNetworkRanges);
document.querySelectorAll('input[name="serviceMode"]').forEach((radio) => radio.addEventListener('change', applyServiceModeUi));
$('cloudReserve').addEventListener('click', reserveCloudInstallation);
document.querySelectorAll('input[name="serviceOperation"]').forEach((radio) => {
  radio.addEventListener('change', () => setServiceOperation(radio.value));
});
document.querySelectorAll('[data-operation-shortcut]').forEach((button) => {
  button.addEventListener('click', () => {
    setServiceOperation(button.dataset.operationShortcut);
    showToast(`${button.querySelector('b').textContent} seleccionado. Detecta la ONU para continuar.`);
  });
});
$('searchExistingClient').addEventListener('click', searchExistingClients);
$('existingClientSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); searchExistingClients(); }
});
$('cloudNetwork').addEventListener('change', () => loadCloudCatalog(value('cloudNetwork')).catch((error) => showToast(error.message, 'error')));
$('openCloudIpPicker').addEventListener('click', openCloudIpPicker);
$('closeCloudIpPicker').addEventListener('click', closeCloudIpPicker);
$('cloudIpBackdrop').addEventListener('click', closeCloudIpPicker);
$('confirmCloudIp').addEventListener('click', confirmCloudIp);
$('cloudIpSearch').addEventListener('input', renderCloudIpCatalog);
$('cloudIpNetwork').addEventListener('change', () => loadCloudCatalog(value('cloudIpNetwork')).catch((error) => showToast(error.message, 'error')));
$('cloudPlan').addEventListener('change', () => {
  const speed = inferPlanSpeed($('cloudPlan').selectedOptions[0]?.textContent);
  if (speed) { $('cloudUpload').value = speed; $('cloudDownload').value = speed; }
});
$('useCurrentWan').addEventListener('click', useCurrentWanConfiguration);
$('useCurrentWifi').addEventListener('click', useCurrentWifiConfiguration);
$('useCurrentWanTop').addEventListener('click', useCurrentWanConfiguration);
$('useCurrentWifiTop').addEventListener('click', useCurrentWifiConfiguration);
$('downloadReport').addEventListener('click', downloadProvisionReport);
$('viewHistory').addEventListener('click', () => {
  loadHistory();
  $('historySection').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
for (const id of ['cloudClientName', 'operationReason', 'targetPonIndex', 'wanIp', 'vlanId', 'gateway', 'ssid', 'remoteSource', 'tr069AcsUrl', 'tr069Username', 'tr069ConnectionUsername']) {
  $(id).addEventListener('input', renderReview);
}
$('tr069Enabled').addEventListener('change', renderReview);
$('remoteEnabled').addEventListener('change', renderReview);

setServiceOperation('new_client');
applyServiceModeUi();
initialize();
