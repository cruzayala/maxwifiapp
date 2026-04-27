import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { LocalDbService } from '../../services/local-db.service';
import { ExportService } from '../../services/export.service';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

interface MorosoInfo {
  client: WispHubClient;
  facturasPendientes: number;
  montoTotal: number;
  diasVencido: number;
  ultimaFactura: string;
  riesgo: 'alto' | 'medio' | 'bajo';
}

@Component({
  selector: 'app-morosos',
  standalone: true,
  imports: [NavbarComponent, DecimalPipe, UpperCasePipe, RouterLink, FormsModule],
  template: `
    <app-navbar pageTitle="Cobranza & Morosos" />

    <div class="page">
      <!-- KPI CARDS -->
      <div class="kpi-grid">
        <div class="kpi-card red">
          <span class="kpi-value">{{ totalMorosos() }}</span>
          <span class="kpi-label">Clientes Morosos</span>
        </div>
        <div class="kpi-card orange">
          <span class="kpi-value">RD$ {{ montoTotalPendiente() | number:'1.2-2' }}</span>
          <span class="kpi-label">Monto Pendiente</span>
        </div>
        <div class="kpi-card blue">
          <span class="kpi-value">{{ tasaCobro() | number:'1.1-1' }}%</span>
          <span class="kpi-label">Tasa de Cobro</span>
        </div>
        <div class="kpi-card purple">
          <span class="kpi-value">{{ promedioVencido() | number:'1.0-0' }}</span>
          <span class="kpi-label">Dias Promedio Vencido</span>
        </div>
      </div>

      <!-- RISK BREAKDOWN -->
      <div class="risk-row">
        <div class="risk-card high" (click)="filterByRisk('alto')">
          <span class="risk-count">{{ riesgoAlto() }}</span>
          <span class="risk-label">Riesgo Alto</span>
          <span class="risk-desc">> 15 dias vencido</span>
        </div>
        <div class="risk-card medium" (click)="filterByRisk('medio')">
          <span class="risk-count">{{ riesgoMedio() }}</span>
          <span class="risk-label">Riesgo Medio</span>
          <span class="risk-desc">5-15 dias vencido</span>
        </div>
        <div class="risk-card low" (click)="filterByRisk('bajo')">
          <span class="risk-count">{{ riesgoBajo() }}</span>
          <span class="risk-label">Riesgo Bajo</span>
          <span class="risk-desc">0-5 dias vencido</span>
        </div>
      </div>

      <!-- TOOLBAR -->
      <div class="toolbar">
        <div class="toolbar-left">
          <input type="text" placeholder="Buscar moroso..." [(ngModel)]="searchTerm" (input)="filter()" class="search-input" />
          <select [(ngModel)]="riskFilter" (change)="filter()" class="filter-select">
            <option value="">Todos los riesgos</option>
            <option value="alto">Alto</option>
            <option value="medio">Medio</option>
            <option value="bajo">Bajo</option>
          </select>
        </div>
        <div class="toolbar-right">
          <button class="btn btn-outline" (click)="exportMorosos()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar CSV
          </button>
          <a routerLink="/whatsapp" class="btn btn-green">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
            Cobro WhatsApp
          </a>
        </div>
      </div>

      <!-- TABLE -->
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Telefono</th>
              <th>Plan</th>
              <th>Precio</th>
              <th>Facturas Pend.</th>
              <th>Monto</th>
              <th>Dias Vencido</th>
              <th>Riesgo</th>
              <th>Fecha Corte</th>
            </tr>
          </thead>
          <tbody>
            @for (m of filtered(); track m.client.id_servicio) {
              <tr>
                <td data-label="Cliente">
                  <a [routerLink]="['/clients', m.client.id_servicio]" class="client-link">{{ m.client.nombre }}</a>
                </td>
                <td data-label="Telefono" class="mono">{{ m.client.telefono || '-' }}</td>
                <td data-label="Plan">{{ m.client.plan_internet?.nombre || '-' }}</td>
                <td data-label="Precio" class="money">RD$ {{ m.client.precio_plan }}</td>
                <td data-label="Facturas" class="center">{{ m.facturasPendientes }}</td>
                <td data-label="Monto" class="money red-text">RD$ {{ m.montoTotal | number:'1.2-2' }}</td>
                <td data-label="Dias Vencido" class="center">
                  <span class="dias" [class]="'dias-' + m.riesgo">{{ m.diasVencido }}d</span>
                </td>
                <td data-label="Riesgo">
                  <span class="badge" [class]="'badge-' + m.riesgo">{{ m.riesgo | uppercase }}</span>
                </td>
                <td data-label="Fecha Corte">{{ m.client.fecha_corte }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>

      @if (filtered().length === 0) {
        <div class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="1.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          <h3>Sin morosos!</h3>
          <p>Todos los clientes estan al dia con sus pagos</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
    .kpi-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; text-align: center; }
    .kpi-card.red { border-top: 3px solid #ef4444; }
    .kpi-card.orange { border-top: 3px solid #f59e0b; }
    .kpi-card.blue { border-top: 3px solid #3b82f6; }
    .kpi-card.purple { border-top: 3px solid #8b5cf6; }
    .kpi-value { display: block; font-size: 28px; font-weight: 800; color: #0f172a; }
    .kpi-label { font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px; }

    .risk-row { display: flex; gap: 14px; margin-bottom: 20px; }
    .risk-card { flex: 1; padding: 18px; border-radius: 12px; text-align: center; cursor: pointer; transition: transform 0.2s; }
    .risk-card:hover { transform: translateY(-2px); }
    .risk-card.high { background: linear-gradient(135deg, #fef2f2, #fee2e2); border: 1px solid #fecaca; }
    .risk-card.medium { background: linear-gradient(135deg, #fffbeb, #fef3c7); border: 1px solid #fde68a; }
    .risk-card.low { background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 1px solid #bbf7d0; }
    .risk-count { display: block; font-size: 32px; font-weight: 800; }
    .high .risk-count { color: #dc2626; }
    .medium .risk-count { color: #d97706; }
    .low .risk-count { color: #16a34a; }
    .risk-label { display: block; font-size: 14px; font-weight: 600; color: #0f172a; }
    .risk-desc { font-size: 11px; color: #94a3b8; }

    .toolbar { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; gap: 12px; flex-wrap: wrap; }
    .toolbar-left { display: flex; gap: 8px; }
    .toolbar-right { display: flex; gap: 8px; }
    .search-input { padding: 8px 14px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; outline: none; width: 220px; }
    .search-input:focus { border-color: #6366f1; }
    .filter-select { padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; background: white; }

    .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; border: none; text-decoration: none; transition: all 0.2s; }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; }
    .btn-green { background: #22c55e; color: white; }
    .btn-green:hover { background: #16a34a; }

    .table-container { background: white; border: 1px solid #e2e8f0; border-radius: 14px; overflow-x: auto; }
    .data-table { width: 100%; border-collapse: collapse; min-width: 900px; }
    .data-table th { text-align: left; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
    .data-table td { padding: 12px 14px; font-size: 13px; color: #334155; border-bottom: 1px solid #f1f5f9; }
    .data-table tr:hover td { background: #fafbfc; }

    .client-link { color: #6366f1; text-decoration: none; font-weight: 600; }
    .client-link:hover { text-decoration: underline; }
    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .money { font-family: 'Courier New', monospace; font-weight: 600; }
    .red-text { color: #ef4444; }
    .center { text-align: center; }

    .dias { font-weight: 700; padding: 2px 8px; border-radius: 6px; font-size: 12px; }
    .dias-alto { background: #fee2e2; color: #dc2626; }
    .dias-medio { background: #fef3c7; color: #d97706; }
    .dias-bajo { background: #dcfce7; color: #16a34a; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; }
    .badge-alto { background: #fee2e2; color: #dc2626; }
    .badge-medio { background: #fef3c7; color: #d97706; }
    .badge-bajo { background: #dcfce7; color: #16a34a; }

    .empty-state { display: flex; flex-direction: column; align-items: center; padding: 60px; gap: 8px; }
    .empty-state h3 { color: #22c55e; margin: 0; }
    .empty-state p { color: #94a3b8; margin: 0; }

    @media (max-width: 768px) { .kpi-grid { grid-template-columns: repeat(2, 1fr); } .risk-row { flex-direction: column; } }
  `]
})
export class MorososComponent implements OnInit {
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);

  allMorosos = signal<MorosoInfo[]>([]);
  filtered = signal<MorosoInfo[]>([]);

  totalMorosos = signal(0);
  montoTotalPendiente = signal(0);
  tasaCobro = signal(0);
  promedioVencido = signal(0);
  riesgoAlto = signal(0);
  riesgoMedio = signal(0);
  riesgoBajo = signal(0);

  searchTerm = '';
  riskFilter = '';

  async ngOnInit() {
    const clients = await this.db.getClients();
    const invoices = await this.db.getInvoices();
    this.computeMorosos(clients, invoices);
  }

  computeMorosos(clients: WispHubClient[], invoices: Invoice[]) {
    const today = new Date();
    const morosos: MorosoInfo[] = [];

    const pendientes = clients.filter(c =>
      c.estado_facturas?.toLowerCase().includes('pendiente') &&
      c.estado?.toLowerCase() === 'activo'
    );

    for (const c of pendientes) {
      const clientInv = invoices.filter(i =>
        i.estado?.toLowerCase() !== 'pagada' &&
        (i.articulos?.some(a => a.servicio?.id_servicio === c.id_servicio) ||
         i.cliente?.nombre?.toLowerCase() === c.nombre?.toLowerCase())
      );

      let diasVencido = 0;
      if (c.fecha_corte) {
        const parts = c.fecha_corte.split('/');
        const corte = parts.length === 3
          ? new Date(+parts[2], +parts[1] - 1, +parts[0])
          : new Date(c.fecha_corte);
        diasVencido = Math.max(0, Math.floor((today.getTime() - corte.getTime()) / 86400000));
      }

      let riesgo: 'alto' | 'medio' | 'bajo' = 'bajo';
      if (diasVencido > 15) riesgo = 'alto';
      else if (diasVencido > 5) riesgo = 'medio';

      morosos.push({
        client: c,
        facturasPendientes: clientInv.length || 1,
        montoTotal: clientInv.reduce((s, i) => s + (i.total || 0), 0) || parseFloat(c.precio_plan || '0'),
        diasVencido,
        ultimaFactura: clientInv[0]?.fecha_vencimiento || '-',
        riesgo
      });
    }

    morosos.sort((a, b) => b.diasVencido - a.diasVencido);

    this.allMorosos.set(morosos);
    this.totalMorosos.set(morosos.length);
    this.montoTotalPendiente.set(morosos.reduce((s, m) => s + m.montoTotal, 0));
    this.riesgoAlto.set(morosos.filter(m => m.riesgo === 'alto').length);
    this.riesgoMedio.set(morosos.filter(m => m.riesgo === 'medio').length);
    this.riesgoBajo.set(morosos.filter(m => m.riesgo === 'bajo').length);
    this.promedioVencido.set(morosos.length ? morosos.reduce((s, m) => s + m.diasVencido, 0) / morosos.length : 0);

    // Tasa de cobro
    const totalClients = clients.filter(c => c.estado?.toLowerCase() === 'activo').length;
    this.tasaCobro.set(totalClients ? ((totalClients - morosos.length) / totalClients) * 100 : 100);

    this.filter();
  }

  filter() {
    let result = this.allMorosos();
    const term = this.searchTerm.toLowerCase();
    if (term) {
      result = result.filter(m =>
        m.client.nombre?.toLowerCase().includes(term) ||
        m.client.telefono?.includes(term)
      );
    }
    if (this.riskFilter) {
      result = result.filter(m => m.riesgo === this.riskFilter);
    }
    this.filtered.set(result);
  }

  filterByRisk(risk: string) {
    this.riskFilter = risk;
    this.filter();
  }

  exportMorosos() {
    this.exportSvc.exportCSV(this.filtered().map(m => ({
      nombre: m.client.nombre,
      telefono: m.client.telefono,
      plan: m.client.plan_internet?.nombre,
      precio: m.client.precio_plan,
      facturas_pendientes: m.facturasPendientes,
      monto_total: m.montoTotal,
      dias_vencido: m.diasVencido,
      riesgo: m.riesgo,
      fecha_corte: m.client.fecha_corte,
      ip: m.client.ip,
    })), 'morosos_cobranza', [
      { key: 'nombre', label: 'Cliente' },
      { key: 'telefono', label: 'Telefono' },
      { key: 'plan', label: 'Plan' },
      { key: 'precio', label: 'Precio' },
      { key: 'facturas_pendientes', label: 'Facturas Pend.' },
      { key: 'monto_total', label: 'Monto Total' },
      { key: 'dias_vencido', label: 'Dias Vencido' },
      { key: 'riesgo', label: 'Riesgo' },
      { key: 'fecha_corte', label: 'Fecha Corte' },
      { key: 'ip', label: 'IP' },
    ]);
  }
}
