import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { ExportService } from '../../services/export.service';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe } from '@angular/common';

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [NavbarComponent, DecimalPipe],
  template: `
    <app-navbar pageTitle="Reportes" />

    <div class="page">
      <!-- REVENUE SUMMARY -->
      <div class="section-title">Resumen de Ingresos</div>
      <div class="stats-row">
        <div class="stat-box">
          <span class="stat-lbl">Ingreso Mensual Estimado</span>
          <span class="stat-val big">RD$ {{ monthlyRevenue() | number:'1.2-2' }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-lbl">Precio Promedio</span>
          <span class="stat-val">RD$ {{ avgPrice() | number:'1.2-2' }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-lbl">Precio Minimo</span>
          <span class="stat-val">RD$ {{ minPrice() | number:'1.2-2' }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-lbl">Precio Maximo</span>
          <span class="stat-val">RD$ {{ maxPrice() | number:'1.2-2' }}</span>
        </div>
      </div>

      <!-- CLIENT BREAKDOWN -->
      <div class="section-title">Clientes por Estado</div>
      <div class="breakdown-grid">
        @for (item of clientsByStatus(); track item.status) {
          <div class="breakdown-card" [style.border-left-color]="item.color">
            <span class="bd-count">{{ item.count }}</span>
            <span class="bd-label">{{ item.status }}</span>
            <span class="bd-pct">{{ item.pct | number:'1.1-1' }}%</span>
          </div>
        }
      </div>

      <!-- PLANS REPORT -->
      <div class="report-grid">
        <div class="card">
          <div class="card-header">
            <h3>Clientes por Plan de Internet</h3>
            <button class="btn-sm" (click)="exportPlansReport()">Exportar CSV</button>
          </div>
          <div class="card-body">
            <table class="report-table">
              <thead><tr><th>Plan</th><th>Clientes</th><th>%</th><th>Ingreso Mensual</th></tr></thead>
              <tbody>
                @for (p of planReport(); track p.plan) {
                  <tr>
                    <td class="bold">{{ p.plan }}</td>
                    <td>{{ p.count }}</td>
                    <td>{{ p.pct | number:'1.1-1' }}%</td>
                    <td class="money">RD$ {{ p.revenue | number:'1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3>Cobranza por Forma de Pago</h3>
          </div>
          <div class="card-body">
            <table class="report-table">
              <thead><tr><th>Forma de Pago</th><th>Facturas</th><th>Total Cobrado</th></tr></thead>
              <tbody>
                @for (fp of paymentReport(); track fp.name) {
                  <tr>
                    <td class="bold">{{ fp.name }}</td>
                    <td>{{ fp.count }}</td>
                    <td class="money">RD$ {{ fp.total | number:'1.2-2' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- MOROSOS -->
      <div class="card morosos-card">
        <div class="card-header">
          <h3>Clientes con Pago Pendiente ({{ morosos().length }})</h3>
          <button class="btn-sm" (click)="exportMorosos()">Exportar CSV</button>
        </div>
        <div class="card-body">
          @if (morosos().length === 0) {
            <div class="empty-msg">Todos los clientes estan al dia</div>
          } @else {
            <table class="report-table">
              <thead><tr><th>Cliente</th><th>Telefono</th><th>Plan</th><th>Precio</th><th>Fecha Corte</th><th>IP</th></tr></thead>
              <tbody>
                @for (c of morosos(); track c.id_servicio) {
                  <tr>
                    <td class="bold">{{ c.nombre }}</td>
                    <td class="mono">{{ c.telefono || '-' }}</td>
                    <td>{{ c.plan_internet?.nombre || '-' }}</td>
                    <td class="money">RD$ {{ c.precio_plan }}</td>
                    <td>{{ c.fecha_corte }}</td>
                    <td class="mono">{{ c.ip }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>

      <!-- GRATIS -->
      @if (gratisClients().length > 0) {
        <div class="card">
          <div class="card-header">
            <h3>Clientes Gratis ({{ gratisClients().length }})</h3>
          </div>
          <div class="card-body">
            <table class="report-table">
              <thead><tr><th>Cliente</th><th>Telefono</th><th>Plan</th><th>IP</th><th>Fecha Instalacion</th></tr></thead>
              <tbody>
                @for (c of gratisClients(); track c.id_servicio) {
                  <tr>
                    <td class="bold">{{ c.nombre }}</td>
                    <td class="mono">{{ c.telefono || '-' }}</td>
                    <td>{{ c.plan_internet?.nombre || '-' }}</td>
                    <td class="mono">{{ c.ip }}</td>
                    <td>{{ c.fecha_instalacion }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .section-title { font-size: 16px; font-weight: 700; color: #0f172a; margin: 24px 0 12px; }
    .section-title:first-child { margin-top: 0; }

    .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 8px; }
    .stat-box { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; }
    .stat-lbl { display: block; font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }
    .stat-val { font-size: 20px; font-weight: 800; color: #0f172a; }
    .stat-val.big { font-size: 28px; color: #6366f1; }

    .breakdown-grid { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .breakdown-card {
      flex: 1; min-width: 120px; background: white; border: 1px solid #e2e8f0;
      border-left: 4px solid; border-radius: 10px; padding: 14px 16px; text-align: center;
    }
    .bd-count { display: block; font-size: 28px; font-weight: 800; color: #0f172a; }
    .bd-label { display: block; font-size: 13px; color: #64748b; }
    .bd-pct { display: block; font-size: 12px; color: #94a3b8; margin-top: 2px; }

    .report-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }

    .card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow: hidden; margin-bottom: 16px; }
    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #f1f5f9;
    }
    .card-header h3 { font-size: 15px; font-weight: 600; color: #0f172a; margin: 0; }
    .card-body { padding: 0; overflow-x: auto; }

    .btn-sm {
      padding: 6px 14px; border: 1px solid #e2e8f0; border-radius: 8px;
      background: white; font-size: 12px; color: #6366f1; font-weight: 500;
      cursor: pointer; transition: all 0.2s;
    }
    .btn-sm:hover { background: #6366f1; color: white; border-color: #6366f1; }

    .report-table { width: 100%; border-collapse: collapse; }
    .report-table th {
      text-align: left; font-size: 11px; font-weight: 600; color: #64748b;
      text-transform: uppercase; padding: 10px 16px; background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
    }
    .report-table td { padding: 10px 16px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .report-table tr:hover td { background: #fafbfc; }
    .bold { font-weight: 600; color: #0f172a; }
    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .money { font-family: 'Courier New', monospace; font-weight: 600; }

    .empty-msg { padding: 30px; text-align: center; color: #94a3b8; }

    @media (max-width: 900px) {
      .stats-row { grid-template-columns: repeat(2, 1fr); }
      .report-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class ReportsComponent implements OnInit {
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);

  monthlyRevenue = signal(0);
  avgPrice = signal(0);
  minPrice = signal(0);
  maxPrice = signal(0);
  clientsByStatus = signal<{ status: string; count: number; pct: number; color: string }[]>([]);
  planReport = signal<{ plan: string; count: number; pct: number; revenue: number }[]>([]);
  paymentReport = signal<{ name: string; count: number; total: number }[]>([]);
  morosos = signal<WispHubClient[]>([]);
  gratisClients = signal<WispHubClient[]>([]);

  private clients: WispHubClient[] = [];

  async ngOnInit() {
    const clients = await this.db.getClients();
    const invoices = await this.db.getInvoices();
    this.clients = clients;
    this.computeAll(clients, invoices);
  }

  computeAll(clients: WispHubClient[], invoices: Invoice[]) {
    const prices = clients.map(c => parseFloat(c.precio_plan || '0'));
    const activePrices = prices.filter(p => p > 0);

    this.monthlyRevenue.set(prices.reduce((a, b) => a + b, 0));
    this.avgPrice.set(activePrices.length ? activePrices.reduce((a, b) => a + b, 0) / activePrices.length : 0);
    this.minPrice.set(activePrices.length ? Math.min(...activePrices) : 0);
    this.maxPrice.set(activePrices.length ? Math.max(...activePrices) : 0);

    // By status
    const statusColors: Record<string, string> = { Activo: '#22c55e', Suspendido: '#ef4444', Cortado: '#dc2626', Gratis: '#3b82f6', Retirado: '#94a3b8' };
    const statusMap = new Map<string, number>();
    clients.forEach(c => statusMap.set(c.estado, (statusMap.get(c.estado) || 0) + 1));
    this.clientsByStatus.set([...statusMap.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({
      status, count, pct: (count / clients.length) * 100, color: statusColors[status] || '#94a3b8'
    })));

    // By plan
    const planMap = new Map<string, { count: number; revenue: number }>();
    clients.forEach(c => {
      const name = c.plan_internet?.nombre || 'Sin plan';
      const entry = planMap.get(name) || { count: 0, revenue: 0 };
      entry.count++;
      entry.revenue += parseFloat(c.precio_plan || '0');
      planMap.set(name, entry);
    });
    this.planReport.set([...planMap.entries()].sort((a, b) => b[1].count - a[1].count).map(([plan, d]) => ({
      plan, count: d.count, pct: (d.count / clients.length) * 100, revenue: d.revenue
    })));

    // Payment methods
    const fpMap = new Map<string, { count: number; total: number }>();
    invoices.filter(i => i.estado?.toLowerCase() === 'pagada').forEach(i => {
      const name = i.forma_pago?.nombre || 'Sin definir';
      const entry = fpMap.get(name) || { count: 0, total: 0 };
      entry.count++;
      entry.total += i.total_cobrado || 0;
      fpMap.set(name, entry);
    });
    this.paymentReport.set([...fpMap.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, d]) => ({
      name, count: d.count, total: d.total
    })));

    // Morosos
    this.morosos.set(clients.filter(c => c.estado_facturas?.toLowerCase().includes('pendiente') && c.estado?.toLowerCase() === 'activo'));
    this.gratisClients.set(clients.filter(c => c.estado?.toLowerCase() === 'gratis'));
  }

  exportPlansReport() {
    this.exportSvc.exportCSV(this.planReport(), 'reporte_planes', [
      { key: 'plan', label: 'Plan' },
      { key: 'count', label: 'Clientes' },
      { key: 'pct', label: '% del Total' },
      { key: 'revenue', label: 'Ingreso Mensual' },
    ]);
  }

  exportMorosos() {
    this.exportSvc.exportCSV(this.morosos(), 'morosos', [
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Telefono' },
      { key: 'plan_internet.nombre', label: 'Plan' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'fecha_corte', label: 'Fecha Corte' },
      { key: 'ip', label: 'IP' },
    ]);
  }
}
