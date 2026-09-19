import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { LucideCopy, LucideEye, LucideEyeOff, LucideGrid3x3 } from '@lucide/angular';
import { MtIpamResponse, MtIpamRow } from '../../services/mikrotik.service';
import { ToastService } from '../../services/toast.service';
import { copyToClipboard, intToIp, ipToInt, readPref, writePref } from './mt-utils';

type CellState = 'recommended' | 'free' | 'client' | 'occupied' | 'pool' | 'router' | 'conflict' | 'edge' | 'nodata' | 'outside';

interface GridCell { n: number; ip: string; state: CellState; title: string }
interface GridBlock {
  id: string;
  cidr: string;
  label: string;
  cells: GridCell[];
  counts: Record<CellState, number>;
  hosts: number;
  used: number;
  firstFree: string | null;
}

const LEGEND: Array<{ state: CellState; label: string }> = [
  { state: 'recommended', label: 'Libre sugerida' },
  { state: 'free', label: 'Libre' },
  { state: 'client', label: 'Cliente WispHub' },
  { state: 'occupied', label: 'Ocupada sin cliente' },
  { state: 'pool', label: 'Reserva de pool' },
  { state: 'router', label: 'Infraestructura' },
  { state: 'conflict', label: 'Conflicto IP / MAC' },
  { state: 'edge', label: 'Red / difusión' },
];

const MAX_BLOCKS_PER_NETWORK = 64;

/** Mapa visual de cada /24 del inventario IP (datos de /mikrotik/ipam, sin peticiones nuevas). */
@Component({
  selector: 'app-mt-ip-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideCopy, LucideEye, LucideEyeOff, LucideGrid3x3],
  host: { class: 'panel mt-ip-grid' },
  template: `
    <header>
      <div>
        <span class="section-icon"><svg lucideGrid3x3 size="18" aria-hidden="true"></svg></span>
        <div><h2>Mapa de ocupación</h2><p>Cada cuadro es una IP. Clic en una libre para copiarla; en una ocupada para verla en la tabla.</p></div>
      </div>
      <button type="button" class="toggle" (click)="toggleVisible()" [attr.aria-expanded]="visible()">
        @if (visible()) { <svg lucideEyeOff size="15" aria-hidden="true"></svg>Ocultar } @else { <svg lucideEye size="15" aria-hidden="true"></svg>Mostrar }
      </button>
    </header>

    @if (visible()) {
      @if (!blocks().length) {
        <div class="empty">{{ ipam() ? 'No hay rangos de IP configurados para dibujar.' : 'Cargando inventario IP…' }}</div>
      } @else {
        @if (ipam()?.truncated) { <p class="notice">Los rangos son muy grandes: solo se dibujan las IPs con uso detectado. Las casillas sin datos no garantizan que la IP esté libre.</p> }
        <div class="blocks" role="tablist" aria-label="Bloques de IP">
          @for (block of blocks(); track block.id) {
            <button type="button" role="tab" [class.active]="active()?.id === block.id" [attr.aria-selected]="active()?.id === block.id" (click)="selectBlock(block.id)">
              <strong>{{ block.label }}</strong>
              <i><b [style.width.%]="block.hosts ? (block.used / block.hosts) * 100 : 0" [class.full]="block.hosts && block.used / block.hosts >= 0.9"></b></i>
              <small>{{ freeCount(block) }} libres de {{ block.hosts }}</small>
            </button>
          }
        </div>

        @if (active(); as block) {
          <div class="body">
            <div class="map">
              <div class="cells" (mouseleave)="hover.set(null)">
                @for (row of rowStarts; track row) {
                  <span class="row-label" aria-hidden="true">.{{ row }}</span>
                  @for (cell of block.cells.slice(row, row + 16); track cell.n) {
                    <button type="button" tabindex="-1" class="cell" [class]="cell.state" [title]="cell.title" [attr.aria-label]="cell.title"
                      [disabled]="cell.state === 'outside'" (mouseenter)="hover.set(cell)" (click)="onCell(cell)"></button>
                  }
                }
              </div>
              <p class="detail" aria-live="polite">{{ hover()?.title || 'Pase el cursor sobre un cuadro para ver quién usa esa IP.' }}</p>
            </div>
            <aside class="side">
              <button type="button" class="copy-first" [disabled]="!block.firstFree" (click)="copyFirst(block)" [title]="block.firstFree ? 'Copiar ' + block.firstFree : 'No quedan IPs libres en este bloque'">
                <svg lucideCopy size="15" aria-hidden="true"></svg>
                @if (block.firstFree) { <span>Copiar primera libre <b>{{ block.firstFree }}</b></span> } @else { <span>Sin IPs libres en este bloque</span> }
              </button>
              <ul class="legend">
                @for (item of legend; track item.state) {
                  <li [class.zero]="!block.counts[item.state]"><i class="swatch" [class]="item.state"></i><span>{{ item.label }}</span><b>{{ block.counts[item.state] }}</b></li>
                }
                @if (block.counts.nodata) { <li><i class="swatch nodata"></i><span>Sin datos</span><b>{{ block.counts.nodata }}</b></li> }
              </ul>
              <p class="usage">{{ block.used }} de {{ block.hosts }} usadas · {{ block.hosts ? ((block.used / block.hosts) * 100).toFixed(0) : 0 }}% del bloque {{ block.cidr }}</p>
            </aside>
          </div>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; margin-bottom: 10px; }
    .toggle { display: inline-flex; align-items: center; gap: 6px; min-height: 30px; padding: 0 10px; border: 1px solid #d7dee7; border-radius: 6px; background: #fff; color: #334250; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; }
    .toggle:hover { border-color: #8291a5; }
    .empty { padding: 20px 16px; color: #667582; font-size: 12px; }
    .notice { margin: 10px 14px 0; padding: 8px 10px; border-radius: 6px; background: #fff6e8; color: #8a520e; font-size: 12px; }
    .blocks { display: flex; gap: 6px; padding: 12px 14px 0; overflow-x: auto; }
    .blocks button { flex: 0 0 150px; padding: 8px 10px; border: 1px solid #dfe5ea; border-radius: 6px; background: #fff; color: #334250; text-align: left; font: inherit; cursor: pointer; }
    .blocks button:hover { border-color: #9eabba; }
    .blocks button.active { border-color: #1267dd; box-shadow: inset 0 0 0 1px #1267dd; background: #f2f7ff; }
    .blocks strong { display: block; font: 700 12px ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .blocks i { display: block; height: 4px; margin: 6px 0 4px; border-radius: 3px; background: #e8edf2; overflow: hidden; }
    .blocks i b { display: block; height: 100%; background: #1267dd; }
    .blocks i b.full { background: #b42318; }
    .blocks small { color: #667582; font-size: 11px; }
    .body { display: grid; grid-template-columns: minmax(0, 560px) minmax(220px, 1fr); gap: 18px; padding: 12px 14px 14px; }
    .cells { display: grid; grid-template-columns: 30px repeat(16, minmax(0, 1fr)); gap: 3px; align-items: center; }
    .row-label { color: #8a95a6; font: 11px ui-monospace, 'Cascadia Mono', Consolas, monospace; text-align: right; padding-right: 3px; }
    .cell { aspect-ratio: 1; min-width: 0; padding: 0; border: 1px solid transparent; border-radius: 3px; background: #eef1f4; cursor: pointer; }
    .cell:hover:not(:disabled) { outline: 2px solid #172535; outline-offset: 1px; }
    .cell:disabled { cursor: default; opacity: .25; }
    .recommended { background: #13875a; }
    .free { background: #c7ecd9; border-color: #8fd3b1; }
    .client { background: #5b9bea; }
    .occupied { background: #e5a33c; }
    .pool { background: #c3ccd6; }
    .router { background: #334250; }
    .conflict { background: #b42318; }
    .edge { background: repeating-linear-gradient(45deg, #dfe5ea 0 3px, #f8fafc 3px 6px); }
    .nodata { background: #fff; border: 1px dashed #ccd6de; }
    .outside { background: transparent; border-color: #eef1f4; }
    .detail { min-height: 18px; margin: 8px 0 0; color: #334250; font-size: 12px; overflow-wrap: anywhere; }
    .side { min-width: 0; }
    .copy-first { width: 100%; display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 12px; border: 1px solid #1267dd; border-radius: 6px; background: #1267dd; color: #fff; font: inherit; font-size: 12px; font-weight: 650; cursor: pointer; text-align: left; }
    .copy-first:hover:not(:disabled) { background: #0d58c0; }
    .copy-first:disabled { border-color: #dfe5ea; background: #f8fafc; color: #667582; cursor: not-allowed; }
    .copy-first b { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .legend { margin: 12px 0 0; padding: 0; list-style: none; }
    .legend li { display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 4px 0; color: #334250; font-size: 12px; }
    .legend li.zero { color: #8a95a6; }
    .legend b { font-weight: 750; }
    .swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid transparent; }
    .usage { margin: 10px 0 0; color: #667582; font-size: 11px; }
    @media (max-width: 820px) { .body { grid-template-columns: 1fr; } .cells { gap: 2px; grid-template-columns: 26px repeat(16, minmax(0, 1fr)); } }
  `],
})
export class MtIpGridComponent {
  private readonly toast = inject(ToastService);

  readonly ipam = input<MtIpamResponse | null>(null);
  readonly network = input<string | null>(null);
  readonly pick = output<string>();

  readonly legend = LEGEND;
  readonly rowStarts = Array.from({ length: 16 }, (_, index) => index * 16);
  readonly hover = signal<GridCell | null>(null);
  readonly visible = signal<boolean>(readPref('ipGridVisible', true));
  private readonly selected = signal<string | null>(readPref<string | null>('ipGridBlock', null));

  private readonly rowsByIp = computed(() => {
    const map = new Map<number, MtIpamRow>();
    for (const row of this.ipam()?.rows || []) {
      const value = ipToInt(row.ip);
      if (value !== null) map.set(value, row);
    }
    return map;
  });

  readonly blocks = computed<GridBlock[]>(() => {
    const data = this.ipam();
    if (!data) return [];
    const rows = this.rowsByIp();
    const selectedNetwork = this.network();
    const blocks: GridBlock[] = [];
    for (const network of data.networks || []) {
      if (selectedNetwork && network.cidr !== selectedNetwork) continue;
      const base = ipToInt(network.network);
      if (base === null || network.prefix < 8 || network.prefix > 30) continue;
      const size = 2 ** (32 - network.prefix);
      const start = base;
      const end = base + size - 1;
      const firstBlock = start - (start % 256);
      for (let blockStart = firstBlock, index = 0; blockStart <= end && index < MAX_BLOCKS_PER_NETWORK; blockStart += 256, index++) {
        blocks.push(this.buildBlock(network.cidr, blockStart, start, end, rows));
      }
    }
    return blocks;
  });

  readonly active = computed<GridBlock | null>(() => {
    const blocks = this.blocks();
    return blocks.find((block) => block.id === this.selected()) || blocks[0] || null;
  });

  private buildBlock(cidr: string, blockStart: number, start: number, end: number, rows: Map<number, MtIpamRow>): GridBlock {
    const counts: Record<CellState, number> = { recommended: 0, free: 0, client: 0, occupied: 0, pool: 0, router: 0, conflict: 0, edge: 0, nodata: 0, outside: 0 };
    const cells: GridCell[] = [];
    let firstFree: string | null = null;
    for (let n = 0; n < 256; n++) {
      const value = blockStart + n;
      const ip = intToIp(value);
      let state: CellState;
      let title: string;
      const row = rows.get(value);
      if (value < start || value > end) {
        state = 'outside'; title = `${ip} · fuera del rango ${cidr}`;
      } else if (value === start || value === end) {
        state = 'edge'; title = `${ip} · ${value === start ? 'dirección de red' : 'difusión'} (no se asigna)`;
      } else if (!row) {
        state = 'nodata'; title = `${ip} · sin datos en el inventario`;
      } else {
        state = this.stateFor(row);
        title = this.describe(row);
      }
      counts[state]++;
      if (!firstFree && (state === 'recommended' || state === 'free')) firstFree = ip;
      cells.push({ n, ip, state, title });
    }
    const hosts = 256 - counts.outside - counts.edge;
    const used = counts.client + counts.occupied + counts.pool + counts.router + counts.conflict;
    const prefix = intToIp(blockStart).split('.').slice(0, 3).join('.');
    return { id: `${cidr}|${blockStart}`, cidr, label: `${prefix}.x`, cells, counts, hosts, used, firstFree };
  }

  private stateFor(row: MtIpamRow): CellState {
    if (row.conflict) return 'conflict';
    switch (row.classification) {
      case 'available': return row.recommended ? 'recommended' : 'free';
      case 'client': return 'client';
      case 'router': return 'router';
      case 'pool_reserved': return 'pool';
      default: return 'occupied';
    }
  }

  private describe(row: MtIpamRow): string {
    if (row.conflict) return `${row.ip} · Conflicto: ${row.macAddresses.join(', ') || 'varias concesiones'}`;
    switch (row.classification) {
      case 'available': return `${row.ip} · Libre${row.recommended ? ' (sugerida)' : ''}: clic para copiar`;
      case 'client': return `${row.ip} · Cliente: ${row.client?.name || '-'}${row.client?.username ? ` (${row.client.username})` : ''}`;
      case 'router': return `${row.ip} · Infraestructura del router${row.interface ? ` (${row.interface})` : ''}`;
      case 'pool_reserved': return `${row.ip} · Reserva del pool ${row.poolName || ''}`.trim();
      case 'queue_only': return `${row.ip} · Cola sin cliente: ${row.queueName || '-'}`;
      case 'unknown_lease': return `${row.ip} · DHCP sin cliente: ${row.hostName || row.macAddress || '-'}`;
      case 'arp_only': return `${row.ip} · Equipo visto en ARP sin cliente: ${row.macAddress || '-'}`;
      default: return row.ip;
    }
  }

  freeCount(block: GridBlock): number {
    return block.counts.free + block.counts.recommended;
  }

  selectBlock(id: string) {
    this.selected.set(id);
    this.hover.set(null);
    writePref('ipGridBlock', id);
  }

  toggleVisible() {
    const next = !this.visible();
    this.visible.set(next);
    writePref('ipGridVisible', next);
  }

  async onCell(cell: GridCell) {
    this.hover.set(cell);
    if (cell.state === 'outside' || cell.state === 'edge') return;
    if (cell.state === 'free' || cell.state === 'recommended') {
      await this.copy(cell.ip);
      return;
    }
    this.pick.emit(cell.ip);
  }

  async copyFirst(block: GridBlock) {
    if (block.firstFree) await this.copy(block.firstFree);
  }

  private async copy(ip: string) {
    if (await copyToClipboard(ip)) this.toast.success(`IP ${ip} copiada`);
    else this.toast.error(`No se pudo copiar. Anote la IP: ${ip}`);
  }
}
