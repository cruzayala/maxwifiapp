import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ToastService } from '../../services/toast.service';

interface Conversation {
  phone: string;
  clientName: string | null;
  idServicio: number | null;
  messageCount: number;
  lastMessage: string;
  lastAt: string;
  messages: { type: string; message: string; at: string }[];
}

interface BotStatus {
  enabled: boolean;
  waConnected: boolean;
  stats: { incoming: number; outgoing: number };
}

@Component({
  selector: 'app-whatsapp-bot',
  standalone: true,
  imports: [NavbarComponent, FormsModule],
  template: `
    <app-navbar pageTitle="Bot WhatsApp" />

    <div class="page">
      <!-- STATUS -->
      <div class="status-card" [class.active]="status().enabled && status().waConnected">
        <div class="status-left">
          <div class="status-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/></svg>
          </div>
          <div>
            <h3>Bot WhatsApp {{ status().enabled ? 'Activo' : 'Inactivo' }}</h3>
            <p class="sub">
              @if (!status().waConnected) {
                WhatsApp no conectado - conectalo primero en /whatsapp
              } @else if (status().enabled) {
                Respondiendo automaticamente a clientes
              } @else {
                Activa el switch para que el bot empiece a responder
              }
            </p>
          </div>
        </div>
        <label class="toggle">
          <input type="checkbox" [checked]="status().enabled" (change)="toggle()" [disabled]="!status().waConnected" />
          <span class="slider"></span>
        </label>
      </div>

      <!-- STATS -->
      <div class="stats-row">
        <div class="stat">
          <span class="stat-value">{{ status().stats.incoming }}</span>
          <span class="stat-label">Mensajes recibidos</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ status().stats.outgoing }}</span>
          <span class="stat-label">Respuestas enviadas</span>
        </div>
        <div class="stat">
          <span class="stat-value">{{ conversations().length }}</span>
          <span class="stat-label">Conversaciones</span>
        </div>
      </div>

      <!-- COMMANDS INFO -->
      <div class="card">
        <h3>Comandos disponibles</h3>
        <p class="help">Los clientes envian estas palabras por WhatsApp y el bot responde automaticamente. Soporta variaciones (ej: "deuda" = "saldo").</p>
        <div class="commands-grid">
          <div class="cmd"><strong>menu</strong> / ayuda / hola<br><span>Lista de comandos</span></div>
          <div class="cmd"><strong>saldo</strong> / deuda / balance<br><span>Saldo y estado</span></div>
          <div class="cmd"><strong>plan</strong> / servicio<br><span>Plan contratado</span></div>
          <div class="cmd"><strong>factura</strong> / recibo<br><span>Ultima factura</span></div>
          <div class="cmd"><strong>pagar</strong> / pago<br><span>Metodos de pago</span></div>
          <div class="cmd"><strong>info</strong> / mi cuenta<br><span>Datos del cliente</span></div>
          <div class="cmd"><strong>soporte</strong> / averia<br><span>Reporta problema</span></div>
          <div class="cmd"><strong>velocidad</strong> / test<br><span>Info de velocidad</span></div>
        </div>
      </div>

      <!-- CONVERSATIONS -->
      <div class="conversations-section">
        <div class="conv-list">
          <div class="conv-header">
            <h3>Conversaciones recientes</h3>
            <button class="btn-refresh" (click)="loadConversations()">Refrescar</button>
          </div>
          @if (conversations().length === 0) {
            <p class="empty">No hay conversaciones aun. Cuando un cliente escriba al WhatsApp aparecera aqui.</p>
          }
          @for (c of conversations(); track c.phone) {
            <div class="conv-item" [class.selected]="selectedPhone() === c.phone" (click)="selectConversation(c.phone)">
              <div class="conv-info">
                <strong>{{ c.clientName || c.phone }}</strong>
                <span class="conv-phone">{{ c.phone }}</span>
              </div>
              <div class="conv-meta">
                <span class="conv-count">{{ c.messageCount }} msj</span>
                <span class="conv-time">{{ formatTime(c.lastAt) }}</span>
              </div>
            </div>
          }
        </div>

        @if (selectedPhone()) {
          <div class="conv-detail">
            <div class="conv-detail-head">
              <h3>Conversacion con {{ selectedConvName() }}</h3>
              <span>{{ selectedPhone() }}</span>
            </div>
            <div class="messages">
              @for (m of selectedMessages(); track m.id) {
                <div class="msg" [class.outgoing]="isOutgoing(m.messageType)">
                  <div class="msg-bubble">{{ stripPrefix(m.message) }}</div>
                  <div class="msg-time">{{ formatTime(m.createdAt) }} - {{ m.messageType }}</div>
                </div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; }

    .status-card {
      display: flex; justify-content: space-between; align-items: center;
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 20px 24px; margin-bottom: 16px; gap: 16px;
    }
    .status-card.active { border-left: 4px solid #22c55e; background: linear-gradient(135deg, white, #f0fdf4); }
    .status-left { display: flex; gap: 16px; align-items: center; flex: 1; }
    .status-icon {
      width: 52px; height: 52px; border-radius: 14px;
      background: #dcfce7; color: #16a34a;
      display: flex; align-items: center; justify-content: center;
    }
    .status-card h3 { margin: 0 0 4px; font-size: 16px; color: #0f172a; }
    .status-card .sub { margin: 0; font-size: 13px; color: #64748b; }

    .toggle { position: relative; display: inline-block; width: 56px; height: 30px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; inset: 0;
      background: #cbd5e1; transition: 0.3s; border-radius: 30px;
    }
    .slider:before {
      position: absolute; content: ''; height: 22px; width: 22px;
      left: 4px; bottom: 4px; background: white; transition: 0.3s; border-radius: 50%;
    }
    .toggle input:checked + .slider { background: #22c55e; }
    .toggle input:checked + .slider:before { transform: translateX(26px); }
    .toggle input:disabled + .slider { opacity: 0.5; cursor: not-allowed; }

    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat {
      background: white; border: 1px solid #e2e8f0; border-radius: 12px;
      padding: 14px 18px;
    }
    .stat-value { display: block; font-size: 24px; font-weight: 800; color: #0f172a; }
    .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 600; }

    .card {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      padding: 20px 24px; margin-bottom: 16px;
    }
    .card h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: #0f172a; }
    .help { font-size: 13px; color: #64748b; margin: 0 0 16px; }

    .commands-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
    .cmd {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px;
      padding: 10px 14px; font-size: 13px;
    }
    .cmd strong { color: #6366f1; }
    .cmd span { color: #64748b; font-size: 12px; }

    .conversations-section { display: grid; grid-template-columns: 360px 1fr; gap: 12px; }
    @media (max-width: 768px) { .conversations-section { grid-template-columns: 1fr; } }

    .conv-list, .conv-detail {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px;
      overflow: hidden;
    }
    .conv-header, .conv-detail-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
    }
    .conv-header h3, .conv-detail-head h3 { margin: 0; font-size: 14px; }
    .conv-detail-head span { font-size: 11px; color: #94a3b8; font-family: monospace; }

    .btn-refresh {
      padding: 4px 12px; border: 1px solid #e2e8f0; border-radius: 6px;
      background: white; color: #6366f1; font-size: 11px; cursor: pointer; font-weight: 500;
    }
    .btn-refresh:hover { background: #6366f1; color: white; }

    .empty { padding: 30px; text-align: center; color: #94a3b8; font-size: 13px; }

    .conv-item {
      display: flex; justify-content: space-between; padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.15s;
    }
    .conv-item:hover { background: #f8fafc; }
    .conv-item.selected { background: #eef2ff; border-left: 3px solid #6366f1; }
    .conv-info strong { display: block; font-size: 13px; color: #0f172a; }
    .conv-phone { font-size: 11px; color: #94a3b8; font-family: monospace; }
    .conv-meta { text-align: right; }
    .conv-count { display: block; font-size: 11px; color: #6366f1; font-weight: 600; }
    .conv-time { font-size: 10px; color: #94a3b8; }

    .messages { padding: 16px; max-height: 600px; overflow-y: auto; background: #fafbfc; }
    .msg { margin-bottom: 12px; }
    .msg-bubble {
      display: inline-block; max-width: 75%;
      padding: 10px 14px; border-radius: 14px;
      background: white; border: 1px solid #e2e8f0;
      font-size: 13px; line-height: 1.4; white-space: pre-wrap; word-break: break-word;
    }
    .msg.outgoing { text-align: right; }
    .msg.outgoing .msg-bubble {
      background: #dcfce7; border-color: #bbf7d0; color: #14532d;
    }
    .msg-time { font-size: 10px; color: #94a3b8; margin-top: 2px; padding: 0 4px; }
  `]
})
export class WhatsappBotComponent implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private toast = inject(ToastService);

  status = signal<BotStatus>({ enabled: false, waConnected: false, stats: { incoming: 0, outgoing: 0 } });
  conversations = signal<Conversation[]>([]);
  selectedPhone = signal<string | null>(null);
  selectedMessages = signal<any[]>([]);

  private refreshInterval: any;

  ngOnInit() {
    this.loadStatus();
    this.loadConversations();
    this.refreshInterval = setInterval(() => {
      this.loadStatus();
      this.loadConversations();
      if (this.selectedPhone()) this.loadMessages(this.selectedPhone()!);
    }, 15000);
  }

  ngOnDestroy() {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  loadStatus() {
    this.http.get<BotStatus>('/wa/bot/status').subscribe({
      next: (s) => this.status.set(s),
      error: () => {},
    });
  }

  loadConversations() {
    this.http.get<Conversation[]>('/wa/bot/conversations').subscribe({
      next: (c) => this.conversations.set(c),
      error: () => {},
    });
  }

  toggle() {
    const newState = !this.status().enabled;
    this.http.post('/wa/bot/toggle', { enabled: newState }).subscribe({
      next: () => {
        this.toast.success(newState ? 'Bot activado' : 'Bot desactivado');
        this.loadStatus();
      },
      error: () => this.toast.error('Error al cambiar estado'),
    });
  }

  selectConversation(phone: string) {
    this.selectedPhone.set(phone);
    this.loadMessages(phone);
  }

  loadMessages(phone: string) {
    this.http.get<any[]>(`/wa/bot/conversation/${phone}`).subscribe({
      next: (msgs) => this.selectedMessages.set(msgs),
      error: () => {},
    });
  }

  selectedConvName(): string {
    const phone = this.selectedPhone();
    if (!phone) return '';
    const c = this.conversations().find(c => c.phone === phone);
    return c?.clientName || phone;
  }

  isOutgoing(type: string): boolean {
    return type?.startsWith('bot_') || type === 'sent';
  }

  stripPrefix(message: string): string {
    return message.replace(/^[<>]\s*/, '');
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const diff = (today.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return Math.floor(diff / 60) + 'm';
    if (diff < 86400) return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' });
  }
}
