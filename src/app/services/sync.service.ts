import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WisphubService } from './wisphub.service';
import { LocalDbService } from './local-db.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class SyncService {
  private http = inject(HttpClient);
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private toast = inject(ToastService);

  syncing = signal(false);
  syncMessage = signal('');

  private readonly STALE_HOURS = 4;

  async syncIfStale() {
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

  syncAll() {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.syncMessage.set('Sincronizando clientes...');

    this.api.getAllClients().subscribe({
      next: async (clients) => {
        // Guardar en IndexedDB local
        await this.db.saveClients(clients);
        await this.db.updateSyncLog('clients');

        // Tambien guardar en server DB (SQLite/Postgres)
        this.http.post('/db/sync/clients', { clients }).subscribe({ error: () => {} });

        this.syncMessage.set('Sincronizando facturas...');
        this.api.getAllInvoices().subscribe({
          next: async (invoices) => {
            await this.db.saveInvoices(invoices);
            await this.db.updateSyncLog('invoices');

            // Tambien al server DB
            this.http.post('/db/sync/invoices', { invoices }).subscribe({ error: () => {} });

            this.syncing.set(false);
            this.toast.success(`Sincronizado: ${clients.length} clientes, ${invoices.length} facturas`);
          },
          error: () => {
            this.syncing.set(false);
            this.toast.error('Error al sincronizar facturas');
          }
        });
      },
      error: (err) => {
        this.syncing.set(false);
        this.toast.error('Error: ' + (err.error?.detail || 'Sin conexion'));
      }
    });
  }
}
