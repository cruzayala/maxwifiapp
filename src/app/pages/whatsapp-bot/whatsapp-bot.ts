import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideBot, LucideChevronRight, LucideMessageCircle, LucideRefreshCw, LucideX } from '@lucide/angular';
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
  imports: [NavbarComponent, FormsModule, RouterLink, LucideBot, LucideChevronRight, LucideMessageCircle, LucideRefreshCw, LucideX],
  template: `
    <app-navbar pageTitle="Bot de WhatsApp" />

    <div class="page">
      <!-- ESTADO -->
      <div class="status-card" [class.active]="status().enabled && status().waConnected" [class.warn]="!status().waConnected">
        <div class="status-left">
          <div class="status-icon" aria-hidden="true">
            <svg lucideBot size="26"></svg>
          </div>
          <div>
            <h3>Bot de WhatsApp
              <span class="state-pill" [class.on]="status().enabled && status().waConnected">
                <i class="dot"></i>{{ status().enabled ? (status().waConnected ? 'Activo' : 'Activo, sin conexión') : 'Apagado' }}
              </span>
            </h3>
            <p class="sub">
              @if (!status().waConnected) {
                WhatsApp no está conectado. El bot no puede responder hasta que conectes WhatsApp.
              } @else if (status().enabled) {
                Respondiendo automáticamente a los clientes que escriben.
              } @else {
                Activa el interruptor para que el bot empiece a responder.
              }
            </p>
          </div>
        </div>
        @if (!status().waConnected) {
          <a routerLink="/whatsapp" class="btn-link">Ir a conectar WhatsApp <svg lucideChevronRight size="14"></svg></a>
        } @else {
          <label class="toggle-wrap" [title]="status().enabled ? 'Apagar el bot' : 'Encender el bot'">
            <span class="toggle-text">{{ status().enabled ? 'Encendido' : 'Apagado' }}</span>
            <span class="toggle">
              <input type="checkbox" role="switch" [checked]="status().enabled" (change)="toggle()"
                [attr.aria-checked]="status().enabled" aria-label="Encender o apagar el bot" />
              <span class="slider"></span>
            </span>
          </label>
        }
      </div>

      <!-- ESTADÍSTICAS -->
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

      <!-- COMANDOS -->
      <div class="card">
        <h3>Palabras que entiende el bot</h3>
        <p class="help">Los clientes escriben una de estas palabras por WhatsApp y el bot responde automáticamente. También entiende variaciones (por ejemplo, “deuda” funciona igual que “saldo”).</p>
        <div class="commands-grid">
          <div class="cmd"><strong>menu</strong> / ayuda / hola<span>Lista de opciones</span></div>
          <div class="cmd"><strong>saldo</strong> / deuda / balance<span>Saldo y estado de la cuenta</span></div>
          <div class="cmd"><strong>plan</strong> / servicio<span>Plan contratado</span></div>
          <div class="cmd"><strong>factura</strong> / recibo<span>Última factura</span></div>
          <div class="cmd"><strong>pagar</strong> / pago<span>Formas de pago</span></div>
          <div class="cmd"><strong>info</strong> / mi cuenta<span>Datos del cliente</span></div>
          <div class="cmd"><strong>soporte</strong> / averia<span>Reportar un problema</span></div>
          <div class="cmd"><strong>velocidad</strong> / test<span>Información de velocidad</span></div>
        </div>
      </div>

      <!-- CONVERSACIONES -->
      <div class="conversations-section">
        <div class="conv-list">
          <div class="conv-header">
            <h3>Conversaciones recientes</h3>
            <button type="button" class="btn-refresh" (click)="loadConversations()" title="Actualizar la lista">
              <svg lucideRefreshCw size="13"></svg> Actualizar
            </button>
          </div>
          <div class="conv-scroll">
            @for (c of conversations(); track c.phone) {
              <button type="button" class="conv-item" [class.selected]="selectedPhone() === c.phone" (click)="selectConversation(c.phone)">
                <div class="conv-info">
                  <strong>{{ c.clientName || c.phone }}</strong>
                  <span class="conv-phone">{{ c.clientName ? c.phone : 'Número no registrado' }}</span>
                </div>
                <div class="conv-meta">
                  <span class="conv-count">{{ c.messageCount }} {{ c.messageCount === 1 ? 'mensaje' : 'mensajes' }}</span>
                  <span class="conv-time">{{ formatTime(c.lastAt) }}</span>
                </div>
              </button>
            } @empty {
              <p class="empty">No hay conversaciones todavía. Cuando un cliente escriba al WhatsApp del negocio, aparecerá aquí.</p>
            }
          </div>
        </div>

        @if (selectedPhone()) {
          <div class="conv-detail">
            <div class="conv-detail-head">
              <div>
                <h3>Conversación con {{ selectedConvName() }}</h3>
                <span>{{ selectedPhone() }}</span>
              </div>
              <button type="button" class="btn-close" aria-label="Cerrar conversación" title="Cerrar conversación" (click)="selectedPhone.set(null)">
                <svg lucideX size="16"></svg>
              </button>
            </div>
            <div class="messages">
              @for (m of selectedMessages(); track m.id) {
                <div class="msg" [class.outgoing]="isOutgoing(m.messageType)">
                  <div class="msg-bubble">{{ stripPrefix(m.message) }}</div>
                  <div class="msg-time">{{ formatTime(m.createdAt) }} · {{ typeLabel(m.messageType) }}</div>
                </div>
              } @empty {
                <p class="empty">Cargando mensajes…</p>
              }
            </div>
          </div>
        } @else if (conversations().length) {
          <div class="conv-detail placeholder">
            <svg lucideMessageCircle size="28"></svg>
            <p>Selecciona una conversación para ver los mensajes.</p>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px; }

    .status-card {
      display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap;
      background: white; border: 1px solid #dfe5ea; border-left: 4px solid #ccd6de; border-radius: 8px;
      padding: 18px 22px; margin-bottom: 16px; gap: 16px;
    }
    .status-card.active { border-left-color: #13875a; }
    .status-card.warn { border-left-color: #b36b12; }
    .status-left { display: flex; gap: 14px; align-items: center; flex: 1; min-width: 240px; }
    .status-icon {
      width: 48px; height: 48px; border-radius: 8px; flex-shrink: 0;
      background: #edf4ff; color: #1267dd;
      display: flex; align-items: center; justify-content: center;
    }
    .status-card.active .status-icon { background: #e9f8f1; color: #13875a; }
    .status-card.warn .status-icon { background: #fff6e8; color: #b36b12; }
    .status-card h3 { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0 0 4px; font-size: 16px; color: #172535; }
    .status-card .sub { margin: 0; font-size: 13px; color: #667582; }
    .state-pill {
      display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600;
      padding: 2px 9px; border-radius: 999px; background: #f1f4f7; color: #667582;
    }
    .state-pill.on { background: #e9f8f1; color: #13875a; }
    .state-pill .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

    .btn-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 6px;
      background: #1267dd; color: white; font-size: 13px; font-weight: 600; text-decoration: none;
    }
    .btn-link:hover { background: #0d58c0; }

    .toggle-wrap { display: inline-flex; align-items: center; gap: 10px; cursor: pointer; }
    .toggle-text { font-size: 13px; font-weight: 600; color: #334250; }
    .toggle { position: relative; display: inline-block; width: 52px; height: 28px; }
    .toggle input { opacity: 0; width: 0; height: 0; }
    .slider {
      position: absolute; cursor: pointer; inset: 0;
      background: #ccd6de; transition: 0.2s; border-radius: 28px;
    }
    .slider:before {
      position: absolute; content: ''; height: 20px; width: 20px;
      left: 4px; bottom: 4px; background: white; transition: 0.2s; border-radius: 50%;
    }
    .toggle input:checked + .slider { background: #13875a; }
    .toggle input:checked + .slider:before { transform: translateX(24px); }
    .toggle input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.25); }

    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 14px 18px; }
    .stat-value { display: block; font-size: 22px; font-weight: 800; color: #172535; }
    .stat-label { font-size: 12px; color: #667582; font-weight: 600; }

    .card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 18px 22px; margin-bottom: 16px; }
    .card h3 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: #172535; }
    .help { font-size: 13px; color: #667582; margin: 0 0 14px; line-height: 1.5; }

    .commands-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; }
    .cmd { background: #f8fafc; border: 1px solid #dfe5ea; border-radius: 6px; padding: 10px 12px; font-size: 13px; color: #334250; }
    .cmd strong { color: #1267dd; }
    .cmd span { display: block; margin-top: 3px; color: #667582; font-size: 12px; }

    .conversations-section { display: grid; grid-template-columns: 340px 1fr; gap: 12px; align-items: start; }

    .conv-list, .conv-detail { background: white; border: 1px solid #dfe5ea; border-radius: 8px; overflow: hidden; min-width: 0; }
    .conv-scroll { max-height: 600px; overflow-y: auto; }
    .conv-header, .conv-detail-head {
      display: flex; justify-content: space-between; align-items: center; gap: 10px;
      padding: 12px 16px; border-bottom: 1px solid #f0f3f6;
    }
    .conv-header h3, .conv-detail-head h3 { margin: 0; font-size: 14px; color: #172535; }
    .conv-detail-head span { font-size: 12px; color: #667582; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }

    .btn-refresh {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border: 1px solid #ccd6de; border-radius: 6px;
      background: white; color: #1267dd; font-size: 12px; cursor: pointer; font-weight: 600;
    }
    .btn-refresh:hover { background: #edf4ff; border-color: #1267dd; }
    .btn-close { display: grid; place-items: center; background: none; border: none; color: #667582; padding: 6px; border-radius: 6px; cursor: pointer; }
    .btn-close:hover { background: #f2f7ff; color: #172535; }

    .empty { padding: 28px 20px; text-align: center; color: #667582; font-size: 13px; margin: 0; }

    .conv-item {
      display: flex; justify-content: space-between; gap: 10px; width: 100%; text-align: left;
      padding: 11px 16px; border: none; border-bottom: 1px solid #f0f3f6; border-left: 3px solid transparent;
      background: white; cursor: pointer; transition: background 0.15s; font: inherit;
    }
    .conv-item:hover { background: #f8fafc; }
    .conv-item.selected { background: #f2f7ff; border-left-color: #1267dd; }
    .conv-info { min-width: 0; }
    .conv-info strong { display: block; font-size: 13px; color: #172535; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .conv-phone { font-size: 11px; color: #667582; }
    .conv-meta { text-align: right; flex-shrink: 0; }
    .conv-count { display: block; font-size: 11px; color: #1267dd; font-weight: 600; }
    .conv-time { font-size: 12px; color: #667582; }

    .conv-detail.placeholder {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
      min-height: 200px; color: #667582; font-size: 13px; text-align: center; padding: 20px;
    }
    .conv-detail.placeholder p { margin: 0; }

    .messages { padding: 16px; max-height: 600px; overflow-y: auto; background: #f8fafc; }
    .msg { margin-bottom: 12px; }
    .msg-bubble {
      display: inline-block; max-width: 80%; text-align: left;
      padding: 9px 13px; border-radius: 8px;
      background: white; border: 1px solid #dfe5ea; color: #334250;
      font-size: 13px; line-height: 1.45; white-space: pre-wrap; word-break: break-word;
    }
    .msg.outgoing { text-align: right; }
    .msg.outgoing .msg-bubble { background: #e9f8f1; border-color: #bfe6d3; color: #0d4a33; }
    .msg-time { font-size: 11px; color: #667582; margin-top: 3px; padding: 0 4px; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .conversations-section { grid-template-columns: 1fr; }
      .conv-detail.placeholder { display: none; }
      .stats-row { gap: 8px; }
      .stat { padding: 12px; }
      .stat-value { font-size: 20px; }
    }
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
      error: () => {
        this.toast.error('No se pudo cambiar el estado del bot. Intenta de nuevo.');
        this.loadStatus();
      },
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

  /** Etiqueta legible del tipo de mensaje (solo visual). */
  typeLabel(type: string): string {
    if (!type) return '';
    if (type === 'incoming') return 'Cliente';
    if (type.startsWith('bot_')) return 'Respuesta del bot';
    const labels: Record<string, string> = {
      manual: 'Enviado a mano', reminder: 'Recordatorio', overdue: 'Aviso de atraso',
      template: 'Plantilla', bulk: 'Envío masivo', invoice: 'Factura', sent: 'Enviado',
    };
    return labels[type] || type;
  }

  stripPrefix(message: string): string {
    return message.replace(/^[<>]\s*/, '');
  }

  formatTime(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    const diff = (today.getTime() - d.getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return 'hace ' + Math.floor(diff / 60) + ' min';
    if (diff < 86400) return d.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('es-DO', { day: '2-digit', month: '2-digit' });
  }
}
