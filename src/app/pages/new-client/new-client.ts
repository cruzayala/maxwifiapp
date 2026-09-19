import { Component, HostListener, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideArrowLeft, LucideCircleCheck, LucideRefreshCw, LucideSearch, LucideTriangleAlert, LucideUserPlus, LucideX } from '@lucide/angular';
import { ClientProvisioningResult, WisphubService } from '../../services/wisphub.service';
import { ToastService } from '../../services/toast.service';
import { PlanResponse, InternetPlan, Zone, ZoneResponse } from '../../models/plan.model';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { firstValueFrom } from 'rxjs';
import { OltService, ProvisioningIpAddress, ProvisioningIpCatalog, ProvisioningIpReservation } from '../../services/olt.service';

@Component({
  selector: 'app-new-client',
  standalone: true,
  imports: [
    NavbarComponent, FormsModule, RouterLink, LucideArrowLeft, LucideCircleCheck,
    LucideRefreshCw, LucideSearch, LucideTriangleAlert, LucideUserPlus, LucideX, PlanLabelPipe,
  ],
  template: `
    <app-navbar pageTitle="Nuevo cliente" />

    <div class="page">
      <a routerLink="/clients" class="back-link">
        <svg lucideArrowLeft size="16"></svg>
        Volver a clientes
      </a>

      <div class="form-wrap">
        <div class="card">
          <h3>Datos del servicio</h3>
          <p class="help">Los campos con <b class="req">*</b> son obligatorios para crear el servicio en WispHub.</p>

          <div class="form-row">
            <div class="form-group">
              <label for="nc-zona">Zona <b class="req">*</b></label>
              <select id="nc-zona" [(ngModel)]="zonaId" class="form-input" [disabled]="catalogLoading() && !zones().length">
                <option [ngValue]="0">{{ catalogLoading() && !zones().length ? 'Cargando zonas…' : 'Seleccione una zona' }}</option>
                @for (z of zones(); track z.id) {
                  <option [ngValue]="z.id">{{ z.nombre }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label for="nc-plan">Plan de internet <b class="req">*</b></label>
              <select id="nc-plan" [(ngModel)]="planId" (ngModelChange)="planChanged($event)" class="form-input" [disabled]="catalogLoading() && !plans().length">
                <option [ngValue]="0">{{ catalogLoading() && !plans().length ? 'Cargando planes…' : 'Seleccione un plan' }}</option>
                @for (p of plans(); track p.id) {
                  <option [ngValue]="p.id">{{ p.nombre | planLabel }}{{ (p.nombre | planLabel) !== p.nombre ? ' (' + p.nombre + ')' : '' }}</option>
                }
              </select>
            </div>
          </div>
          @if (catalogError()) {
            <p class="catalog-error" role="alert"><svg lucideTriangleAlert size="15"></svg>{{ catalogError() }}</p>
          }

          <div class="form-row">
            <div class="form-group">
              <label for="nc-nombre">Usuario / nombre del servicio <b class="req">*</b></label>
              <input id="nc-nombre" type="text" [(ngModel)]="usuarioRb" class="form-input" placeholder="Juan Pérez" autocomplete="off" />
              <span class="hint">Así aparecerá el cliente en WispHub</span>
            </div>
            <div class="form-group">
              <label for="nc-onu">Serial de la ONU <span class="optional">opcional</span></label>
              <input id="nc-onu" type="text" [(ngModel)]="onuSerial" class="form-input mono" maxlength="32" placeholder="Ej. 48575443…" autocomplete="off" />
              <span class="hint">Deja la instalación esperando que la OLT detecte la ONU</span>
            </div>
          </div>

          <div class="form-group ip-assignment">
            <label>Dirección IP <b class="req">*</b></label>
            <div class="ip-control">
              <input type="text" [ngModel]="ip" class="form-input mono" readonly aria-label="Dirección IP seleccionada" [placeholder]="ipLoading() ? 'Buscando IP libre…' : 'Sin IP seleccionada'" />
              <button type="button" class="ip-search-button" (click)="openIpPicker()" [disabled]="ipLoading()">
                <svg lucideSearch size="16"></svg>
                {{ ip ? 'Cambiar IP' : 'Buscar IP' }}
              </button>
            </div>
            @if (ipLoading()) { <span class="hint active-hint">Buscando una IP disponible…</span> }
            @else if (ip) { <span class="hint selected-hint">{{ ip }} {{ ipWasAutoSuggested() ? 'fue sugerida automáticamente' : 'fue seleccionada' }}; se reservará al crear el cliente.</span> }
            @else { <span class="hint error-hint">No se encontró una IP libre. Pulse «Buscar IP» para elegir una o reintentar.</span> }
          </div>

          <div class="form-row bandwidth-row">
            <div class="form-group">
              <label for="nc-bajada">Velocidad de bajada (Mbps) <b class="req">*</b></label>
              <input id="nc-bajada" type="number" inputmode="decimal" [(ngModel)]="downloadMbps" class="form-input" min="0.1" step="0.1" />
              <span class="hint">Se completa sola al elegir el plan; puede ajustarse.</span>
            </div>
            <div class="form-group">
              <label for="nc-subida">Velocidad de subida (Mbps) <b class="req">*</b></label>
              <input id="nc-subida" type="number" inputmode="decimal" [(ngModel)]="uploadMbps" class="form-input" min="0.1" step="0.1" />
              <span class="hint">Se aplicará como límite de velocidad en el MikroTik.</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Datos personales <span class="optional">opcional</span></h3>
          <p class="help">Se guardan después de crear el servicio.</p>

          <div class="form-row">
            <div class="form-group">
              <label for="nc-tel">Teléfono</label>
              <input id="nc-tel" type="tel" [(ngModel)]="telefono" class="form-input" placeholder="809-123-4567" />
            </div>
            <div class="form-group">
              <label for="nc-cedula">Cédula</label>
              <input id="nc-cedula" type="text" [(ngModel)]="cedula" class="form-input" placeholder="001-0000000-0" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="nc-email">Correo electrónico</label>
              <input id="nc-email" type="email" [(ngModel)]="email" class="form-input" placeholder="cliente@correo.com" />
            </div>
            <div class="form-group">
              <label for="nc-ciudad">Ciudad</label>
              <input id="nc-ciudad" type="text" [(ngModel)]="ciudad" class="form-input" placeholder="Santo Domingo" />
            </div>
          </div>

          <div class="form-group">
            <label for="nc-direccion">Dirección</label>
            <input id="nc-direccion" type="text" [(ngModel)]="direccion" class="form-input" placeholder="Calle, número, sector" />
          </div>
        </div>

        @if (result(); as creation) {
          <section class="creation-result" [class.partial]="creation.status !== 'complete'" aria-live="polite">
            <div class="result-icon">
              @if (creation.status === 'complete') { <svg lucideCircleCheck size="22"></svg> }
              @else { <svg lucideTriangleAlert size="22"></svg> }
            </div>
            <div class="result-copy">
              <strong>{{ creation.status === 'complete' ? 'Cliente creado y verificado' : 'Alta incompleta' }}</strong>
              <span>{{ creation.status === 'complete' ? 'WispHub, MikroTik y el sistema local confirmaron el cliente.' : (creation.error || 'Alguno de los pasos quedó pendiente. Pulse «Completar alta» para reintentar.') }}</span>
            </div>
            <div class="result-systems">
              <span [class.ok]="creation.wisphub.ok">WispHub <b>{{ creation.wisphub.ok ? 'Listo' : 'Pendiente' }}</b></span>
              <span [class.ok]="creation.mikrotik.ok">MikroTik <b>{{ creation.mikrotik.ok ? 'Listo' : 'Pendiente' }}</b></span>
              <span [class.ok]="creation.sqlite?.ok">Sistema local <b>{{ creation.sqlite?.ok ? 'Listo' : 'Pendiente' }}</b></span>
              @if (onuSerial.trim()) { <span [class.ok]="installationWaitingOptical()">OLT <b>{{ installationWaitingOptical() ? 'Esperando ONU' : 'Pendiente' }}</b></span> }
            </div>
          </section>
        }

        <div class="actions-bar">
          @if (!saving() && missingFields().length) {
            <p class="missing-fields" role="status"><svg lucideTriangleAlert size="15"></svg>Falta completar: {{ missingFields().join(', ') }}</p>
          }
          <button class="btn btn-outline" type="button" routerLink="/clients">Cancelar</button>
          @if (result()?.status === 'complete') {
            <button class="btn btn-outline" type="button" (click)="openCreatedClient()">Ver cliente</button>
          }
          <button class="btn btn-primary" (click)="create()" [disabled]="saving() || !canSubmit()">
            @if (saving()) {
              <div class="btn-spinner"></div>
              <span>Creando en WispHub y MikroTik…</span>
            } @else {
              @if (result()?.status === 'partial') { <svg lucideRefreshCw size="16"></svg> }
              @else { <svg lucideUserPlus size="16"></svg> }
              <span>{{ result()?.status === 'partial' ? 'Completar alta' : 'Crear cliente' }}</span>
            }
          </button>
        </div>
      </div>
    </div>

    @if (ipPickerOpen()) {
      <button type="button" class="ip-picker-backdrop" aria-label="Cerrar selector de IP" (click)="closeIpPicker()"></button>
      <section class="ip-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="new-client-ip-title">
        <header>
          <div><span>Inventario MikroTik</span><h2 id="new-client-ip-title">Elegir IP disponible</h2><p>Seleccione el segmento y luego una dirección para este cliente.</p></div>
          <button type="button" class="close-button" aria-label="Cerrar" (click)="closeIpPicker()"><svg lucideX size="18"></svg></button>
        </header>
        <div class="ip-picker-filters">
          <label><span>Segmento</span><select class="form-input" [(ngModel)]="ipPickerNetwork" (ngModelChange)="loadAvailableIps($event)"><option value="">Todos los segmentos</option>@for (network of ipCatalog()?.networks || []; track network.cidr) { <option [value]="network.cidr">{{ network.cidr }} · {{ network.available }} libres</option> }</select></label>
          <label><span>Buscar IP</span><div class="modal-search"><svg lucideSearch size="15"></svg><input type="search" [(ngModel)]="ipPickerSearch" placeholder="Ej. 192.168.16.24" /></div></label>
        </div>
        @if (ipCatalog()?.stale) { <p class="ip-catalog-warning">Inventario guardado: la IP se comprobará en vivo antes de crear.</p> }
        <div class="ip-picker-list">
          @if (ipLoading()) { <div class="ip-picker-empty"><div class="btn-spinner dark"></div><span>Buscando direcciones…</span></div> }
          @else {
            @for (address of filteredAvailableIps(); track address.ip) {
              <button type="button" [class.selected]="selectedAvailableIp()?.ip === address.ip" (click)="selectedAvailableIp.set(address)">
                <span><strong class="mono">{{ address.ip }}</strong><small>{{ address.cidr }}</small></span>
                <b [class.probe]="address.availabilityConfidence === 'probe_required'">{{ address.availabilityConfidence === 'probe_required' ? 'Se comprobará' : 'Verificada' }}</b>
              </button>
            } @empty { <div class="ip-picker-empty"><span>No hay IP disponibles con este filtro.</span><small>Pruebe con otro segmento o borre la búsqueda.</small></div> }
          }
        </div>
        <footer>
          <div>@if (selectedAvailableIp(); as address) { <span>Seleccionada</span><strong class="mono">{{ address.ip }}</strong> }</div>
          <button type="button" class="btn btn-primary" [disabled]="!selectedAvailableIp()" (click)="useSelectedIp()"><svg lucideCircleCheck size="16"></svg>Usar esta IP</button>
        </footer>
      </section>
    }
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .back-link { display: inline-flex; align-items: center; gap: 6px; color: #1267dd; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 20px; }
    .back-link:hover { text-decoration: underline; }

    .form-wrap { max-width: 820px; }

    .card {
      background: white; border: 1px solid #e2e8f0; border-radius: 8px;
      padding: 24px; margin-bottom: 16px;
    }
    .card h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #172535; }
    .help { margin: 0 0 20px; font-size: 13px; color: #667582; }
    .req { color: #b42318; font-weight: 700; }
    .catalog-error { display: flex; align-items: center; gap: 6px; margin: -4px 0 14px; padding: 8px 10px; border: 1px solid #f0b4ae; border-radius: 6px; background: #fff0ef; color: #b42318; font-size: 13px; }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #334250; margin-bottom: 6px; }
    .form-input {
      width: 100%; padding: 10px 14px; border: 1px solid #ccd6de; border-radius: 6px;
      font-size: 14px; color: #172535; background: #fff; outline: none; box-sizing: border-box; transition: border 0.2s;
    }
    .form-input.mono, .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .form-input:disabled { background: #f8fafc; color: #667582; cursor: wait; }
    .form-input[readonly] { background: #f8fafc; color: #0f172a; cursor: default; }
    .form-input:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221,0.1); }
    .hint { display: block; font-size: 12px; color: #667582; margin-top: 4px; }
    .optional { color: #667582; font-weight: 500; }
    .ip-assignment { padding: 14px; border: 1px solid #dbe5ea; border-radius: 7px; background: #f8fbfc; }
    .ip-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .ip-search-button { min-width: 132px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 1px solid #1267dd; border-radius: 6px; background: #fff; color: #1267dd; font-weight: 700; cursor: pointer; }
    .ip-search-button:hover:not(:disabled) { background: #f2f7ff; }
    .ip-search-button:disabled { opacity: .55; cursor: wait; }
    .active-hint { color: #1267dd; }.selected-hint { color: #13875a; }.error-hint { color: #b36b12; }
    .bandwidth-row { padding-top: 4px; border-top: 1px solid #f1f5f9; }

    .creation-result {
      display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px;
      padding: 16px; margin-bottom: 16px; border: 1px solid #86efac; border-radius: 8px;
      background: #f0fdf4; color: #166534;
    }
    .creation-result.partial { border-color: #fdba74; background: #fff7ed; color: #9a3412; }
    .result-icon { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: white; }
    .result-copy { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .result-copy strong { font-size: 14px; }
    .result-copy span { font-size: 12px; color: #475569; }
    .result-systems { grid-column: 2; display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
    .result-systems span { display: flex; justify-content: space-between; gap: 8px; padding: 8px 10px; background: white; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 12px; color: #64748b; }
    .result-systems span.ok { color: #166534; border-color: #bbf7d0; }

    .actions-bar {
      position: sticky; bottom: 0;
      display: flex; align-items: center; justify-content: flex-end; gap: 10px;
      background: white; padding: 16px; border-radius: 8px; border: 1px solid #e2e8f0;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.04);
    }
    .btn { white-space: nowrap; flex: 0 0 auto;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px; border-radius: 6px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; text-decoration: none; }
    .btn-outline:hover { background: #f1f5f9; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover { background: #0d58c0; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-spinner {
      width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    .btn-spinner.dark { border-color: #cbd5e1; border-top-color: #1267dd; }

    .ip-picker-backdrop { position: fixed; inset: 0; z-index: 129; border: 0; background: rgba(15, 23, 42, .56); }
    .ip-picker-dialog { position: fixed; z-index: 130; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(700px, calc(100vw - 28px)); max-height: min(760px, calc(100vh - 28px)); display: grid; grid-template-rows: auto auto auto minmax(220px, 1fr) auto; overflow: hidden; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; box-shadow: 0 28px 70px rgba(15, 23, 42, .32); }
    .ip-picker-dialog > header { padding: 16px 18px; display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e2e8f0; }
    .ip-picker-dialog > header span, .ip-picker-dialog label > span, .ip-picker-dialog > footer span { color: #64748b; font-size: 11px; font-weight: 750; text-transform: uppercase; }
    .ip-picker-dialog > header h2 { margin: 2px 0; color: #0f172a; font-size: 18px; }.ip-picker-dialog > header p { margin: 0; color: #64748b; font-size: 11px; }
    .close-button { width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; color: #475569; cursor: pointer; }
    .ip-picker-filters { padding: 13px 18px; display: grid; grid-template-columns: .85fr 1.15fr; gap: 10px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }.ip-picker-filters label { display: grid; gap: 5px; }
    .modal-search { min-height: 40px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; }.modal-search input { width: 100%; border: 0; outline: 0; color: #334155; }
    .ip-catalog-warning { margin: 0; padding: 9px 18px; border-bottom: 1px solid #fed7aa; background: #fff7ed; color: #9a3412; font-size: 11px; }
    .ip-picker-list { min-height: 240px; max-height: 410px; overflow-y: auto; padding: 9px 18px; }.ip-picker-list > button { width: 100%; min-height: 52px; padding: 8px 11px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid transparent; border-bottom-color: #e5e7eb; background: #fff; color: #334155; text-align: left; cursor: pointer; }.ip-picker-list > button:hover { background: #f8fafc; }.ip-picker-list > button.selected { border-color: #1267dd; border-radius: 6px; background: #f2f7ff; }.ip-picker-list > button span { display: grid; gap: 3px; }.ip-picker-list > button strong { font-size: 13px; }.ip-picker-list > button small { color: #64748b; font-size: 12px; }.ip-picker-list > button b { padding: 3px 7px; border-radius: 9px; color: #137652; background: #e8f7f1; font-size: 11px; }.ip-picker-list > button b.probe { color: #9a5b0a; background: #fff1d6; }
    .ip-picker-empty { min-height: 210px; display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 8px; color: #334250; font-size: 13px; text-align: center; }.ip-picker-empty small { color: #667582; font-size: 12px; }.ip-picker-dialog > footer { min-height: 66px; padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; border-top: 1px solid #e2e8f0; background: #f8fafc; }.ip-picker-dialog > footer > div { display: grid; gap: 2px; }.ip-picker-dialog > footer strong { font-size: 13px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      .page { padding: 18px 14px; }
      .form-row { grid-template-columns: 1fr; }
      .ip-control, .ip-picker-filters { grid-template-columns: 1fr; }
      .ip-search-button { min-height: 40px; }
      .result-systems { grid-template-columns: 1fr; }
      .actions-bar { flex-direction: column; }
      .actions-bar .btn { width: 100%; justify-content: center; }
      .ip-picker-dialog { width: calc(100vw - 16px); max-height: calc(100vh - 16px); }.ip-picker-dialog > footer { align-items: stretch; flex-direction: column; }.ip-picker-dialog > footer .btn { width: 100%; justify-content: center; }
    }
  
    .missing-fields { display: flex; align-items: center; gap: 6px; margin: 0 auto 0 0; color: #b36b12; font-size: 13px; }
    .missing-fields svg { flex: 0 0 auto; }
    h3 .optional { margin-left: 6px; color: #8391a0; font-size: 12px; font-weight: 500; }
    @media (max-width: 640px) { .missing-fields { width: 100%; margin: 0 0 8px; } }
  `]
})
export class NewClientComponent implements OnInit {
  private api = inject(WisphubService);
  private olt = inject(OltService);
  private toast = inject(ToastService);
  private router = inject(Router);

  plans = signal<InternetPlan[]>([]);
  zones = signal<Zone[]>([]);

  // Campos servicio (requeridos)
  zonaId = 0;
  planId = 0;
  usuarioRb = '';
  onuSerial = '';
  ip = '';
  uploadMbps = 0;
  downloadMbps = 0;

  // Campos personales (opcional)
  telefono = '';
  cedula = '';
  email = '';
  ciudad = '';
  direccion = '';

  saving = signal(false);
  result = signal<ClientProvisioningResult | null>(null);
  ipCatalog = signal<ProvisioningIpCatalog | null>(null);
  ipLoading = signal(false);
  ipPickerOpen = signal(false);
  selectedAvailableIp = signal<ProvisioningIpAddress | null>(null);
  ipReservation = signal<ProvisioningIpReservation | null>(null);
  provisioningJobId = signal<string | null>(null);
  installationWaitingOptical = signal(false);
  ipWasAutoSuggested = signal(false);
  catalogLoading = signal(true);
  catalogError = signal('');
  ipPickerNetwork = '192.168.16.0/24';
  ipPickerSearch = '';
  private readonly draftKey = `web-client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  ngOnInit() {
    let pendingCatalogs = 2;
    const catalogDone = () => { if (--pendingCatalogs === 0) this.catalogLoading.set(false); };
    const catalogFailed = () => {
      this.catalogError.set('No se pudieron cargar las zonas o los planes desde WispHub. Recargue la página para reintentar.');
      catalogDone();
    };
    this.api.getPlans().subscribe({
      next: (res: PlanResponse) => { this.plans.set(res.results || []); catalogDone(); },
      error: catalogFailed,
    });
    this.api.getZones().subscribe({
      next: (res: ZoneResponse) => {
        this.zones.set(res.results || []);
        if (res.results?.length === 1) this.zonaId = res.results[0].id;
        catalogDone();
      },
      error: catalogFailed,
    });
    this.loadAvailableIps(this.ipPickerNetwork, true);
  }

  canSubmit(): boolean {
    return this.missingFields().length === 0;
  }

  missingFields(): string[] {
    const missing: string[] = [];
    if (!this.zonaId) missing.push('zona');
    if (!this.planId) missing.push('plan');
    if (!this.usuarioRb.trim()) missing.push('nombre del servicio');
    if (!this.ip.trim()) missing.push('dirección IP');
    if (!(Number(this.downloadMbps) > 0)) missing.push('velocidad de bajada');
    if (!(Number(this.uploadMbps) > 0)) missing.push('velocidad de subida');
    return missing;
  }

  planChanged(planId: number) {
    this.planId = Number(planId);
    const plan = this.plans().find((item) => item.id === this.planId);
    const speed = this.inferPlanBandwidth(plan?.nombre || '');
    if (speed) {
      this.uploadMbps = speed.uploadMbps;
      this.downloadMbps = speed.downloadMbps;
    } else {
      this.uploadMbps = 0;
      this.downloadMbps = 0;
    }
  }

  loadAvailableIps(cidr = this.ipPickerNetwork, autoSelect = false) {
    this.ipPickerNetwork = cidr;
    this.ipLoading.set(true);
    this.olt.getAvailableIps(cidr).subscribe({
      next: (catalog) => {
        this.ipCatalog.set(catalog);
        this.ipLoading.set(false);
        const current = catalog.rows.find((row) => row.ip === this.ip);
        this.selectedAvailableIp.set(current || null);
        if (autoSelect && !this.ip && catalog.rows.length) {
          const suggested = catalog.rows.find((row) => row.recommended && row.availabilityConfidence === 'verified')
            || catalog.rows.find((row) => row.recommended)
            || catalog.rows.find((row) => row.availabilityConfidence === 'verified')
            || catalog.rows[0];
          this.ip = suggested.ip;
          this.ipWasAutoSuggested.set(true);
          this.selectedAvailableIp.set(suggested);
        }
      },
      error: (error: { error?: { error?: string } }) => {
        this.ipLoading.set(false);
        this.toast.error(error.error?.error || 'No se pudo consultar el inventario de IP');
      },
    });
  }

  filteredAvailableIps() {
    const query = this.ipPickerSearch.trim().toLowerCase();
    return (this.ipCatalog()?.rows || []).filter((row) => !query || row.ip.toLowerCase().includes(query));
  }

  openIpPicker() {
    this.ipPickerOpen.set(true);
    this.selectedAvailableIp.set((this.ipCatalog()?.rows || []).find((row) => row.ip === this.ip) || null);
    if (!this.ipCatalog() && !this.ipLoading()) this.loadAvailableIps(this.ipPickerNetwork);
  }

  closeIpPicker() {
    this.ipPickerOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.ipPickerOpen()) this.closeIpPicker();
  }

  useSelectedIp() {
    const address = this.selectedAvailableIp();
    if (!address) return;
    const reservation = this.ipReservation();
    if (reservation && reservation.ip !== address.ip) {
      this.toast.error(`La instalación iniciada ya conserva ${reservation.ip}`);
      return;
    }
    this.ip = address.ip;
    this.ipWasAutoSuggested.set(false);
    this.ipPickerNetwork = address.cidr || this.ipPickerNetwork;
    this.closeIpPicker();
  }

  async create() {
    if (!this.canSubmit()) {
      this.toast.error(`Falta completar: ${this.missingFields().join(', ')}`);
      return;
    }

    this.saving.set(true);
    this.result.set(null);
    this.installationWaitingOptical.set(false);
    try {
      let reservation = this.ipReservation();
      if (!reservation || reservation.ip !== this.ip || new Date(reservation.expiresAt).getTime() <= Date.now()) {
        reservation = await firstValueFrom(this.olt.reserveIp(this.ip.trim(), this.usuarioRb.trim(), this.onuSerial.trim() || null));
        this.ipReservation.set(reservation);
        this.provisioningJobId.set(null);
      }
      let jobId = this.provisioningJobId();
      if (!jobId) {
        const job = await firstValueFrom(this.olt.createProvisioningJob({
          idempotencyKey: `${this.draftKey}-${reservation.token}`,
          mode: 'new_client', clientName: this.usuarioRb.trim(), ip: this.ip.trim(),
          zoneId: this.zonaId, planId: this.planId,
          uploadMbps: Number(this.uploadMbps), downloadMbps: Number(this.downloadMbps),
          serial: this.onuSerial.trim() || null, model: this.onuSerial.trim() ? 'EG8141A5' : null,
          vlan: 101, reservationToken: reservation.token, source: 'new-client',
        }));
        jobId = job.id;
        this.provisioningJobId.set(job.id);
      }
      const creation = await firstValueFrom(this.api.provisionClient({
        jobId, zoneId: this.zonaId, planId: this.planId,
        serviceName: this.usuarioRb.trim(), ip: this.ip.trim(),
        uploadMbps: Number(this.uploadMbps), downloadMbps: Number(this.downloadMbps),
        phone: this.telefono, nationalId: this.cedula, email: this.email,
        city: this.ciudad, address: this.direccion,
      }));
      this.result.set(creation);
      this.installationWaitingOptical.set(Boolean(this.onuSerial.trim()));
      this.toast.success(`Cliente #${creation.wisphub.idServicio} creado en WispHub y MikroTik`);
    } catch (error: any) {
      const failure = error?.error as (ClientProvisioningResult & { error?: string }) | undefined;
      if (failure?.status) this.result.set(failure);
      this.toast.error(failure?.error || error?.message || 'No se pudo completar el alta del cliente');
      if (failure?.status === 'failed') {
        const reservation = this.ipReservation();
        if (reservation) await firstValueFrom(this.olt.releaseIpReservation(reservation.token)).catch(() => null);
        this.ipReservation.set(null);
        this.provisioningJobId.set(null);
        this.ip = '';
        this.loadAvailableIps(this.ipPickerNetwork, true);
      }
    } finally {
      this.saving.set(false);
    }
  }

  openCreatedClient() {
    const idServicio = this.result()?.wisphub.idServicio;
    if (idServicio) this.router.navigate(['/clients', idServicio]);
  }

  private inferPlanBandwidth(planName: string) {
    const matches = [...planName.toLowerCase().replace(/,/g, '.').matchAll(/(\d+(?:\.\d+)?)\s*(g|gb|m|mb|k|kb)?/g)];
    const values = matches.slice(0, 2).map((match) => {
      const value = Number(match[1]);
      const unit = match[2] || 'm';
      if (unit.startsWith('g')) return value * 1000;
      if (unit.startsWith('k')) return value / 1000;
      return value;
    });
    if (!values.length || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
    return { uploadMbps: values[0], downloadMbps: values[1] || values[0] };
  }
}
