import { Injectable } from '@angular/core';

/** Estado de la lista de clientes que se conserva al abrir un expediente y volver. */
export interface ClientListViewState {
  searchTerm: string;
  quickFilter: string;
  statusFilter: string;
  invoiceFilter: string;
  zoneFilter: string;
  planFilter: string;
  tierFilter: string;
  dataFilter: string;
  consumptionFilter: string;
  sortCol: string;
  sortDir: 'asc' | 'desc';
  page: number;
  pageSize: number;
  viewMode: string;
  filtersExpanded: boolean;
  scrollY: number;
}

const VIEW_KEY = 'isp-max:clients:view';
const NAV_KEY = 'isp-max:clients:nav';
const PREFS_KEY = 'isp-max:clients:prefs';

/**
 * sessionStorage: la vista dura mientras la pestaña esté abierta.
 * localStorage: solo preferencias (tipo de vista y filas por página).
 * Todo va en try/catch porque el almacenamiento puede estar bloqueado.
 */
@Injectable({ providedIn: 'root' })
export class ClientListStateService {
  saveView(state: ClientListViewState): void {
    this.write(sessionStorage, VIEW_KEY, state);
    this.write(localStorage, PREFS_KEY, { viewMode: state.viewMode, pageSize: state.pageSize });
  }

  loadView(): Partial<ClientListViewState> | null {
    return this.read<Partial<ClientListViewState>>(sessionStorage, VIEW_KEY)
      ?? this.read<Partial<ClientListViewState>>(localStorage, PREFS_KEY);
  }

  /** Orden actual de la lista filtrada, para Anterior/Siguiente en el expediente. */
  saveNavigation(ids: number[], label: string): void {
    this.write(sessionStorage, NAV_KEY, { ids, label });
  }

  navigationFor(id: number): { prev: number | null; next: number | null; index: number; total: number; label: string } | null {
    const nav = this.read<{ ids: number[]; label: string }>(sessionStorage, NAV_KEY);
    if (!nav?.ids?.length) return null;
    const index = nav.ids.indexOf(id);
    if (index < 0) return null;
    return {
      prev: index > 0 ? nav.ids[index - 1] : null,
      next: index < nav.ids.length - 1 ? nav.ids[index + 1] : null,
      index,
      total: nav.ids.length,
      label: nav.label,
    };
  }

  private write(storage: Storage, key: string, value: unknown): void {
    try { storage.setItem(key, JSON.stringify(value)); } catch { /* almacenamiento no disponible */ }
  }

  private read<T>(storage: Storage, key: string): T | null {
    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }
}
