import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ClientMetric } from '../models/metrics.model';

@Injectable({ providedIn: 'root' })
export class MetricsService {
  private http = inject(HttpClient);

  metricsByClient = signal<Map<number, ClientMetric>>(new Map());
  loading = signal(false);
  lastLoadAt = signal<Date | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;

  loadAll(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.http.get<ClientMetric[]>('/metrics/all/list').subscribe({
      next: (rows) => {
        const map = new Map<number, ClientMetric>();
        for (const r of rows) map.set(r.idServicio, r);
        this.metricsByClient.set(map);
        this.lastLoadAt.set(new Date());
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  startAutoRefresh(intervalMs = 30000): void {
    if (this.timer) return;
    this.loadAll();
    this.timer = setInterval(() => this.loadAll(), intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  get(idServicio: number): ClientMetric | null {
    return this.metricsByClient().get(idServicio) ?? null;
  }
}
