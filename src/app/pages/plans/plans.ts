import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { PlanResponse } from '../../models/plan.model';
import { DecimalPipe } from '@angular/common';

interface PlanWithStats {
  id: number;
  nombre: string;
  tipo: string;
  clientCount: number;
  price: string;
  pct: number;
}

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [NavbarComponent, DecimalPipe],
  template: `
    <app-navbar pageTitle="Planes de Internet" />

    <div class="page">
      <div class="toolbar">
        <h3>{{ plans().length }} planes configurados</h3>
        <button class="btn btn-outline" (click)="loadPlans()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
          Actualizar
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state"><div class="spinner"></div><p>Cargando planes...</p></div>
      } @else if (plans().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <h3>Sin planes</h3>
          <p>Carga los planes desde la API de WispHub</p>
        </div>
      } @else {
        <div class="plans-grid">
          @for (plan of plans(); track plan.id) {
            <div class="plan-card" [class.popular]="plan.clientCount > 20">
              @if (plan.clientCount > 20) {
                <div class="popular-badge">Popular</div>
              }
              <div class="plan-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </div>
              <h4>{{ plan.nombre }}</h4>
              @if (plan.price && plan.price !== '0.00') {
                <div class="plan-price">RD$ {{ plan.price }}<span>/mes</span></div>
              }
              <div class="plan-stats">
                <div class="plan-stat">
                  <span class="ps-value">{{ plan.clientCount }}</span>
                  <span class="ps-label">clientes</span>
                </div>
                <div class="plan-stat">
                  <span class="ps-value">{{ plan.pct | number:'1.1-1' }}%</span>
                  <span class="ps-label">del total</span>
                </div>
              </div>
              <div class="plan-bar">
                <div class="plan-bar-fill" [style.width.%]="plan.pct"></div>
              </div>
              <span class="plan-type">{{ plan.tipo }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    .toolbar h3 { margin: 0; color: #0f172a; }

    .btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }

    .plans-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }

    .plan-card {
      background: white; border: 1px solid #e2e8f0; border-radius: 16px;
      padding: 24px; text-align: center; transition: all 0.2s; position: relative;
    }
    .plan-card:hover { border-color: #6366f1; box-shadow: 0 8px 25px rgba(99,102,241,0.12); transform: translateY(-3px); }
    .plan-card.popular { border-color: #6366f1; }

    .popular-badge {
      position: absolute; top: -8px; right: 16px;
      background: #6366f1; color: white;
      font-size: 11px; font-weight: 600;
      padding: 2px 10px; border-radius: 10px;
    }

    .plan-icon {
      width: 56px; height: 56px; border-radius: 14px;
      background: linear-gradient(135deg, #eef2ff, #e0e7ff);
      color: #6366f1; display: flex; align-items: center; justify-content: center;
      margin: 0 auto 12px;
    }

    .plan-card h4 { margin: 0 0 8px; font-size: 16px; font-weight: 700; color: #0f172a; }

    .plan-price { font-size: 24px; font-weight: 800; color: #6366f1; margin-bottom: 12px; }
    .plan-price span { font-size: 13px; font-weight: 400; color: #94a3b8; }

    .plan-stats { display: flex; justify-content: center; gap: 24px; margin-bottom: 12px; }
    .plan-stat { display: flex; flex-direction: column; }
    .ps-value { font-size: 18px; font-weight: 700; color: #0f172a; }
    .ps-label { font-size: 11px; color: #94a3b8; }

    .plan-bar { height: 6px; background: #f1f5f9; border-radius: 3px; margin-bottom: 12px; overflow: hidden; }
    .plan-bar-fill { height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 3px; transition: width 0.5s; }

    .plan-type {
      display: inline-block; padding: 4px 12px; border-radius: 20px;
      font-size: 12px; font-weight: 600; background: #f1f5f9; color: #64748b;
    }

    .loading-state, .empty-state {
      display: flex; flex-direction: column; align-items: center; padding: 80px; gap: 12px; color: #94a3b8;
    }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }

    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class PlansComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);

  plans = signal<PlanWithStats[]>([]);
  loading = signal(false);

  async ngOnInit() {
    await this.loadPlans();
  }

  async loadPlans() {
    this.loading.set(true);
    const clients = await this.db.getClients();

    this.api.getPlans().subscribe({
      next: (res: PlanResponse) => {
        const apiPlans = res.results || [];

        // Cross-reference with clients
        const planMap = new Map<string, { count: number; price: string }>();
        clients.forEach(c => {
          const name = c.plan_internet?.nombre;
          if (!name) return;
          const entry = planMap.get(name) || { count: 0, price: c.precio_plan || '0.00' };
          entry.count++;
          if (parseFloat(c.precio_plan || '0') > parseFloat(entry.price || '0')) {
            entry.price = c.precio_plan;
          }
          planMap.set(name, entry);
        });

        const totalClients = clients.length || 1;
        const enriched: PlanWithStats[] = apiPlans.map(p => {
          const stats = planMap.get(p.nombre) || { count: 0, price: '0.00' };
          return {
            id: p.id,
            nombre: p.nombre,
            tipo: p.tipo || 'Simple Queue',
            clientCount: stats.count,
            price: stats.price,
            pct: (stats.count / totalClients) * 100
          };
        }).sort((a, b) => b.clientCount - a.clientCount);

        this.plans.set(enriched);
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }
}
