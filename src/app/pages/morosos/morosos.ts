import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAlertTriangle, LucideArrowUpRight, LucideBanknote, LucideCalendarClock,
  LucideCircleCheck, LucideDownload, LucideFileText, LucideMessageCircle,
  LucidePhone, LucidePhoneOff, LucideRefreshCw, LucideRotateCcw, LucideSearch,
  LucideSlidersHorizontal, LucideUsers,
} from '@lucide/angular';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../components/layout/navbar';
import { PlanLabelPipe } from '../../pipes/plan-label.pipe';
import { WispHubClient } from '../../models/client.model';
import { Invoice } from '../../models/invoice.model';
import { ExportService } from '../../services/export.service';
import { LocalDbService } from '../../services/local-db.service';
import { initialsOf } from '../../pipes/initials';

type RiskLevel = 'alto' | 'medio' | 'bajo';
type SortMode = 'priority' | 'amount' | 'invoices' | 'name';

interface MorosoInfo {
  client: WispHubClient;
  facturasPendientes: number;
  montoTotal: number;
  diasVencido: number;
  ultimaFactura: string;
  riesgo: RiskLevel;
}

@Component({
  selector: 'app-morosos',
  standalone: true,
  imports: [
    NavbarComponent, DecimalPipe, RouterLink, FormsModule, PlanLabelPipe,
    LucideAlertTriangle, LucideArrowUpRight, LucideBanknote, LucideCalendarClock,
    LucideCircleCheck, LucideDownload, LucideFileText, LucideMessageCircle,
    LucidePhone, LucidePhoneOff, LucideRefreshCw, LucideRotateCcw, LucideSearch,
    LucideSlidersHorizontal, LucideUsers,
  ],
  templateUrl: './morosos.html',
  styleUrl: './morosos.scss',
})
export class MorososComponent implements OnInit {
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);

  allMorosos = signal<MorosoInfo[]>([]);
  filtered = signal<MorosoInfo[]>([]);
  loading = signal(true);
  errorMessage = signal('');

  totalMorosos = signal(0);
  montoTotalPendiente = signal(0);
  tasaCobro = signal(0);
  promedioVencido = signal(0);
  riesgoAlto = signal(0);
  riesgoMedio = signal(0);
  riesgoBajo = signal(0);

  totalFacturasPendientes = computed(() => this.allMorosos().reduce((sum, item) => sum + item.facturasPendientes, 0));
  totalContactables = computed(() => this.allMorosos().filter((item) => Boolean(item.client.telefono?.trim())).length);
  visibleAmount = computed(() => this.filtered().reduce((sum, item) => sum + item.montoTotal, 0));

  searchTerm = '';
  riskFilter: RiskLevel | '' = '';
  contactFilter: 'with-phone' | 'without-phone' | '' = '';
  sortBy: SortMode = 'priority';

  async ngOnInit() {
    this.loading.set(true);
    this.errorMessage.set('');
    try {
      const [clients, invoices] = await Promise.all([this.db.getClients(), this.db.getInvoices()]);
      this.computeMorosos(clients, invoices);
    } catch {
      this.errorMessage.set('No fue posible cargar la cartera vencida. Revisa la conexión con el servidor y vuelve a intentarlo.');
    } finally {
      this.loading.set(false);
    }
  }

  computeMorosos(clients: WispHubClient[], invoices: Invoice[]) {
    const today = new Date();
    const morosos: MorosoInfo[] = [];
    const pendientes = clients.filter((client) =>
      client.estado_facturas?.toLowerCase().includes('pendiente') &&
      client.estado?.toLowerCase() === 'activo'
    );

    for (const client of pendientes) {
      const clientInvoices = invoices.filter((invoice) =>
        invoice.estado?.toLowerCase() !== 'pagada' &&
        (invoice.articulos?.some((article) => article.servicio?.id_servicio === client.id_servicio) ||
          invoice.cliente?.nombre?.toLowerCase() === client.nombre?.toLowerCase())
      );

      let overdueDays = 0;
      if (client.fecha_corte) {
        const parts = client.fecha_corte.split('/');
        const cutoff = parts.length === 3
          ? new Date(+parts[2], +parts[1] - 1, +parts[0])
          : new Date(client.fecha_corte);
        overdueDays = Math.max(0, Math.floor((today.getTime() - cutoff.getTime()) / 86400000));
      }

      let risk: RiskLevel = 'bajo';
      if (overdueDays > 15) risk = 'alto';
      else if (overdueDays > 5) risk = 'medio';

      morosos.push({
        client,
        facturasPendientes: clientInvoices.length || 1,
        montoTotal: clientInvoices.reduce((sum, invoice) => sum + (invoice.total || 0), 0) || parseFloat(client.precio_plan || '0'),
        diasVencido: overdueDays,
        ultimaFactura: clientInvoices[0]?.fecha_vencimiento || '-',
        riesgo: risk,
      });
    }

    this.allMorosos.set(morosos);
    this.totalMorosos.set(morosos.length);
    this.montoTotalPendiente.set(morosos.reduce((sum, item) => sum + item.montoTotal, 0));
    this.riesgoAlto.set(morosos.filter((item) => item.riesgo === 'alto').length);
    this.riesgoMedio.set(morosos.filter((item) => item.riesgo === 'medio').length);
    this.riesgoBajo.set(morosos.filter((item) => item.riesgo === 'bajo').length);
    this.promedioVencido.set(morosos.length ? morosos.reduce((sum, item) => sum + item.diasVencido, 0) / morosos.length : 0);

    const activeClients = clients.filter((client) => client.estado?.toLowerCase() === 'activo').length;
    this.tasaCobro.set(activeClients ? ((activeClients - morosos.length) / activeClients) * 100 : 100);
    this.filter();
  }

  reload() {
    void this.ngOnInit();
  }

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

    const riskOrder: Record<RiskLevel, number> = { alto: 3, medio: 2, bajo: 1 };
    result.sort((left, right) => {
      if (this.sortBy === 'amount') return right.montoTotal - left.montoTotal;
      if (this.sortBy === 'invoices') return right.facturasPendientes - left.facturasPendientes || right.montoTotal - left.montoTotal;
      if (this.sortBy === 'name') return (left.client.nombre || '').localeCompare(right.client.nombre || '', 'es');
      return riskOrder[right.riesgo] - riskOrder[left.riesgo] || right.diasVencido - left.diasVencido || right.montoTotal - left.montoTotal;
    });
    this.filtered.set(result);
  }

  filterByRisk(risk: RiskLevel) {
    this.riskFilter = this.riskFilter === risk ? '' : risk;
    this.filter();
  }

  resetFilters() {
    this.searchTerm = '';
    this.riskFilter = '';
    this.contactFilter = '';
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
      { key: 'fecha_corte', label: 'Fecha de corte' },
      { key: 'ip', label: 'IP' },
    ]);
  }
}
