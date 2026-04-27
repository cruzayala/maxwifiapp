import { Injectable } from '@angular/core';
import { WispHubClient } from '../models/client.model';
import { Invoice } from '../models/invoice.model';
import { Ticket } from '../models/ticket.model';

@Injectable({ providedIn: 'root' })
export class LocalDbService {
  private db!: IDBDatabase;
  private readonly DB_NAME = 'WishubDB';
  private readonly DB_VERSION = 1;
  private initPromise: Promise<void> | null = null;

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private _doInit(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('clients')) {
          const clientStore = db.createObjectStore('clients', { keyPath: 'id_servicio' });
          clientStore.createIndex('nombre', 'nombre', { unique: false });
          clientStore.createIndex('estado', 'estado', { unique: false });
          clientStore.createIndex('zona', 'zona', { unique: false });
        }

        if (!db.objectStoreNames.contains('invoices')) {
          const invoiceStore = db.createObjectStore('invoices', { keyPath: 'id_factura' });
          invoiceStore.createIndex('id_servicio', 'id_servicio', { unique: false });
          invoiceStore.createIndex('estado', 'estado', { unique: false });
        }

        if (!db.objectStoreNames.contains('tickets')) {
          const ticketStore = db.createObjectStore('tickets', { keyPath: 'id_ticket' });
          ticketStore.createIndex('id_servicio', 'id_servicio', { unique: false });
          ticketStore.createIndex('estado', 'estado', { unique: false });
        }

        if (!db.objectStoreNames.contains('sync_log')) {
          db.createObjectStore('sync_log', { keyPath: 'entity' });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ─── GENERIC CRUD ───
  private putAll<T>(storeName: string, items: T[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      items.forEach(item => store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private getAll<T>(storeName: string): Promise<T[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private getByKey<T>(storeName: string, key: any): Promise<T | undefined> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private clearStore(storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ─── CLIENTS ───
  saveClients(clients: WispHubClient[]): Promise<void> {
    return this.putAll('clients', clients);
  }

  getClients(): Promise<WispHubClient[]> {
    return this.getAll('clients');
  }

  getClient(idServicio: number): Promise<WispHubClient | undefined> {
    return this.getByKey('clients', idServicio);
  }

  // ─── INVOICES ───
  saveInvoices(invoices: Invoice[]): Promise<void> {
    return this.putAll('invoices', invoices);
  }

  getInvoices(): Promise<Invoice[]> {
    return this.getAll('invoices');
  }

  // ─── TICKETS ───
  saveTickets(tickets: Ticket[]): Promise<void> {
    return this.putAll('tickets', tickets);
  }

  getTickets(): Promise<Ticket[]> {
    return this.getAll('tickets');
  }

  // ─── SYNC LOG ───
  async updateSyncLog(entity: string): Promise<void> {
    const tx = this.db.transaction('sync_log', 'readwrite');
    tx.objectStore('sync_log').put({ entity, lastSync: new Date().toISOString() });
  }

  async getLastSync(entity: string): Promise<string | null> {
    const record = await this.getByKey<{ entity: string; lastSync: string }>('sync_log', entity);
    return record?.lastSync ?? null;
  }
}
