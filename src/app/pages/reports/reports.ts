import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAlertTriangle, LucideArrowDownRight, LucideArrowUpRight, LucideBanknote,
  LucideCalendarRange, LucideChartColumn, LucideCircleCheck, LucideCircleDollarSign,
  LucideDownload, LucideFileSpreadsheet, LucideGauge, LucideLayers3,
  LucideMapPin, LucideReceiptText, LucideRefreshCw, LucideTrendingUp, LucideUserMinus,
  LucideUserPlus, LucideUsers, LucideWalletCards,
} from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { ExportService } from '../../services/export.service';
import { LocalDbService } from '../../services/local-db.service';

type ReportView = 'overview' | 'revenue' | 'clients' | 'portfolio';
type PeriodPreset = '3' | '6' | '12' | 'all' | 'custom';

interface TrendPoint {
  key: string;
  label: string;
  billed: number;
  collected: number;
  invoices: number;
}

interface PlanReportRow {
  plan: string;
  count: number;
  pct: number;
  revenue: number;
  avgPrice: number;
}

interface PaymentReportRow {
  name: string;
  count: number;
  total: number;
  pct: number;
}

interface ZoneReportRow {
  zone: string;
  clients: number;
  active: number;
  pending: number;
  revenue: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    NavbarComponent, DecimalPipe, FormsModule, RouterLink, PlanLabelPipe,
    LucideAlertTriangle, LucideArrowDownRight, LucideArrowUpRight, LucideBanknote,
    LucideCalendarRange, LucideChartColumn, LucideCircleCheck, LucideCircleDollarSign,
    LucideDownload, LucideFileSpreadsheet, LucideGauge, LucideLayers3,
    LucideMapPin, LucideReceiptText, LucideRefreshCw, LucideTrendingUp, LucideUserMinus,
    LucideUserPlus, LucideUsers, LucideWalletCards,
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class ReportsComponent implements OnInit {
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);

  loading = signal(true);
  errorMessage = signal('');
  activeView = signal<ReportView>('overview');
  lastUpdated = signal(new Date());

  periodPreset: PeriodPreset = '12';
  dateFrom = '';
  dateTo = '';

  billed = signal(0);
  collected = signal(0);
  collectionRate = signal(0);
  outstanding = signal(0);
  monthlyRevenue = signal(0);
  avgTicket = signal(0);
  billedDelta = signal(0);
  collectedDelta = signal(0);
  invoiceCount = signal(0);
  paidInvoiceCount = signal(0);
  totalClientCount = signal(0);
  activeClientCount = signal(0);
  newClientCount = signal(0);
  cancelledClientCount = signal(0);

  clientsByStatus = signal<{ status: string; count: number; pct: number; color: string }[]>([]);
  planReport = signal<PlanReportRow[]>([]);
  paymentReport = signal<PaymentReportRow[]>([]);
  zoneReport = signal<ZoneReportRow[]>([]);
  trend = signal<TrendPoint[]>([]);
  morosos = signal<WispHubClient[]>([]);
  gratisClients = signal<WispHubClient[]>([]);
  dataQuality = signal<{ missingPhone: number; missingIp: number; missingPlan: number; missingZone: number }>({ missingPhone: 0, missingIp: 0, missingPlan: 0, missingZone: 0 });

  maxTrendValue = computed(() => Math.max(1, ...this.trend().flatMap((point) => [point.billed, point.collected])));
  maxPaymentValue = computed(() => Math.max(1, ...this.paymentReport().map((item) => item.total)));
  topPlan = computed<PlanReportRow | null>(() => this.planReport()[0] || null);
  topZone = computed<ZoneReportRow | null>(() => [...this.zoneReport()].sort((a, b) => b.revenue - a.revenue)[0] || null);

  private clients: WispHubClient[] = [];
  private invoices: Invoice[] = [];

  async ngOnInit() {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const [clients, invoices] = await Promise.all([this.db.getClients(), this.db.getInvoices()]);
      this.clients = clients;
      this.invoices = invoices;
      this.recompute();
    } catch {
      this.errorMessage.set('No fue posible preparar los reportes. Revisa la conexión con el servidor y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
  }

  reload() {
    void this.ngOnInit();
  }

  setView(view: ReportView) {
    this.activeView.set(view);
  }

  onPeriodChange() {
    if (this.periodPreset !== 'custom') {
      this.dateFrom = '';
      this.dateTo = '';
      this.recompute();
    }
  }

  applyCustomPeriod() {
    if (this.dateFrom && this.dateTo) this.recompute();
  }

  periodLabel(): string {
    if (this.periodPreset === 'all') return 'Todo el historial';
    if (this.periodPreset === 'custom') return this.dateFrom && this.dateTo ? `${this.readableDate(this.dateFrom)} al ${this.readableDate(this.dateTo)}` : 'Rango personalizado';
    return `Últimos ${this.periodPreset} meses`;
  }

  /** Rango personalizado con la fecha inicial posterior a la final. */
  customRangeInvalid(): boolean {
    return Boolean(this.dateFrom && this.dateTo && this.dateFrom > this.dateTo);
  }

  /** Solo hay período anterior para comparar cuando el período tiene inicio. */
  hasComparison(): boolean {
    return this.periodPreset !== 'all';
  }

  trendTitle(point: TrendPoint): string {
    return `${point.label}: facturado ${this.moneyText(point.billed)} · cobrado ${this.moneyText(point.collected)} · ${point.invoices} facturas`;
  }

  /** Precio del plan (texto de WispHub) formateado para mostrar. */
  priceText(value: string | number | null | undefined): string {
    return this.moneyText(this.moneyValue(value));
  }

  private moneyText(value: number): string {
    return `RD$ ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private readableDate(value: string): string {
    const date = this.parseDate(value);
    return date ? date.toLocaleDateString('es-DO', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '') : value;
  }

  recompute() {
    const { start, end, previousStart, previousEnd } = this.getPeriodRange();
    const validInvoices = this.invoices.filter((invoice) => !this.isClosedWithoutPayment(invoice));
    const periodInvoices = validInvoices.filter((invoice) => this.dateInside(this.invoiceDate(invoice), start, end));
    const previousInvoices = previousStart && previousEnd
      ? validInvoices.filter((invoice) => this.dateInside(this.invoiceDate(invoice), previousStart, previousEnd))
      : [];

    const billed = periodInvoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
    const collected = periodInvoices.reduce((sum, invoice) => sum + this.collectedAmount(invoice), 0);
    const previousBilled = previousInvoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0);
    const previousCollected = previousInvoices.reduce((sum, invoice) => sum + this.collectedAmount(invoice), 0);
    const paid = periodInvoices.filter((invoice) => this.isPaid(invoice));

    this.billed.set(billed);
    this.collected.set(collected);
    this.collectionRate.set(billed ? Math.min(100, (collected / billed) * 100) : 0);
    this.billedDelta.set(this.percentDelta(billed, previousBilled));
    this.collectedDelta.set(this.percentDelta(collected, previousCollected));
    this.invoiceCount.set(periodInvoices.length);
    this.paidInvoiceCount.set(paid.length);
    this.avgTicket.set(paid.length ? collected / paid.length : 0);

    const activeClients = this.clients.filter((client) => client.estado?.toLowerCase() === 'activo');
    const pendingClients = activeClients.filter((client) => client.estado_facturas?.toLowerCase().includes('pendiente'));
    this.totalClientCount.set(this.clients.length);
    this.activeClientCount.set(activeClients.length);
    this.monthlyRevenue.set(activeClients.reduce((sum, client) => sum + this.moneyValue(client.precio_plan), 0));
    this.outstanding.set(pendingClients.reduce((sum, client) => {
      const clientInvoices = validInvoices.filter((invoice) => !this.isPaid(invoice) && this.invoiceBelongsToClient(invoice, client));
      const clientDebt = clientInvoices.reduce((invoiceSum, invoice) => invoiceSum + this.balanceAmount(invoice), 0);
      return sum + (clientDebt || this.moneyValue(client.precio_plan));
    }, 0));
    this.newClientCount.set(this.clients.filter((client) => this.dateInside(this.parseDate(client.fecha_instalacion), start, end)).length);
    this.cancelledClientCount.set(this.clients.filter((client) => this.dateInside(this.parseDate(client.fecha_cancelacion), start, end)).length);

    this.computeClientStatus();
    this.computePlans(activeClients);
    this.computePayments(periodInvoices);
    this.computeZones();
    this.computeTrend(periodInvoices, start, end);
    this.morosos.set(pendingClients);
    this.gratisClients.set(this.clients.filter((client) => client.estado?.toLowerCase() === 'gratis'));
    this.dataQuality.set({
      missingPhone: this.clients.filter((client) => !client.telefono?.trim()).length,
      missingIp: this.clients.filter((client) => !client.ip?.trim()).length,
      missingPlan: this.clients.filter((client) => !client.plan_internet?.nombre).length,
      missingZone: this.clients.filter((client) => !client.zona?.nombre).length,
    });
    this.lastUpdated.set(new Date());
  }

  trendHeight(value: number): number {
    return value > 0 ? Math.max(3, (value / this.maxTrendValue()) * 100) : 0;
  }

  paymentWidth(value: number): number {
    return value > 0 ? Math.max(2, (value / this.maxPaymentValue()) * 100) : 0;
  }

  statusWidth(pct: number): number {
    return Math.max(0, Math.min(100, pct));
  }

  deltaClass(delta: number): string {
    if (delta > 0.05) return 'positive';
    if (delta < -0.05) return 'negative';
    return 'neutral';
  }

  exportExecutiveSummary() {
    this.exportSvc.exportCSV([
      { metric: 'Período', value: this.periodLabel() },
      { metric: 'Facturado', value: this.billed() },
      { metric: 'Cobrado', value: this.collected() },
      { metric: 'Tasa de cobro', value: this.collectionRate() },
      { metric: 'Cartera pendiente actual', value: this.outstanding() },
      { metric: 'Ingreso mensual estimado (clientes activos)', value: this.monthlyRevenue() },
      { metric: 'Clientes activos', value: this.activeClientCount() },
      { metric: 'Clientes morosos', value: this.morosos().length },
    ], 'reporte_ejecutivo', [
      { key: 'metric', label: 'Indicador' },
      { key: 'value', label: 'Valor' },
    ]);
  }

  exportPlansReport() {
    this.exportSvc.exportCSV(this.planReport(), 'reporte_planes', [
      { key: 'plan', label: 'Plan' },
      { key: 'count', label: 'Clientes activos' },
      { key: 'pct', label: '% de activos' },
      { key: 'avgPrice', label: 'Precio promedio' },
      { key: 'revenue', label: 'Ingreso mensual' },
    ]);
  }

  exportZonesReport() {
    this.exportSvc.exportCSV(this.zoneReport(), 'reporte_zonas', [
      { key: 'zone', label: 'Zona' },
      { key: 'clients', label: 'Clientes' },
      { key: 'active', label: 'Activos' },
      { key: 'pending', label: 'Morosos' },
      { key: 'revenue', label: 'Ingreso mensual activo' },
    ]);
  }

  exportMorosos() {
    this.exportSvc.exportCSV(this.morosos(), 'morosos', [
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'plan_internet.nombre', label: 'Plan' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'fecha_corte', label: 'Fecha de corte' },
      { key: 'ip', label: 'IP' },
    ]);
  }

  private computeClientStatus() {
    const colors: Record<string, string> = { Activo: '#159765', Suspendido: '#dd4a55', Cortado: '#b93742', Gratis: '#3379bd', Retirado: '#8392a0' };
    const statusMap = new Map<string, number>();
    for (const client of this.clients) {
      const status = client.estado || 'Sin estado';
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    }
    this.clientsByStatus.set([...statusMap.entries()].sort((a, b) => b[1] - a[1]).map(([status, count]) => ({
      status,
      count,
      pct: this.clients.length ? (count / this.clients.length) * 100 : 0,
      color: colors[status] || '#8392a0',
    })));
  }

  private computePlans(activeClients: WispHubClient[]) {
    const map = new Map<string, { count: number; revenue: number }>();
    for (const client of activeClients) {
      const plan = client.plan_internet?.nombre || 'Sin plan';
      const entry = map.get(plan) || { count: 0, revenue: 0 };
      entry.count++;
      entry.revenue += this.moneyValue(client.precio_plan);
      map.set(plan, entry);
    }
    this.planReport.set([...map.entries()].sort((a, b) => b[1].revenue - a[1].revenue).map(([plan, item]) => ({
      plan,
      count: item.count,
      pct: activeClients.length ? (item.count / activeClients.length) * 100 : 0,
      revenue: item.revenue,
      avgPrice: item.count ? item.revenue / item.count : 0,
    })));
  }

  private computePayments(periodInvoices: Invoice[]) {
    const map = new Map<string, { count: number; total: number }>();
    const withCollection = periodInvoices.filter((invoice) => this.collectedAmount(invoice) > 0);
    for (const invoice of withCollection) {
      const name = invoice.forma_pago?.nombre || 'Sin definir';
      const entry = map.get(name) || { count: 0, total: 0 };
      entry.count++;
      entry.total += this.collectedAmount(invoice);
      map.set(name, entry);
    }
    const total = withCollection.reduce((sum, invoice) => sum + this.collectedAmount(invoice), 0);
    this.paymentReport.set([...map.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, item]) => ({
      name,
      count: item.count,
      total: item.total,
      pct: total ? (item.total / total) * 100 : 0,
    })));
  }

  private computeZones() {
    const map = new Map<string, ZoneReportRow>();
    for (const client of this.clients) {
      const zone = client.zona?.nombre || 'Sin zona';
      const entry = map.get(zone) || { zone, clients: 0, active: 0, pending: 0, revenue: 0 };
      entry.clients++;
      if (client.estado?.toLowerCase() === 'activo') {
        entry.active++;
        entry.revenue += this.moneyValue(client.precio_plan);
        if (client.estado_facturas?.toLowerCase().includes('pendiente')) entry.pending++;
      }
      map.set(zone, entry);
    }
    this.zoneReport.set([...map.values()].sort((a, b) => b.revenue - a.revenue));
  }

  private computeTrend(periodInvoices: Invoice[], rangeStart: Date | null, rangeEnd: Date): void {
    const datedInvoices = periodInvoices.filter((invoice) => this.invoiceDate(invoice));
    let firstMonth = rangeStart ? new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1) : null;
    if (!firstMonth && datedInvoices.length) {
      const earliest = datedInvoices.map((invoice) => this.invoiceDate(invoice)!).sort((a, b) => a.getTime() - b.getTime())[0];
      firstMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    }
    if (!firstMonth) firstMonth = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);

    const maxMonths = 24;
    const months: TrendPoint[] = [];
    let cursor = new Date(firstMonth);
    while (cursor <= rangeEnd && months.length < maxMonths) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: cursor.toLocaleDateString('es-DO', { month: 'short', year: '2-digit' }).replace('.', ''), billed: 0, collected: 0, invoices: 0 });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    if (cursor <= rangeEnd) {
      const start = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() - maxMonths + 1, 1);
      this.computeTrend(periodInvoices.filter((invoice) => {
        const date = this.invoiceDate(invoice);
        return date && date >= start;
      }), start, rangeEnd);
      return;
    }

    const byKey = new Map(months.map((month) => [month.key, month]));
    for (const invoice of datedInvoices) {
      const date = this.invoiceDate(invoice)!;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const point = byKey.get(key);
      if (!point) continue;
      point.billed += invoice.total || 0;
      point.collected += this.collectedAmount(invoice);
      point.invoices++;
    }
    this.trend.set(months);
  }

  private getPeriodRange(): { start: Date | null; end: Date; previousStart: Date | null; previousEnd: Date | null } {
    const now = new Date();
    const end = this.periodPreset === 'custom' && this.dateTo ? this.endOfDay(this.parseDate(this.dateTo) || now) : now;
    if (this.periodPreset === 'all') return { start: null, end, previousStart: null, previousEnd: null };

    let start: Date;
    if (this.periodPreset === 'custom' && this.dateFrom) {
      start = this.parseDate(this.dateFrom) || new Date(now.getFullYear(), now.getMonth() - 11, 1);
    } else {
      const months = Number(this.periodPreset) || 12;
      start = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
    }
    const duration = Math.max(1, end.getTime() - start.getTime() + 1);
    const previousEnd = new Date(start.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - duration + 1);
    return { start, end, previousStart, previousEnd };
  }

  private invoiceDate(invoice: Invoice): Date | null {
    return this.parseDate(invoice.fecha_emision);
  }

  private dateInside(date: Date | null, start: Date | null, end: Date): boolean {
    return Boolean(date && (!start || date >= start) && date <= end);
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    const text = String(value).trim();
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const latin = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (latin) return new Date(Number(latin[3]), Number(latin[2]) - 1, Number(latin[1]));
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private endOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  }

  private isClosedWithoutPayment(invoice: Invoice): boolean {
    const status = (invoice.estado || '').toLowerCase();
    return status.includes('cancelad') || status.includes('anulad') || status.includes('transfer');
  }

  private isPaid(invoice: Invoice): boolean {
    if (this.isClosedWithoutPayment(invoice)) return false;
    const status = (invoice.estado || '').toLowerCase();
    if (status.includes('pendiente')) return false;
    if (status.includes('pagad')) return true;
    return Boolean(invoice.fecha_pago) && (invoice.total || 0) > 0 && (invoice.total_cobrado || 0) >= (invoice.total || 0) - 0.01;
  }

  private balanceAmount(invoice: Invoice): number {
    if (this.isPaid(invoice) || this.isClosedWithoutPayment(invoice)) return 0;
    const status = (invoice.estado || '').toLowerCase();
    if (status.includes('pendiente')) {
      const explicitBalance = Number(invoice.saldo || 0);
      return explicitBalance > 0 ? explicitBalance : Math.max(invoice.total || 0, 0);
    }
    return Math.max(Number(invoice.saldo || 0), (invoice.total || 0) - (invoice.total_cobrado || 0), 0);
  }

  private invoiceBelongsToClient(invoice: Invoice, client: WispHubClient): boolean {
    return Boolean(
      invoice.articulos?.some((article) => article.servicio?.id_servicio === client.id_servicio) ||
      (invoice.cliente?.nombre && invoice.cliente.nombre.toLowerCase() === client.nombre?.toLowerCase()) ||
      (invoice.cliente?.usuario && invoice.cliente.usuario.toLowerCase() === client.usuario?.toLowerCase())
    );
  }

  private collectedAmount(invoice: Invoice): number {
    const status = (invoice.estado || '').toLowerCase();
    if (status.includes('pendiente')) {
      const total = Math.max(invoice.total || 0, 0);
      const explicitBalance = Number(invoice.saldo || 0);
      return explicitBalance > 0 ? Math.max(0, total - explicitBalance) : 0;
    }
    return Math.max(0, invoice.total_cobrado || 0);
  }

  private moneyValue(value: string | number | null | undefined): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const normalized = String(value || '').replace(/[^0-9.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private percentDelta(current: number, previous: number): number {
    if (!previous) return current ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }
}
