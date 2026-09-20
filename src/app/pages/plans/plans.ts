import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  LucideAlertTriangle, LucideBanknote, LucideCircleAlert, LucideRefreshCw, LucideSearch,
  LucideUsers, LucideZap,
} from '@lucide/angular';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { PlanResponse } from '../../models/plan.model';
import { WispHubClient } from '../../models/client.model';
import { DecimalPipe } from '@angular/common';
import { formatPlanName } from '../../pipes/plan-label.pipe';

interface PlanWithStats {
  id: number;
  nombre: string;
  tipo: string;
  clientCount: number;
  /** Precio que paga la mayoria de los clientes de este plan. */
  price: string;
  /** true cuando no todos pagan lo mismo por el mismo plan. */
  priceVaries: boolean;
  /** Suma real de lo que pagan los clientes de este plan al mes. */
  monthlyRevenue: number;
  pct: number;
}

type PlanSort = 'clients' | 'revenue' | 'price' | 'name';

@Component({
  selector: 'app-plans',
  standalone: true,
  imports: [
    NavbarComponent, DecimalPipe, FormsModule, RouterLink,
    LucideAlertTriangle, LucideBanknote, LucideCircleAlert, LucideRefreshCw, LucideSearch,
    LucideUsers, LucideZap,
  ],
  template: `
    <app-navbar pageTitle="Planes de internet" />

    <div class="page">
      @if (plans().length) {
        <section class="kpi-strip" aria-label="Resumen de planes">
          <article class="kpi-item revenue">
            <span class="kpi-icon"><svg lucideBanknote size="19"></svg></span>
            <div><small>Ingreso mensual</small><strong>RD$ {{ totalRevenue() | number:'1.2-2' }}</strong><p>lo que suman los planes de los clientes</p></div>
          </article>
          <article class="kpi-item assigned">
            <span class="kpi-icon"><svg lucideUsers size="19"></svg></span>
            <div><small>Clientes con plan</small><strong>{{ totalAssigned() }}</strong><p>en {{ plansInUse() }} de {{ plans().length }} planes</p></div>
          </article>
          <article class="kpi-item average">
            <span class="kpi-icon"><svg lucideZap size="19"></svg></span>
            <div><small>Promedio por cliente</small><strong>RD$ {{ averageTicket() | number:'1.2-2' }}</strong><p>{{ topPlanLabel() }}</p></div>
          </article>
          <article class="kpi-item attention">
            <span class="kpi-icon"><svg lucideCircleAlert size="19"></svg></span>
            <div><small>Requieren revisión</small><strong>{{ plansNeedingReview() }}</strong><p>sin clientes o con precios distintos</p></div>
          </article>
        </section>
      }

      <div class="toolbar">
        <div class="toolbar-title">
          <h3>{{ plans().length }} {{ plans().length === 1 ? 'plan configurado' : 'planes configurados' }}</h3>
          @if (plans().length) {
            <p>{{ plansInUse() }} con clientes · {{ totalAssigned() }} clientes asignados</p>
          }
        </div>
        <div class="toolbar-actions">
          @if (plans().length > 1) {
            <select class="plain-select" aria-label="Ordenar planes" [ngModel]="sortBy()" (ngModelChange)="sortBy.set($event)">
              <option value="clients">Más clientes</option>
              <option value="revenue">Mayor ingreso</option>
              <option value="price">Precio más alto</option>
              <option value="name">Nombre</option>
            </select>
          }
          @if (plans().length > 6) {
            <label class="search-field">
              <svg lucideSearch size="16"></svg>
              <input type="search" placeholder="Buscar plan o velocidad" aria-label="Buscar plan" [ngModel]="search()" (ngModelChange)="search.set($event)" />
            </label>
          }
          <button type="button" class="btn btn-outline" (click)="loadPlans()" [disabled]="loading()" [title]="loading() ? 'Cargando planes…' : 'Volver a consultar los planes en WispHub'">
            <svg lucideRefreshCw size="16" [class.spin]="loading()"></svg>
            {{ loading() ? 'Actualizando…' : 'Actualizar' }}
          </button>
        </div>
      </div>

      @if (loading() && plans().length === 0) {
        <div class="loading-state"><div class="spinner"></div><p>Cargando planes…</p></div>
      } @else if (loadError()) {
        <div class="empty-state error-state" role="alert">
          <svg lucideAlertTriangle size="40"></svg>
          <h3>No se pudieron cargar los planes</h3>
          <p>{{ loadError() }}</p>
          <button type="button" class="btn btn-primary" (click)="loadPlans()">Reintentar</button>
        </div>
      } @else if (plans().length === 0) {
        <div class="empty-state">
          <svg lucideZap size="48"></svg>
          <h3>No hay planes registrados</h3>
          <p>WispHub no devolvió planes. Créalos en WispHub y presiona «Actualizar».</p>
        </div>
      } @else if (visiblePlans().length === 0) {
        <div class="empty-state">
          <h3>No hay coincidencias</h3>
          <p>Ningún plan coincide con «{{ search() }}».</p>
          <button type="button" class="btn btn-outline" (click)="search.set('')">Limpiar búsqueda</button>
        </div>
      } @else {
        <div class="plans-grid">
          @for (plan of visiblePlans(); track plan.id) {
            <article class="plan-card" [class.popular]="plan.id === mostUsedPlanId()" [class.unused]="plan.clientCount === 0">
              @if (plan.id === mostUsedPlanId()) {
                <div class="popular-badge">El más usado</div>
              }
              <div class="plan-icon"><svg lucideZap size="24"></svg></div>
              <h4 [title]="plan.nombre">{{ planLabel(plan.nombre) }}</h4>
              @if (planLabel(plan.nombre) !== plan.nombre) {
                <p class="plan-raw" title="Nombre en WispHub">{{ plan.nombre }}</p>
              }
              @if (hasPrice(plan.price)) {
                <div class="plan-price">{{ priceText(plan.price) }}<span>/mes</span></div>
                @if (plan.priceVaries) {
                  <p class="plan-note" title="Hay clientes con este plan pagando montos distintos">Hay clientes pagando otro monto</p>
                }
              } @else {
                <div class="plan-price no-price">Sin precio registrado</div>
              }
              <div class="plan-stats">
                <div class="plan-stat">
                  <span class="ps-value">{{ plan.clientCount }}</span>
                  <span class="ps-label">{{ plan.clientCount === 1 ? 'cliente' : 'clientes' }}</span>
                </div>
                <div class="plan-stat">
                  <span class="ps-value">{{ plan.pct | number:'1.1-1' }}%</span>
                  <span class="ps-label">del total</span>
                </div>
              </div>
              <div class="plan-bar" role="presentation">
                <div class="plan-bar-fill" [style.width.%]="plan.pct"></div>
              </div>
              @if (plan.monthlyRevenue > 0) {
                <p class="plan-revenue">Genera <strong>RD$ {{ plan.monthlyRevenue | number:'1.2-2' }}</strong> al mes</p>
              } @else {
                <p class="plan-revenue empty">Nadie lo está usando</p>
              }
              <div class="plan-foot">
                <span class="plan-type">{{ typeLabel(plan.tipo) }}</span>
                @if (plan.clientCount) {
                  <a class="plan-link" [routerLink]="['/clients']" [queryParams]="{ plan: plan.nombre }" [title]="'Ver los ' + plan.clientCount + ' clientes de este plan'">Ver clientes</a>
                }
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 32px; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
    .toolbar-title h3 { margin: 0; color: #172535; font-size: 16px; }
    .toolbar-title p { margin: 3px 0 0; color: #667582; font-size: 12px; }
    .toolbar-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .search-field { display: flex; align-items: center; gap: 8px; min-width: 240px; height: 38px; padding: 0 11px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #667582; }
    .search-field:focus-within { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .search-field input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: #334250; font: inherit; font-size: 13px; }

    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 38px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s, color 0.15s; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-outline { background: #fff; border-color: #dfe5ea; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; background: #f2f7ff; }
    .btn-primary { background: #1267dd; color: #fff; }
    .btn-primary:hover { background: #0d58c0; }
    .spin { animation: spin 0.9s linear infinite; }

    .plans-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(240px, 100%), 1fr)); gap: 14px; }

    .plan-card {
      position: relative; min-width: 0; padding: 20px 18px; text-align: center;
      background: #fff; border: 1px solid #dfe5ea; border-radius: 8px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .plan-card:hover { border-color: #b9d2f5; box-shadow: 0 6px 18px rgba(18, 103, 221, 0.08); }
    .plan-card.popular { border-color: #1267dd; }
    .plan-card.unused { background: #fbfcfd; }

    .popular-badge {
      position: absolute; top: -9px; right: 14px; padding: 2px 10px; border-radius: 10px;
      background: #1267dd; color: #fff; font-size: 11px; font-weight: 700;
    }

    .plan-icon {
      display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0 auto 10px;
      border-radius: 8px; background: #edf4ff; color: #1267dd;
    }
    .plan-card.unused .plan-icon { background: #f1f4f6; color: #667582; }

    .plan-card h4 { margin: 0; color: #172535; font-size: 17px; font-weight: 700; overflow-wrap: anywhere; }
    .plan-raw { margin: 3px 0 0; color: #667582; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-size: 11px; overflow-wrap: anywhere; }

    .plan-price { margin: 10px 0 12px; color: #1267dd; font-size: 22px; font-weight: 800; }
    .plan-price span { color: #667582; font-size: 13px; font-weight: 500; }
    .plan-price.no-price { color: #667582; font-size: 12px; font-weight: 600; }

    .plan-stats { display: flex; justify-content: center; gap: 24px; margin-bottom: 12px; }
    .plan-stat { display: flex; flex-direction: column; }
    .ps-value { color: #172535; font-size: 18px; font-weight: 700; }
    .ps-label { color: #667582; font-size: 11px; }

    .plan-bar { height: 6px; margin-bottom: 12px; overflow: hidden; border-radius: 3px; background: #edf1f4; }
    .plan-bar-fill { height: 100%; border-radius: 3px; background: #1267dd; transition: width 0.4s; }

    .plan-note { margin: -6px 0 10px; color: #9a5b0f; font-size: 11px; font-weight: 600; }
    .plan-revenue { margin: 0 0 12px; color: #334250; font-size: 12px; }
    .plan-revenue strong { color: #13875a; font-weight: 800; }
    .plan-revenue.empty { color: #8a98a5; font-style: italic; }
    .plan-foot { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; }
    .plan-type { display: inline-block; padding: 3px 10px; border-radius: 12px; background: #f1f4f6; color: #667582; font-size: 11px; font-weight: 600; }
    .plan-link { color: #1267dd; font-size: 12px; font-weight: 700; text-decoration: none; }
    .plan-link:hover { text-decoration: underline; }
    .plain-select { height: 38px; min-width: 160px; padding: 0 10px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #334250; font: inherit; font-size: 12px; cursor: pointer; }
    .plain-select:focus-visible { outline: 2px solid #1267dd; outline-offset: 2px; }

    .kpi-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; overflow: hidden; margin-bottom: 16px; border: 1px solid #dfe5ea; border-radius: 8px; background: #dfe5ea; }
    .kpi-item { display: flex; align-items: flex-start; gap: 12px; min-width: 0; padding: 16px 18px; background: #fff; text-align: left; }
    .kpi-icon { display: grid; place-items: center; width: 36px; height: 36px; flex: 0 0 auto; border-radius: 7px; }
    .kpi-item > div { min-width: 0; }
    .kpi-item small { display: block; color: #728294; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .kpi-item strong { display: block; margin-top: 3px; color: #14283d; font-size: 20px; line-height: 1.2; overflow-wrap: anywhere; }
    .kpi-item p { margin: 5px 0 0; color: #8291a0; font-size: 11px; }
    .revenue .kpi-icon { color: #13875a; background: #e9f8f1; }
    .assigned .kpi-icon { color: #1267dd; background: #edf4ff; }
    .average .kpi-icon { color: #b36b12; background: #fff6e8; }
    .attention .kpi-icon { color: #c93643; background: #fff0f1; }

    .loading-state, .empty-state { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 64px 20px; color: #667582; text-align: center; }
    .empty-state svg { color: #ccd6de; }
    .empty-state h3 { margin: 6px 0 0; color: #334250; font-size: 16px; }
    .empty-state p { margin: 0; font-size: 13px; }
    .error-state { border: 1px solid #f3c7c3; border-radius: 8px; background: #fff0ef; }
    .error-state svg { color: #b42318; }

    .spinner { width: 32px; height: 32px; border: 3px solid #dfe5ea; border-top-color: #1267dd; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 1120px) { .kpi-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 640px) {
      .page { padding: 14px 16px 24px; }
      .toolbar-actions, .search-field { width: 100%; min-width: 0; }
      .toolbar-actions .btn, .toolbar-actions .plain-select { width: 100%; }
      .kpi-item { display: block; }
      .kpi-icon { margin-bottom: 8px; }
      .kpi-item strong { font-size: 16px; }
    }
    @media (prefers-reduced-motion: reduce) { .spin, .spinner { animation: none; } }
  `]
})
export class PlansComponent implements OnInit {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);

  plans = signal<PlanWithStats[]>([]);
  loading = signal(false);
  loadError = signal('');
  search = signal('');

  sortBy = signal<PlanSort>('clients');

  visiblePlans = computed(() => {
    const term = this.search().trim().toLowerCase();
    const mode = this.sortBy();
    const filtered = !term ? this.plans() : this.plans().filter((plan) =>
      plan.nombre.toLowerCase().includes(term) || formatPlanName(plan.nombre).toLowerCase().includes(term));
    return [...filtered].sort((left, right) => {
      if (mode === 'revenue') return right.monthlyRevenue - left.monthlyRevenue;
      if (mode === 'price') return Number.parseFloat(right.price || '0') - Number.parseFloat(left.price || '0');
      if (mode === 'name') return formatPlanName(left.nombre).localeCompare(formatPlanName(right.nombre), 'es', { numeric: true });
      return right.clientCount - left.clientCount || right.monthlyRevenue - left.monthlyRevenue;
    });
  });
  plansInUse = computed(() => this.plans().filter((plan) => plan.clientCount > 0).length);
  totalAssigned = computed(() => this.plans().reduce((sum, plan) => sum + plan.clientCount, 0));
  totalRevenue = computed(() => this.plans().reduce((sum, plan) => sum + plan.monthlyRevenue, 0));
  averageTicket = computed(() => {
    const clients = this.totalAssigned();
    return clients ? this.totalRevenue() / clients : 0;
  });
  /** Planes que conviene revisar: sin nadie usandolos, o con clientes pagando montos distintos. */
  plansNeedingReview = computed(() =>
    this.plans().filter((plan) => plan.clientCount === 0 || plan.priceVaries).length);

  /** Id del plan con mas clientes; solo ese lleva la etiqueta destacada. */
  mostUsedPlanId = computed(() => {
    const top = [...this.plans()].sort((left, right) => right.clientCount - left.clientCount)[0];
    return top && top.clientCount > 0 ? top.id : -1;
  });

  topPlanLabel = computed(() => {
    const top = [...this.plans()].sort((left, right) => right.monthlyRevenue - left.monthlyRevenue)[0];
    if (!top || top.monthlyRevenue <= 0) return 'sin ingresos registrados';
    return `el que más aporta: ${formatPlanName(top.nombre)}`;
  });

  async ngOnInit() {
    await this.loadPlans();
  }

  async loadPlans() {
    this.loading.set(true);
    this.loadError.set('');
    let clients: WispHubClient[];
    try {
      clients = await this.db.getClients();
    } catch {
      this.loadError.set('No fue posible leer los clientes guardados. Revisa la conexión y vuelve a intentarlo.');
      this.loading.set(false);
      return;
    }

    this.api.getPlans().subscribe({
      next: (res: PlanResponse) => {
        const apiPlans = res.results || [];

        // Se cruza con los clientes guardados para saber cuantos usan cada plan,
        // cuanto paga la mayoria y cuanto entra al mes de verdad. Antes se tomaba
        // el precio mas alto encontrado, que no era lo que cobra el negocio.
        const planMap = new Map<string, { count: number; revenue: number; prices: Map<string, number> }>();
        clients.forEach(c => {
          const name = c.plan_internet?.nombre;
          if (!name) return;
          const entry = planMap.get(name) || { count: 0, revenue: 0, prices: new Map<string, number>() };
          const amount = Number.parseFloat(String(c.precio_plan || '0').replace(/[^0-9.-]/g, '')) || 0;
          entry.count++;
          entry.revenue += amount;
          const key = amount.toFixed(2);
          entry.prices.set(key, (entry.prices.get(key) || 0) + 1);
          planMap.set(name, entry);
        });

        const totalClients = clients.length || 1;
        const enriched: PlanWithStats[] = apiPlans.map(p => {
          const stats = planMap.get(p.nombre);
          if (!stats) {
            return { id: p.id, nombre: p.nombre, tipo: p.tipo || 'Simple Queue', clientCount: 0, price: '0.00', priceVaries: false, monthlyRevenue: 0, pct: 0 };
          }
          // Precio tipico = el que paga la mayoria de los clientes de ese plan.
          const [commonPrice] = [...stats.prices.entries()].sort((a, b) => b[1] - a[1])[0] || ['0.00'];
          return {
            id: p.id,
            nombre: p.nombre,
            tipo: p.tipo || 'Simple Queue',
            clientCount: stats.count,
            price: commonPrice,
            priceVaries: stats.prices.size > 1,
            monthlyRevenue: stats.revenue,
            pct: (stats.count / totalClients) * 100,
          };
        });

        this.plans.set(enriched);
        this.loading.set(false);
      },
      error: () => {
        this.loadError.set('WispHub no respondió al consultar los planes. Verifica la conexión y vuelve a intentarlo.');
        this.loading.set(false);
      }
    });
  }

  planLabel(name: string): string {
    return formatPlanName(name);
  }

  hasPrice(price: string): boolean {
    return Number.parseFloat(price || '0') > 0;
  }

  priceText(price: string): string {
    const value = Number.parseFloat(String(price || '0').replace(/[^0-9.-]/g, '')) || 0;
    return `RD$ ${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /** Tipo de control del plan en lenguaje del operador (solo texto visible). */
  typeLabel(tipo: string): string {
    const value = String(tipo || '').toLowerCase();
    if (!value) return 'Tipo no indicado';
    if (value.includes('queue')) return 'Control por velocidad';
    if (value.includes('pppoe')) return 'Conexión PPPoE';
    if (value.includes('hotspot')) return 'Hotspot';
    if (value.includes('pcq')) return 'Velocidad compartida';
    return tipo;
  }
}
