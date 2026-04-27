import { Injectable } from '@angular/core';

export interface SpeedResult {
  clientId?: number;
  clientName?: string;
  clientIp?: string;
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  jitterMs: number;
  timestamp: string;
  server?: string;
}

export interface PingHistory {
  clientId: number;
  timestamp: string;
  status: 'online' | 'offline';
  successCount: number;
  totalAttempts: number;
}

@Injectable({ providedIn: 'root' })
export class BandwidthService {
  private readonly SPEED_KEY = 'wishub_speed_history';
  private readonly PING_KEY = 'wishub_ping_history';

  /** Test real con archivos de descarga/subida */
  async runSpeedTest(onProgress?: (phase: string, pct: number) => void): Promise<SpeedResult> {
    const result: SpeedResult = {
      downloadMbps: 0,
      uploadMbps: 0,
      pingMs: 0,
      jitterMs: 0,
      timestamp: new Date().toISOString(),
    };

    // 1. PING test - 10 requests to a fast CDN
    onProgress?.('Midiendo latencia...', 10);
    const pings: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      try {
        await fetch(`https://www.cloudflare.com/cdn-cgi/trace?_=${Date.now()}`, { cache: 'no-store' });
        pings.push(performance.now() - t0);
      } catch {}
    }
    if (pings.length > 0) {
      pings.sort((a, b) => a - b);
      result.pingMs = pings[Math.floor(pings.length / 2)];
      // Jitter = desv std
      const mean = pings.reduce((a, b) => a + b, 0) / pings.length;
      const variance = pings.reduce((s, p) => s + (p - mean) ** 2, 0) / pings.length;
      result.jitterMs = Math.sqrt(variance);
    }

    // 2. DOWNLOAD test - descargar archivos de tamaño progresivo
    onProgress?.('Midiendo descarga...', 40);
    result.downloadMbps = await this.measureDownload(onProgress);

    // 3. UPLOAD test - subir datos
    onProgress?.('Midiendo subida...', 80);
    result.uploadMbps = await this.measureUpload(onProgress);

    onProgress?.('Completado', 100);
    return result;
  }

  private async measureDownload(onProgress?: (phase: string, pct: number) => void): Promise<number> {
    // Usa Cloudflare speed test endpoint: descarga 25MB
    const sizes = [1000000, 5000000, 10000000, 25000000]; // 1MB, 5MB, 10MB, 25MB
    let bestSpeed = 0;

    for (const size of sizes) {
      try {
        const t0 = performance.now();
        const response = await fetch(`https://speed.cloudflare.com/__down?bytes=${size}&_=${Date.now()}`, {
          cache: 'no-store'
        });
        await response.arrayBuffer();
        const elapsed = (performance.now() - t0) / 1000; // sec
        const mbps = (size * 8) / (elapsed * 1_000_000);
        if (mbps > bestSpeed) bestSpeed = mbps;

        const pct = 40 + (sizes.indexOf(size) + 1) * 10;
        onProgress?.(`Descarga: ${mbps.toFixed(1)} Mbps`, pct);

        // Si ya tiene buena medicion, no descargamos mas grande
        if (elapsed > 3) break;
      } catch {
        break;
      }
    }

    return bestSpeed;
  }

  private async measureUpload(onProgress?: (phase: string, pct: number) => void): Promise<number> {
    // Sube un blob aleatorio
    const sizes = [500000, 2000000, 5000000]; // 500KB, 2MB, 5MB
    let bestSpeed = 0;

    for (const size of sizes) {
      try {
        const data = new Uint8Array(size);
        for (let i = 0; i < size; i += 256) data[i] = Math.floor(Math.random() * 256);
        const blob = new Blob([data]);

        const t0 = performance.now();
        await fetch(`https://speed.cloudflare.com/__up?_=${Date.now()}`, {
          method: 'POST',
          body: blob,
          cache: 'no-store',
        });
        const elapsed = (performance.now() - t0) / 1000;
        const mbps = (size * 8) / (elapsed * 1_000_000);
        if (mbps > bestSpeed) bestSpeed = mbps;

        const pct = 80 + (sizes.indexOf(size) + 1) * 5;
        onProgress?.(`Subida: ${mbps.toFixed(1)} Mbps`, pct);

        if (elapsed > 3) break;
      } catch {
        break;
      }
    }

    return bestSpeed;
  }

  // ─── HISTORY PERSISTENCE ───

  saveSpeedResult(result: SpeedResult) {
    const history = this.getSpeedHistory();
    history.unshift(result);
    // Keep last 500
    const trimmed = history.slice(0, 500);
    localStorage.setItem(this.SPEED_KEY, JSON.stringify(trimmed));
  }

  getSpeedHistory(): SpeedResult[] {
    try { return JSON.parse(localStorage.getItem(this.SPEED_KEY) || '[]'); }
    catch { return []; }
  }

  getClientSpeedHistory(clientId: number): SpeedResult[] {
    return this.getSpeedHistory().filter(r => r.clientId === clientId);
  }

  clearSpeedHistory() {
    localStorage.removeItem(this.SPEED_KEY);
  }

  savePingResult(p: PingHistory) {
    const history = this.getPingHistory();
    history.unshift(p);
    const trimmed = history.slice(0, 2000);
    localStorage.setItem(this.PING_KEY, JSON.stringify(trimmed));
  }

  getPingHistory(): PingHistory[] {
    try { return JSON.parse(localStorage.getItem(this.PING_KEY) || '[]'); }
    catch { return []; }
  }

  getClientPingHistory(clientId: number): PingHistory[] {
    return this.getPingHistory().filter(p => p.clientId === clientId);
  }

  getClientUptime(clientId: number, days = 7): number {
    const history = this.getClientPingHistory(clientId);
    const cutoff = Date.now() - days * 86400000;
    const relevant = history.filter(p => new Date(p.timestamp).getTime() > cutoff);
    if (relevant.length === 0) return 0;
    const online = relevant.filter(p => p.status === 'online').length;
    return (online / relevant.length) * 100;
  }
}
