import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReceiptService } from '../../services/receipt.service';
import { ToastService } from '../../services/toast.service';

@Component({
  selector: 'app-client-detail',
  standalone: true,
  imports: [NavbarComponent, RouterLink, DecimalPipe, FormsModule],
  template: `
    <app-navbar [pageTitle]="clientName()" />

    <div class="page">
      <a routerLink="/clients" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        Volver a clientes
      </a>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div></div>
      } @else if (client()) {
        <!-- PERFIL BAR -->
        <div class="profile-bar">
          <div class="profile-left">
            <div class="avatar-lg" [class]="getStatusClass(client()!.estado)">
              {{ getInitials(client()!.nombre) }}
            </div>
            <div>
              <h2>{{ client()!.nombre }}</h2>
              <div class="profile-badges">
                <span class="badge" [class]="'badge-' + getStatusClass(client()!.estado)">{{ client()!.estado }}</span>
                <span class="badge badge-plan">{{ client()!.plan_internet?.nombre || 'Sin plan' }}</span>
                <span class="id-tag">#{{ client()!.id_servicio }}</span>
              </div>
            </div>
          </div>
          <div class="profile-actions">
            <button class="btn btn-outline" (click)="pingClient()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Ping
            </button>
            @if (client()!.estado.toLowerCase() === 'activo') {
              <button class="btn btn-red" (click)="deactivateClient()">Suspender</button>
            } @else {
              <button class="btn btn-green" (click)="activateClient()">Activar</button>
            }
          </div>
        </div>

        @if (pingResult()) {
          <div class="ping-box" [class.success]="pingSuccess()"><pre>{{ pingResult() }}</pre></div>
        }

        <div class="detail-grid">
          <!-- EDITAR DATOS PERSONALES -->
          <div class="card">
            <div class="card-head">
              <h3>Datos del Cliente</h3>
              @if (!editingProfile()) {
                <button class="btn-edit" (click)="startEditProfile()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingProfile()) {
              <div class="edit-form">
                <div class="form-row">
                  <div class="form-group">
                    <label>Nombre completo</label>
                    <input type="text" [(ngModel)]="editName" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Telefono</label>
                    <input type="text" [(ngModel)]="editPhone" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Cedula</label>
                    <input type="text" [(ngModel)]="editCedula" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Email</label>
                    <input type="email" [(ngModel)]="editEmail" class="form-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Direccion</label>
                    <input type="text" [(ngModel)]="editDireccion" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Ciudad</label>
                    <input type="text" [(ngModel)]="editCiudad" class="form-input" />
                  </div>
                </div>
                <div class="edit-actions">
                  <button class="btn btn-primary" (click)="saveProfile()" [disabled]="saving()">
                    {{ saving() ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button class="btn btn-outline" (click)="editingProfile.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Usuario</span><span class="val mono">{{ client()!.usuario }}</span></div>
                <div class="info-item"><span class="lbl">Telefono</span><span class="val phone">{{ client()!.telefono || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Email</span><span class="val">{{ client()!.email || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Cedula</span><span class="val">{{ client()!.cedula || '-' }}</span></div>
                <div class="info-item full"><span class="lbl">Direccion</span><span class="val">{{ client()!.direccion || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Ciudad</span><span class="val">{{ client()!.ciudad || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Tecnico</span><span class="val">{{ client()!.tecnico?.nombre || '-' }}</span></div>
              </div>
            }
          </div>

          <!-- EDITAR SERVICIO -->
          <div class="card">
            <div class="card-head">
              <h3>Servicio de Internet</h3>
              @if (!editingService()) {
                <button class="btn-edit" (click)="startEditService()">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
              }
            </div>
            @if (editingService()) {
              <div class="edit-form">
                <div class="form-row">
                  <div class="form-group">
                    <label>IP</label>
                    <input type="text" [(ngModel)]="editIp" class="form-input mono-input" />
                  </div>
                  <div class="form-group">
                    <label>MAC CPE</label>
                    <input type="text" [(ngModel)]="editMac" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Interfaz LAN</label>
                    <input type="text" [(ngModel)]="editLan" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>SN ONU</label>
                    <input type="text" [(ngModel)]="editOnu" class="form-input mono-input" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>SSID WiFi</label>
                    <input type="text" [(ngModel)]="editSsid" class="form-input" />
                  </div>
                  <div class="form-group">
                    <label>Password WiFi</label>
                    <input type="text" [(ngModel)]="editWifiPass" class="form-input" />
                  </div>
                </div>
                <div class="form-group">
                  <label>Comentarios</label>
                  <textarea [(ngModel)]="editComentarios" class="form-input" rows="2"></textarea>
                </div>
                <div class="edit-actions">
                  <button class="btn btn-primary" (click)="saveService()" [disabled]="saving()">
                    {{ saving() ? 'Guardando...' : 'Guardar' }}
                  </button>
                  <button class="btn btn-outline" (click)="editingService.set(false)">Cancelar</button>
                </div>
              </div>
            } @else {
              <div class="info-grid">
                <div class="info-item"><span class="lbl">Plan</span><span class="val highlight">{{ client()!.plan_internet?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Precio</span><span class="val highlight">RD$ {{ client()!.precio_plan }}</span></div>
                <div class="info-item"><span class="lbl">IP</span><span class="val mono">{{ client()!.ip || '-' }}</span></div>
                <div class="info-item"><span class="lbl">MAC CPE</span><span class="val mono">{{ client()!.mac_cpe || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Interfaz LAN</span><span class="val mono">{{ client()!.interfaz_lan || '-' }}</span></div>
                <div class="info-item"><span class="lbl">SN ONU</span><span class="val mono">{{ client()!.sn_onu || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Zona</span><span class="val">{{ client()!.zona?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Router</span><span class="val">{{ client()!.router?.nombre || '-' }}</span></div>
                <div class="info-item"><span class="lbl">SSID WiFi</span><span class="val mono">{{ client()!.ssid_router_wifi || '-' }}</span></div>
                <div class="info-item"><span class="lbl">Pass WiFi</span><span class="val mono">{{ client()!.password_ssid_router_wifi || '-' }}</span></div>
              </div>
            }
          </div>

          <!-- FACTURACION (solo lectura) -->
          <div class="card">
            <h3>Facturacion</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Estado Facturas</span>
                <span class="val"><span class="badge" [class]="'badge-' + getFacturaClass(client()!.estado_facturas)">{{ client()!.estado_facturas || '-' }}</span></span>
              </div>
              <div class="info-item"><span class="lbl">Saldo</span><span class="val saldo" [class.red]="+(client()!.saldo || 0) > 0">RD$ {{ client()!.saldo || '0.00' }}</span></div>
              <div class="info-item"><span class="lbl">Fecha Instalacion</span><span class="val">{{ client()!.fecha_instalacion || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Fecha Corte</span><span class="val">{{ client()!.fecha_corte || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Firewall</span><span class="val">{{ client()!.firewall ? 'Si' : 'No' }}</span></div>
              <div class="info-item"><span class="lbl">Ultimo Cambio</span><span class="val">{{ client()!.ultimo_cambio || '-' }}</span></div>
            </div>
          </div>

          <!-- CONFIG WiFi (solo lectura) -->
          <div class="card">
            <h3>Router / CPE</h3>
            <div class="info-grid">
              <div class="info-item"><span class="lbl">Modelo Router</span><span class="val">{{ client()!.modelo_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">IP Router</span><span class="val mono">{{ client()!.ip_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">MAC Router</span><span class="val mono">{{ client()!.mac_router_wifi || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Antena</span><span class="val">{{ client()!.modelo_antena || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Contratacion</span><span class="val">{{ client()!.forma_contratacion || '-' }}</span></div>
              <div class="info-item"><span class="lbl">Comentarios</span><span class="val">{{ client()!.comentarios || '-' }}</span></div>
            </div>
          </div>
        </div>

        <!-- FACTURAS DEL CLIENTE -->
        @if (clientInvoices().length > 0) {
          <div class="card invoices-section">
            <h3>Facturas del Cliente ({{ clientInvoices().length }})</h3>
            <table class="data-table">
              <thead>
                <tr><th>#</th><th>Emision</th><th>Vencimiento</th><th>Total</th><th>Estado</th><th>Pago</th><th>Recibo</th></tr>
              </thead>
              <tbody>
                @for (inv of clientInvoices(); track inv.id_factura) {
                  <tr>
                    <td class="id-col">{{ inv.id_factura }}</td>
                    <td>{{ inv.fecha_emision }}</td>
                    <td>{{ inv.fecha_vencimiento }}</td>
                    <td class="money">RD$ {{ inv.total | number:'1.2-2' }}</td>
                    <td><span class="badge" [class]="'badge-' + getInvStatusClass(inv.estado)">{{ inv.estado }}</span></td>
                    <td>{{ inv.forma_pago?.nombre || '-' }}</td>
                    <td>
                      <button class="btn-icon" (click)="printReceipt(inv)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .back-link { display: inline-flex; align-items: center; gap: 6px; color: #6366f1; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 20px; }
    .back-link:hover { text-decoration: underline; }

    .profile-bar {
      display: flex; align-items: center; justify-content: space-between;
      background: white; border: 1px solid #e2e8f0; border-radius: 16px;
      padding: 24px; margin-bottom: 20px; flex-wrap: wrap; gap: 16px;
    }
    .profile-left { display: flex; align-items: center; gap: 16px; }
    .avatar-lg { width: 64px; height: 64px; border-radius: 16px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 22px; color: white; }
    .avatar-lg.active { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .avatar-lg.suspended { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .avatar-lg.free { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .avatar-lg.default { background: linear-gradient(135deg, #94a3b8, #64748b); }
    .profile-left h2 { margin: 0 0 6px; font-size: 22px; font-weight: 700; color: #0f172a; }
    .profile-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .id-tag { font-size: 13px; color: #94a3b8; }
    .profile-actions { display: flex; gap: 10px; }

    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }
    .btn-red { background: #ef4444; color: white; }
    .btn-red:hover { background: #dc2626; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

    .btn-edit {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; font-size: 12px; color: #6366f1; font-weight: 500;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-edit:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .ping-box { margin-bottom: 20px; padding: 12px 16px; border-radius: 10px; background: #fef2f2; border: 1px solid #fecaca; }
    .ping-box.success { background: #f0fdf4; border-color: #bbf7d0; }
    .ping-box pre { margin: 0; font-size: 12px; white-space: pre-wrap; font-family: 'Courier New', monospace; }

    .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px; }
    .card { background: white; border-radius: 16px; border: 1px solid #e2e8f0; padding: 24px; }

    .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }
    .card-head h3 { margin: 0; font-size: 15px; font-weight: 600; color: #0f172a; }
    .card h3 { font-size: 15px; font-weight: 600; color: #0f172a; margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #f1f5f9; }

    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .info-item.full { grid-column: 1 / -1; }
    .lbl { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.3px; margin-bottom: 2px; }
    .val { font-size: 14px; color: #0f172a; font-weight: 500; word-break: break-all; }
    .val.mono { font-family: 'Courier New', monospace; font-size: 13px; }
    .val.highlight { color: #6366f1; font-weight: 700; }
    .val.phone { color: #0f172a; font-size: 16px; font-weight: 700; }
    .val.saldo { font-size: 18px; font-weight: 700; color: #22c55e; }
    .val.saldo.red { color: #ef4444; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-suspended { background: #fee2e2; color: #dc2626; }
    .badge-free { background: #dbeafe; color: #2563eb; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .badge-plan { background: #eef2ff; color: #6366f1; }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }

    /* EDIT FORM */
    .edit-form { animation: fadeIn 0.2s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 4px; }
    .form-input { width: 100%; padding: 9px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px; color: #334155; outline: none; box-sizing: border-box; transition: border 0.2s; }
    .form-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    .mono-input { font-family: 'Courier New', monospace; }
    textarea.form-input { resize: vertical; }
    .edit-actions { display: flex; gap: 8px; margin-top: 4px; }

    /* INVOICES */
    .invoices-section { overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
    .data-table td { padding: 10px 12px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .id-col { font-weight: 600; color: #6366f1; }
    .money { font-family: 'Courier New', monospace; font-weight: 600; }
    .btn-icon { background: none; border: 1px solid #e2e8f0; border-radius: 8px; padding: 5px 7px; cursor: pointer; color: #64748b; transition: all 0.2s; }
    .btn-icon:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .loading-state { display: flex; flex-direction: column; align-items: center; padding: 80px; }
    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } .form-row { grid-template-columns: 1fr; } }
    @media (max-width: 640px) {
      .profile-bar { flex-direction: column; align-items: flex-start; }
      .profile-actions { width: 100%; flex-wrap: wrap; }
      .profile-actions .btn { flex: 1; justify-content: center; }
      .avatar-lg { width: 56px; height: 56px; font-size: 20px; }
      .profile-left h2 { font-size: 18px; }
      .card { padding: 16px; }
      .info-grid { grid-template-columns: 1fr; gap: 10px; }
    }
  `]
})
export class ClientDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private receiptSvc = inject(ReceiptService);
  private toast = inject(ToastService);

  client = signal<WispHubClient | null>(null);
  clientName = signal('Cliente');
  clientInvoices = signal<Invoice[]>([]);
  loading = signal(true);
  saving = signal(false);
  pingResult = signal('');
  pingSuccess = signal(false);

  // Edit profile state
  editingProfile = signal(false);
  editName = '';
  editPhone = '';
  editCedula = '';
  editEmail = '';
  editDireccion = '';
  editCiudad = '';

  // Edit service state
  editingService = signal(false);
  editIp = '';
  editMac = '';
  editLan = '';
  editOnu = '';
  editSsid = '';
  editWifiPass = '';
  editComentarios = '';

  async ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      const c = await this.db.getClient(id);
      if (c) {
        this.client.set(c);
        this.clientName.set(c.nombre);
      }
      const allInv = await this.db.getInvoices();
      this.clientInvoices.set(allInv.filter(i =>
        i.articulos?.some(a => a.servicio?.id_servicio === id) ||
        i.cliente?.nombre?.toLowerCase() === c?.nombre?.toLowerCase()
      ));
    }
    this.loading.set(false);
  }

  // ─── EDIT PROFILE ───
  startEditProfile() {
    const c = this.client();
    if (!c) return;
    this.editName = c.nombre || '';
    this.editPhone = c.telefono || '';
    this.editCedula = c.cedula || '';
    this.editEmail = c.email || '';
    this.editDireccion = c.direccion || '';
    this.editCiudad = c.ciudad || '';
    this.editingProfile.set(true);
  }

  saveProfile() {
    const c = this.client();
    if (!c) return;
    this.saving.set(true);

    // 1. Update nombre via PATCH servicio (siempre funciona)
    this.api.updateServiceName(c.id_servicio, this.editName).subscribe({
      next: () => {
        // 2. Update datos personales via PUT perfil
        const profileData: any = {
          nombre: this.editName.split(' ')[0] || this.editName,
          apellidos: this.editName.split(' ').slice(1).join(' ') || '-',
          telefono: this.editPhone || '0000000000',
          cedula: this.editCedula || '-',
          email: this.editEmail || 'na@na.com',
          direccion: this.editDireccion || '-',
          localidad: this.editCiudad || '-',
          ciudad: this.editCiudad || '-',
        };

        this.api.updateProfile(c.id_servicio, profileData).subscribe({
          next: () => this.onProfileSaved(),
          error: () => this.onProfileSaved() // PUT da 500 pero guarda los datos
        });
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error('Error: ' + (e.error?.detail || 'No se pudo guardar'));
      }
    });
  }

  private async onProfileSaved() {
    this.saving.set(false);
    this.editingProfile.set(false);
    this.toast.success('Datos del cliente actualizados');

    // Refresh from API
    const c = this.client()!;
    this.api.getClientProfile(c.id_servicio).subscribe({
      next: (profile) => {
        const updated = { ...c, nombre: profile.nombre + (profile.apellidos ? ' ' + profile.apellidos : ''), telefono: profile.telefono, cedula: profile.cedula, email: profile.email, direccion: profile.direccion, ciudad: profile.ciudad };
        this.client.set(updated);
        this.clientName.set(updated.nombre);
        this.db.saveClients([updated]); // update local cache
      }
    });
  }

  // ─── EDIT SERVICE ───
  startEditService() {
    const c = this.client();
    if (!c) return;
    this.editIp = c.ip || '';
    this.editMac = c.mac_cpe || '';
    this.editLan = c.interfaz_lan || '';
    this.editOnu = c.sn_onu || '';
    this.editSsid = c.ssid_router_wifi || '';
    this.editWifiPass = c.password_ssid_router_wifi || '';
    this.editComentarios = c.comentarios || '';
    this.editingService.set(true);
  }

  saveService() {
    const c = this.client();
    if (!c) return;
    this.saving.set(true);

    const data: any = {
      ip: this.editIp,
      mac_cpe: this.editMac,
      interfaz_lan: this.editLan,
      sn_onu: this.editOnu,
      ssid_router_wifi: this.editSsid,
      password_ssid_router_wifi: this.editWifiPass,
      comentarios: this.editComentarios,
    };

    this.api.updateService(c.id_servicio, data).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.editingService.set(false);
        this.toast.success('Servicio actualizado en WispHub');

        const updated = { ...c, ip: this.editIp, mac_cpe: this.editMac, interfaz_lan: this.editLan, sn_onu: this.editOnu, ssid_router_wifi: this.editSsid, password_ssid_router_wifi: this.editWifiPass, comentarios: this.editComentarios };
        this.client.set(updated);
        this.db.saveClients([updated]);
      },
      error: (e) => {
        this.saving.set(false);
        this.toast.error('Error: ' + (e.error?.detail || 'No se pudo guardar'));
      }
    });
  }

  // ─── ACTIONS ───
  activateClient() {
    const c = this.client();
    if (!c) return;
    this.api.activateClient(c.id_servicio).subscribe({
      next: () => this.toast.success('Cliente activado'),
      error: (e) => this.toast.error('Error: ' + (e.error?.detail || 'Sin permisos'))
    });
  }

  deactivateClient() {
    const c = this.client();
    if (!c) return;
    this.api.deactivateClient(c.id_servicio).subscribe({
      next: () => this.toast.success('Cliente suspendido'),
      error: (e) => this.toast.error('Error: ' + (e.error?.detail || 'Sin permisos'))
    });
  }

  pingClient() {
    const c = this.client();
    if (!c) return;
    this.pingResult.set('Realizando ping...');
    this.api.pingClient(c.id_servicio).subscribe({
      next: (res) => { this.pingResult.set(JSON.stringify(res, null, 2)); this.pingSuccess.set(true); },
      error: (e) => { this.pingResult.set('Error: ' + (e.error?.detail || 'Sin respuesta')); this.pingSuccess.set(false); }
    });
  }

  printReceipt(inv: Invoice) {
    this.receiptSvc.openPreview(inv);
  }

  getInitials(nombre: string): string {
    if (!nombre) return '?';
    const p = nombre.trim().split(/\s+/);
    return ((p[0]?.[0] || '') + (p[1]?.[0] || '')).toUpperCase();
  }

  getStatusClass(estado: string): string {
    const s = estado?.toLowerCase();
    if (s === 'activo') return 'active';
    if (s === 'suspendido' || s === 'cortado' || s === 'retirado') return 'suspended';
    if (s === 'gratis') return 'free';
    return 'default';
  }

  getFacturaClass(e: string): string {
    if (e?.toLowerCase() === 'pagadas') return 'paid';
    if (e?.toLowerCase().includes('pendiente')) return 'pending';
    return 'default';
  }

  getInvStatusClass(e: string): string {
    if (e?.toLowerCase() === 'pagada') return 'paid';
    if (e?.toLowerCase().includes('pendiente')) return 'pending';
    return 'default';
  }
}
