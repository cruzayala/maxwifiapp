import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { WisphubService } from '../../services/wisphub.service';
import { ToastService } from '../../services/toast.service';
import { SyncService } from '../../services/sync.service';
import { PlanResponse, InternetPlan, Zone, ZoneResponse } from '../../models/plan.model';

@Component({
  selector: 'app-new-client',
  standalone: true,
  imports: [NavbarComponent, FormsModule, RouterLink],
  template: `
    <app-navbar pageTitle="Nuevo Cliente" />

    <div class="page">
      <a routerLink="/clients" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
        Volver a clientes
      </a>

      <div class="form-wrap">
        <div class="card">
          <h3>Datos del Servicio</h3>
          <p class="help">Estos son los campos requeridos por WispHub</p>

          <div class="form-row">
            <div class="form-group">
              <label>Zona *</label>
              <select [(ngModel)]="zonaId" class="form-input">
                <option [ngValue]="0">Seleccionar zona...</option>
                @for (z of zones(); track z.id) {
                  <option [ngValue]="z.id">{{ z.nombre }}</option>
                }
              </select>
            </div>
            <div class="form-group">
              <label>Plan de Internet *</label>
              <select [(ngModel)]="planId" class="form-input">
                <option [ngValue]="0">Seleccionar plan...</option>
                @for (p of plans(); track p.id) {
                  <option [ngValue]="p.id">{{ p.nombre }}</option>
                }
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Usuario / Nombre del servicio *</label>
              <input type="text" [(ngModel)]="usuarioRb" class="form-input" placeholder="Juan Perez" />
              <span class="hint">Este es el nombre que apareceria en WispHub</span>
            </div>
            <div class="form-group">
              <label>Direccion IP *</label>
              <input type="text" [(ngModel)]="ip" class="form-input mono" placeholder="192.168.16.100" />
              <span class="hint">IP que se asignara al cliente</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>Datos Personales (opcional)</h3>
          <p class="help">Se agregan despues de crear el cliente</p>

          <div class="form-row">
            <div class="form-group">
              <label>Telefono</label>
              <input type="text" [(ngModel)]="telefono" class="form-input" placeholder="809-123-4567" />
            </div>
            <div class="form-group">
              <label>Cedula</label>
              <input type="text" [(ngModel)]="cedula" class="form-input" placeholder="001-0000000-0" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Email</label>
              <input type="email" [(ngModel)]="email" class="form-input" placeholder="cliente@email.com" />
            </div>
            <div class="form-group">
              <label>Ciudad</label>
              <input type="text" [(ngModel)]="ciudad" class="form-input" placeholder="Santo Domingo" />
            </div>
          </div>

          <div class="form-group">
            <label>Direccion</label>
            <input type="text" [(ngModel)]="direccion" class="form-input" placeholder="Calle, numero, sector" />
          </div>
        </div>

        <div class="actions-bar">
          <button class="btn btn-outline" routerLink="/clients">Cancelar</button>
          <button class="btn btn-primary" (click)="create()" [disabled]="saving() || !canSubmit()">
            @if (saving()) {
              <div class="btn-spinner"></div>
              <span>Creando cliente en WispHub...</span>
            } @else {
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              <span>Crear Cliente</span>
            }
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }
    .back-link { display: inline-flex; align-items: center; gap: 6px; color: #6366f1; text-decoration: none; font-size: 14px; font-weight: 500; margin-bottom: 20px; }
    .back-link:hover { text-decoration: underline; }

    .form-wrap { max-width: 820px; }

    .card {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 24px; margin-bottom: 16px;
    }
    .card h3 { margin: 0 0 4px; font-size: 16px; font-weight: 600; color: #0f172a; }
    .help { margin: 0 0 20px; font-size: 13px; color: #94a3b8; }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; }
    .form-input {
      width: 100%; padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 14px; color: #334155; outline: none; box-sizing: border-box; transition: border 0.2s;
    }
    .form-input.mono { font-family: 'Courier New', monospace; }
    .form-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.1); }
    .hint { display: block; font-size: 11px; color: #94a3b8; margin-top: 4px; }

    .actions-bar {
      position: sticky; bottom: 0;
      display: flex; justify-content: flex-end; gap: 10px;
      background: white; padding: 16px; border-radius: 14px; border: 1px solid #e2e8f0;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.04);
    }
    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 12px 24px; border-radius: 10px; font-size: 14px; font-weight: 600;
      cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; text-decoration: none; }
    .btn-outline:hover { background: #f1f5f9; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

    .btn-spinner {
      width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3);
      border-top-color: white; border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      .form-row { grid-template-columns: 1fr; }
      .actions-bar { flex-direction: column; }
      .actions-bar .btn { width: 100%; justify-content: center; }
    }
  `]
})
export class NewClientComponent implements OnInit {
  private api = inject(WisphubService);
  private toast = inject(ToastService);
  private syncSvc = inject(SyncService);
  private router = inject(Router);

  plans = signal<InternetPlan[]>([]);
  zones = signal<Zone[]>([]);

  // Campos servicio (requeridos)
  zonaId = 0;
  planId = 0;
  usuarioRb = '';
  ip = '';

  // Campos personales (opcional)
  telefono = '';
  cedula = '';
  email = '';
  ciudad = '';
  direccion = '';

  saving = signal(false);

  ngOnInit() {
    this.api.getPlans().subscribe({
      next: (res: PlanResponse) => this.plans.set(res.results || [])
    });
    this.api.getZones().subscribe({
      next: (res: ZoneResponse) => {
        this.zones.set(res.results || []);
        if (res.results?.length === 1) this.zonaId = res.results[0].id;
      }
    });
  }

  canSubmit(): boolean {
    return !!(this.zonaId && this.planId && this.usuarioRb && this.ip);
  }

  create() {
    if (!this.canSubmit()) {
      this.toast.error('Complete los campos requeridos');
      return;
    }

    this.saving.set(true);
    this.api.addClient(this.zonaId, {
      ip: this.ip,
      usuario_rb: this.usuarioRb,
      plan_internet: this.planId
    }).subscribe({
      next: (res) => {
        const taskId = res.task_id;
        this.toast.info('Creando cliente en WispHub...');
        this.pollCreation(taskId);
      },
      error: (e) => {
        this.saving.set(false);
        const err = e.error?.ip?.[0] || e.error?.usuario_rb?.[0] || e.error?.plan_internet?.[0] || JSON.stringify(e.error);
        this.toast.error('Error: ' + err);
      }
    });
  }

  private pollCreation(taskId: string) {
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (attempts > 20) {
        clearInterval(check);
        this.saving.set(false);
        this.toast.error('Timeout - verifica en WispHub');
        return;
      }

      this.api.getTaskStatus(taskId).subscribe({
        next: (res: any) => {
          if (res.task?.status === 'SUCCESS') {
            clearInterval(check);
            const result = res.task.result;
            if (result.agregar) {
              this.toast.success('Cliente creado exitosamente!');
              // Si hay datos personales, actualizarlos
              if (this.hasProfileData()) {
                this.updateProfileAfterCreate();
              } else {
                this.finishAndRedirect();
              }
            } else {
              this.saving.set(false);
              this.toast.error('Error: ' + (result.errores || 'No se pudo crear'));
            }
          } else if (res.task?.status === 'FAILURE') {
            clearInterval(check);
            this.saving.set(false);
            this.toast.error('Error al crear cliente');
          }
        }
      });
    }, 2000);
  }

  private hasProfileData(): boolean {
    return !!(this.telefono || this.cedula || this.email || this.direccion || this.ciudad);
  }

  private async updateProfileAfterCreate() {
    // Refresh to find the newly created client
    this.api.getAllClients().subscribe({
      next: (clients) => {
        const newClient = clients.find((c: any) => c.ip === this.ip);
        if (newClient && this.hasProfileData()) {
          const parts = this.usuarioRb.trim().split(/\s+/);
          this.api.updateProfile(newClient.id_servicio, {
            nombre: parts[0] || this.usuarioRb,
            apellidos: parts.slice(1).join(' ') || '-',
            telefono: this.telefono || '0000000000',
            cedula: this.cedula || '-',
            email: this.email || 'na@na.com',
            direccion: this.direccion || '-',
            localidad: this.ciudad || '-',
            ciudad: this.ciudad || '-',
          }).subscribe({
            next: () => this.finishAndRedirect(),
            error: () => this.finishAndRedirect() // La API da 500 pero guarda
          });
        } else {
          this.finishAndRedirect();
        }
      },
      error: () => this.finishAndRedirect()
    });
  }

  private finishAndRedirect() {
    this.saving.set(false);
    this.syncSvc.syncAll(); // Re-sync to update local cache
    this.router.navigate(['/clients']);
  }
}
