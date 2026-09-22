import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAlertTriangle, LucideArrowUpRight, LucideBanknote, LucideBellRing,
  LucideCheckCheck, LucideCircleCheck, LucideCircleDollarSign, LucideCopy, LucideDownload,
  LucideFileText, LucideLayoutGrid, LucideList, LucideMessageCircle, LucidePhone, LucidePhoneOff,
  LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideSlidersHorizontal, LucideUsers, LucideWifiOff,
} from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { ClientBlockActionsComponent } from '../../components/client-block-actions/client-block-actions';
import { PaymentModalComponent } from '../../components/payment-modal/payment-modal';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { AuthService } from '../../services/auth.service';
import { ClientActionsService } from '../../services/client-actions.service';
import { ConfigService } from '../../services/config.service';
import { ExportService } from '../../services/export.service';
import { LocalDbService } from '../../services/local-db.service';
import { ToastService } from '../../services/toast.service';
import { initialsOf } from '../../pipes/initials';
import { formatDrPhone, telLink, whatsappLink } from '../../pipes/phone';
import { invoicePendingBalance, isInvoicePending, parseInvoiceDate } from '../../utils/invoice-status';

type RiskLevel = 'alto' | 'medio' | 'bajo';
type SortMode = 'priority' | 'amount' | 'invoices' | 'name';
type ManageFilter = '' | 'pending' | 'aviso' | 'corte';
type ServiceFilter = '' | 'activo' | 'suspendido' | 'otro';
type ViewMode = 'queue' | 'table';

interface MorosoInfo {
  client: WispHubClient;
  facturasPendientes: number;
  montoTotal: number;
  diasVencido: number;
  ultimaFactura: string;
  riesgo: RiskLevel;
  /** Facturas abiertas, de la mas antigua a la mas reciente. */
  invoices: Invoice[];
  telefonoBonito: string;
  waHref: string | null;
  telHref: string | null;
  /** Estado del servicio en WispHub: activo, suspendido, gratis... */
  servicio: string;
}

const VIEW_KEY = 'ispmax.morosos.view';

@Component({
  selector: 'app-morosos',
  standalone: true,
  imports: [
    NavbarComponent, DecimalPipe, RouterLink, FormsModule, PlanLabelPipe,
    ClientBlockActionsComponent, PaymentModalComponent,
    LucideAlertTriangle, LucideArrowUpRight, LucideBanknote, LucideBellRing,
    LucideCheckCheck, LucideCircleCheck, LucideCircleDollarSign, LucideCopy, LucideDownload,
    LucideFileText, LucideLayoutGrid, LucideList, LucideMessageCircle, LucidePhone, LucidePhoneOff,
    LucideRefreshCw, LucideRotateCcw, LucideSearch, LucideSlidersHorizontal, LucideUsers, LucideWifiOff,
  ],
  templateUrl: './morosos.html',
  styleUrl: './morosos.scss',
})
export class MorososComponent implements OnInit, OnDestroy {
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);
  private actions = inject(ClientActionsService);
  private config = inject(ConfigService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private destroy$ = new Subject<void>();

  allMorosos = signal<MorosoInfo[]>([]);
  filtered = signal<MorosoInfo[]>([]);
  loading = signal(true);
  errorMessage = signal('');

  /** Estado de cobro ya aplicado por el operador: 'moroso' (aviso) o 'block' (cortado). */
  crmActions = signal<Map<number, string>>(new Map());
  paymentPilots = signal<Set<number>>(new Set());

  view = signal<ViewMode>('queue');
  showPayment = signal(false);
  payingInvoice = signal<Invoice | null>(null);
  private payingClient: MorosoInfo | null = null;

  canCollect = computed(() => this.auth.hasRole(['cobranza']));

  totalMorosos = signal(0);
  montoTotalPendiente = signal(0);
  tasaCobro = signal(0);
  promedioVencido = signal(0);
  riesgoAlto = signal(0);
  riesgoMedio = signal(0);
  riesgoBajo = signal(0);

  totalFacturasPendientes = computed(() => this.allMorosos().reduce((sum, item) => sum + item.facturasPendientes, 0));
  visibleAmount = computed(() => this.filtered().reduce((sum, item) => sum + item.montoTotal, 0));
  /** Clientes con aviso o corte ya aplicado: la cola de trabajo real es el resto. */
  gestionados = computed(() => this.allMorosos().filter((item) => this.gestionOf(item) !== 'none').length);
  sinGestionar = computed(() => this.totalMorosos() - this.gestionados());
  conAviso = computed(() => this.allMorosos().filter((item) => this.gestionOf(item) === 'aviso').length);
  cortados = computed(() => this.allMorosos().filter((item) => this.gestionOf(item) === 'corte').length);
  conServicioActivo = computed(() => this.allMorosos().filter((item) => this.isActive(item)).length);
  suspendidos = computed(() => this.allMorosos().filter((item) => this.isSuspended(item)).length);

  searchTerm = '';
  riskFilter: RiskLevel | '' = '';
  contactFilter: 'with-phone' | 'without-phone' | '' = '';
  manageFilter: ManageFilter = '';
  serviceFilter: ServiceFilter = '';
  sortBy: SortMode = 'priority';

  ngOnInit() {
    this.restoreView();
    void this.load();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private async load() {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const [clients, invoices] = await Promise.all([this.db.getClients(), this.db.getInvoices()]);
      this.computeMorosos(clients, invoices);
      this.loadCrmStates();
    } catch {
      this.errorMessage.set('No fue posible cargar la cartera vencida. Revisa la conexión con el servidor y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
  }

  computeMorosos(clients: WispHubClient[], invoices: Invoice[]) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const morosos: MorosoInfo[] = [];
    // Deben tambien los suspendidos y los cortados: dejarlos fuera escondia la
    // mayor parte de la cartera vencida, que es justo la que hay que perseguir.
    const pendientes = clients.filter((client) =>
      client.estado_facturas?.toLowerCase().includes('pendiente'));

    for (const client of pendientes) {
      // Solo cuentan las facturas realmente abiertas: las anuladas o transferidas
      // a otra factura inflaban la deuda y hacían llamar a quien no debía.
      const clientInvoices = invoices
        .filter((invoice) =>
          isInvoicePending(invoice) &&
          (invoice.articulos?.some((article) => article.servicio?.id_servicio === client.id_servicio) ||
            invoice.cliente?.nombre?.toLowerCase() === client.nombre?.toLowerCase())
        )
        .sort((left, right) => {
          const leftDue = parseInvoiceDate(left.fecha_vencimiento)?.getTime() ?? 0;
          const rightDue = parseInvoiceDate(right.fecha_vencimiento)?.getTime() ?? 0;
          return leftDue - rightDue;
        });

      const invoiceDebt = clientInvoices.reduce((sum, invoice) => sum + invoicePendingBalance(invoice), 0);
      const oldestDue = parseInvoiceDate(clientInvoices[0]?.fecha_vencimiento);
      const cutoff = oldestDue ?? parseInvoiceDate(client.fecha_corte);
      const overdueDays = cutoff ? Math.max(0, Math.floor((today.getTime() - cutoff.getTime()) / 86400000)) : 0;

      let risk: RiskLevel = 'bajo';
      if (overdueDays > 15) risk = 'alto';
      else if (overdueDays > 5) risk = 'medio';

      const phone = client.telefono?.trim() || '';
      morosos.push({
        client,
        facturasPendientes: clientInvoices.length || 1,
        montoTotal: invoiceDebt || parseFloat(client.precio_plan || '0'),
        diasVencido: overdueDays,
        ultimaFactura: clientInvoices[0]?.fecha_vencimiento || '-',
        riesgo: risk,
        invoices: clientInvoices,
        telefonoBonito: phone ? formatDrPhone(phone) : '',
        waHref: null,
        telHref: telLink(phone),
        servicio: (client.estado || '').trim() || 'Sin estado',
      });
    }

    // El mensaje de WhatsApp se arma al final, cuando ya se conoce la deuda total.
    for (const item of morosos) item.waHref = this.buildWhatsappLink(item);

    this.allMorosos.set(morosos);
    this.totalMorosos.set(morosos.length);
    this.montoTotalPendiente.set(morosos.reduce((sum, item) => sum + item.montoTotal, 0));
    this.riesgoAlto.set(morosos.filter((item) => item.riesgo === 'alto').length);
    this.riesgoMedio.set(morosos.filter((item) => item.riesgo === 'medio').length);
    this.riesgoBajo.set(morosos.filter((item) => item.riesgo === 'bajo').length);
    this.promedioVencido.set(morosos.length ? morosos.reduce((sum, item) => sum + item.diasVencido, 0) / morosos.length : 0);

    // La cartera al dia se mide solo entre los clientes activos, que son los que
    // deberian estar pagando este mes.
    const activeClients = clients.filter((client) => client.estado?.toLowerCase() === 'activo').length;
    const activeMorosos = morosos.filter((item) => this.isActive(item)).length;
    this.tasaCobro.set(activeClients ? ((activeClients - activeMorosos) / activeClients) * 100 : 100);
    this.filter();
  }

  private loadCrmStates() {
    this.actions.states().pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => {
        const map = new Map<number, string>();
        const pilots = new Set<number>();
        for (const row of rows) {
          if (row.crmAction) map.set(row.idServicio, row.crmAction);
          if (row.paymentPilotEnabled) pilots.add(row.idServicio);
        }
        this.crmActions.set(map);
        this.paymentPilots.set(pilots);
        this.filter();
      },
      error: () => {},
    });
  }

  reload() {
    void this.load();
  }

  // ─── Vista ───

  setView(mode: ViewMode) {
    this.view.set(mode);
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* navegación privada */ }
  }

  private restoreView() {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved === 'queue' || saved === 'table') this.view.set(saved);
    } catch { /* navegación privada */ }
  }

  // ─── Estado de gestión ───

  /** 'corte' = internet cortado, 'aviso' = aviso de pago activo, 'none' = aún sin gestionar. */
  gestionOf(item: MorosoInfo): 'none' | 'aviso' | 'corte' {
    const action = this.crmActions().get(item.client.id_servicio);
    if (action === 'block') return 'corte';
    if (action === 'moroso') return 'aviso';
    return 'none';
  }

  /** El servicio sigue encendido: son los que todavia se pueden presionar con un corte. */
  isActive(item: MorosoInfo): boolean {
    return item.servicio.toLowerCase() === 'activo';
  }

  isSuspended(item: MorosoInfo): boolean {
    const state = item.servicio.toLowerCase();
    return state.includes('suspend') || state.includes('cortad');
  }

  serviceLabel(item: MorosoInfo): string {
    return item.servicio;
  }

  serviceTone(item: MorosoInfo): 'ok' | 'off' | 'other' {
    if (this.isActive(item)) return 'ok';
    if (this.isSuspended(item)) return 'off';
    return 'other';
  }

  gestionLabel(item: MorosoInfo): string {
    const state = this.gestionOf(item);
    return state === 'corte' ? 'Internet cortado' : state === 'aviso' ? 'Aviso de pago activo' : 'Sin gestionar';
  }

  crmActionFor(id: number): string | null {
    return this.crmActions().get(id) ?? null;
  }

  paymentPilotFor(id: number): boolean {
    return this.paymentPilots().has(id);
  }

  onActionChanged(event: { action: string }, id: number) {
    const map = new Map(this.crmActions());
    if (event.action === 'clear') map.delete(id);
    else map.set(id, event.action);
    this.crmActions.set(map);
    this.filter();
  }

  // ─── Contacto ───

  private buildWhatsappLink(item: MorosoInfo): string | null {
    const phone = item.client.telefono?.trim();
    if (!phone) return null;
    return whatsappLink(phone, this.buildMessage(item));
  }

  /** Usa la misma plantilla que los avisos automáticos, para que el cliente reciba siempre lo mismo. */
  buildMessage(item: MorosoInfo): string {
    const template = this.config.autoNotifOverdueMsg();
    const amount = item.montoTotal.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return template
      .replace(/\{nombre\}/g, item.client.nombre || 'cliente')
      .replace(/\{empresa\}/g, this.config.companyName())
      .replace(/\{fecha_corte\}/g, item.client.fecha_corte || '')
      .replace(/\{precio\}/g, amount)
      .replace(/\{monto\}/g, amount)
      .replace(/\{facturas\}/g, String(item.facturasPendientes))
      .replace(/\{dias_vencido\}/g, String(item.diasVencido))
      .replace(/\{plan\}/g, item.client.plan_internet?.nombre || '');
  }

  async copyMessage(item: MorosoInfo) {
    try {
      await navigator.clipboard.writeText(this.buildMessage(item));
      this.toast.success('Mensaje copiado; pégalo donde lo necesites.');
    } catch {
      this.toast.error('El navegador no permitió copiar el mensaje.');
    }
  }

  // ─── Cobro ───

  openPayment(item: MorosoInfo) {
    const invoice = item.invoices[0];
    if (!invoice) {
      this.toast.info('Este cliente no tiene facturas guardadas. Sincroniza Facturación para cobrar desde aquí.');
      return;
    }
    this.payingClient = item;
    this.payingInvoice.set(invoice);
    this.showPayment.set(true);
  }

  closePayment() {
    this.showPayment.set(false);
    this.payingInvoice.set(null);
    this.payingClient = null;
  }

  onPaymentSuccess() {
    const name = this.payingClient?.client.nombre;
    this.closePayment();
    this.toast.success(name ? `Pago registrado para ${name}.` : 'Pago registrado.');
    void this.load();
  }

  // ─── Filtros ───

  riskLabel(risk: RiskLevel): string {
    return risk === 'alto' ? 'Alto' : risk === 'medio' ? 'Medio' : 'Reciente';
  }

  filter() {
    let result = [...this.allMorosos()];
    const term = this.searchTerm.trim().toLowerCase();
    if (term) {
      result = result.filter((item) =>
        item.client.nombre?.toLowerCase().includes(term) ||
        item.client.usuario?.toLowerCase().includes(term) ||
        item.client.telefono?.includes(term) ||
        item.client.ip?.includes(term)
      );
    }
    if (this.riskFilter) result = result.filter((item) => item.riesgo === this.riskFilter);
    if (this.contactFilter === 'with-phone') result = result.filter((item) => Boolean(item.client.telefono?.trim()));
    if (this.contactFilter === 'without-phone') result = result.filter((item) => !item.client.telefono?.trim());
    if (this.manageFilter === 'pending') result = result.filter((item) => this.gestionOf(item) === 'none');
    if (this.manageFilter === 'aviso') result = result.filter((item) => this.gestionOf(item) === 'aviso');
    if (this.manageFilter === 'corte') result = result.filter((item) => this.gestionOf(item) === 'corte');
    if (this.serviceFilter === 'activo') result = result.filter((item) => this.isActive(item));
    if (this.serviceFilter === 'suspendido') result = result.filter((item) => this.isSuspended(item));
    if (this.serviceFilter === 'otro') result = result.filter((item) => !this.isActive(item) && !this.isSuspended(item));

    const riskOrder: Record<RiskLevel, number> = { alto: 3, medio: 2, bajo: 1 };
    result.sort((left, right) => {
      if (this.sortBy === 'amount') return right.montoTotal - left.montoTotal;
      if (this.sortBy === 'invoices') return right.facturasPendientes - left.facturasPendientes || right.montoTotal - left.montoTotal;
      if (this.sortBy === 'name') return (left.client.nombre || '').localeCompare(right.client.nombre || '', 'es');
      // Prioridad: primero el que aun tiene servicio (se le puede cortar), luego
      // lo que nadie ha tocado todavia y, dentro de eso, lo mas grave.
      const leftActive = this.isActive(left) ? 0 : 1;
      const rightActive = this.isActive(right) ? 0 : 1;
      if (leftActive !== rightActive) return leftActive - rightActive;
      const leftDone = this.gestionOf(left) === 'none' ? 0 : 1;
      const rightDone = this.gestionOf(right) === 'none' ? 0 : 1;
      return leftDone - rightDone ||
        riskOrder[right.riesgo] - riskOrder[left.riesgo] ||
        right.diasVencido - left.diasVencido ||
        right.montoTotal - left.montoTotal;
    });
    this.filtered.set(result);
  }

  filterByRisk(risk: RiskLevel) {
    this.riskFilter = this.riskFilter === risk ? '' : risk;
    this.filter();
  }

  filterByManage(value: ManageFilter) {
    this.manageFilter = this.manageFilter === value ? '' : value;
    this.filter();
  }

  resetFilters() {
    this.searchTerm = '';
    this.riskFilter = '';
    this.contactFilter = '';
    this.manageFilter = '';
    this.serviceFilter = '';
    this.sortBy = 'priority';
    this.filter();
  }

  riskAmount(risk: RiskLevel): number {
    return this.allMorosos().filter((item) => item.riesgo === risk).reduce((sum, item) => sum + item.montoTotal, 0);
  }

  riskShare(risk: RiskLevel): number {
    const total = this.montoTotalPendiente();
    return total ? (this.riskAmount(risk) / total) * 100 : 0;
  }

  initials(name: string): string {
    return initialsOf(name);
  }

  exportMorosos() {
    this.exportSvc.exportCSV(this.filtered().map((item) => ({
      nombre: item.client.nombre,
      telefono: item.client.telefono,
      plan: item.client.plan_internet?.nombre,
      precio: item.client.precio_plan,
      facturas_pendientes: item.facturasPendientes,
      monto_total: item.montoTotal,
      dias_vencido: item.diasVencido,
      riesgo: this.riskLabel(item.riesgo),
      servicio: item.servicio,
      gestion: this.gestionLabel(item),
      fecha_corte: item.client.fecha_corte,
      ip: item.client.ip,
    })), 'morosos_cobranza', [
      { key: 'nombre', label: 'Cliente' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'plan', label: 'Plan' },
      { key: 'precio', label: 'Precio' },
      { key: 'facturas_pendientes', label: 'Facturas pendientes' },
      { key: 'monto_total', label: 'Monto total' },
      { key: 'dias_vencido', label: 'Días vencido' },
      { key: 'riesgo', label: 'Riesgo' },
      { key: 'servicio', label: 'Estado del servicio' },
      { key: 'gestion', label: 'Gestión' },
      { key: 'fecha_corte', label: 'Fecha de corte' },
      { key: 'ip', label: 'IP' },
    ]);
  }
}
