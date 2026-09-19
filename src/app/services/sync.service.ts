import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom, timeout } from 'rxjs';
import { LocalDbService } from './local-db.service';
import { ToastService } from './toast.service';
import { AuthService } from './auth.service';

export interface ServerSyncStatus {
  running: boolean;
  intervalMs: number;
  lastSyncAt: string | null;
  lastSyncResult: {
    at: string;
    durationMs: number;
    wisphub: number;
    mikrotik: number;
    updated: number;
    invoices: number;
    errors: number;
    missingFromWisphub: number;
    status: 'success' | 'partial' | 'error';
    sources: { wisphub: string; invoices: string; mikrotik: string };
    sourceErrors: string[];
  } | null;
}

@Injectable({ providedIn: 'root' })
export class SyncService {
  private http = inject(HttpClient);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);
  private auth = inject(AuthService);

  syncing = signal(false);
  syncMessage = signal('');

  private readonly STALE_HOURS = 4;

  async syncIfStale() {
    if (!this.auth.getToken()) return;

    const lastSync = await this.db.getLastSync('clients');
    if (!lastSync) {
      this.syncAll();
      return;
    }
    const hours = (Date.now() - new Date(lastSync).getTime()) / (1000 * 60 * 60);
    if (hours >= this.STALE_HOURS) {
      this.syncAll();
    }
  }

  async syncAll() {
    if (this.syncing()) return;
    if (!this.auth.getToken()) return;

    this.syncing.set(true);
    this.syncMessage.set('Actualizando datos desde WispHub y MikroTik...');
    try {
      try {
        await firstValueFrom(this.runServerSync().pipe(timeout(180_000)));
      } catch (error: any) {
        // El ciclo automatico puede estar ejecutandose. En ese caso se usa el ultimo
        // estado consistente ya confirmado en SQLite, sin reemplazarlo con una lista parcial.
        if (error?.status !== 409) throw error;
      }

      this.syncMessage.set('Recargando datos guardados...');
      const [clients, invoices] = await Promise.all([
        this.db.getClients(true),
        this.db.getInvoices(true),
      ]);
      await this.db.updateSyncLog('clients');
      await this.db.updateSyncLog('invoices');
      this.toast.success(`Sincronizado: ${clients.length} clientes, ${invoices.length} facturas`);
    } catch (err: any) {
      this.toast.error('No se pudo sincronizar: ' + (err?.error?.error || err?.error?.detail || (err?.status === 0 ? 'el servidor no responde' : err?.message) || 'sin conexión'));
    } finally {
      this.syncing.set(false);
      this.syncMessage.set('');
    }
  }

  getServerStatus(): Observable<ServerSyncStatus> {
    return this.http.get<ServerSyncStatus>('/sync/status');
  }

  runServerSync(): Observable<ServerSyncStatus['lastSyncResult']> {
    return this.http.post<ServerSyncStatus['lastSyncResult']>('/sync/run', {});
  }
}
