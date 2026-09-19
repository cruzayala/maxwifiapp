import { Component, OnInit, inject, signal } from '@angular/core';
import { NavbarComponent } from '../../components/layout/navbar';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../environments/environment';
import { ConfigService } from '../../services/config.service';
import { NotificationSchedulerService } from '../../services/notification-scheduler.service';
import { ToastService } from '../../services/toast.service';
import { HttpClient } from '@angular/common/http';
import {
  LucideActivity, LucideBuilding2, LucideCircleCheck, LucideCopy, LucideDatabase, LucideDownload, LucideEye, LucideGlobe, LucideInfo, LucideMessageCircle, LucidePlay, LucideRefreshCw, LucideSave, LucideSend, LucideSmartphone, LucideWifi, LucideWrench,
} from '@lucide/angular';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    NavbarComponent, FormsModule,
    LucideActivity, LucideBuilding2, LucideCircleCheck, LucideCopy, LucideDatabase, LucideDownload, LucideEye, LucideGlobe, LucideInfo, LucideMessageCircle, LucidePlay, LucideRefreshCw, LucideSave, LucideSend, LucideSmartphone, LucideWifi, LucideWrench,
  ],
  template: `
    <app-navbar pageTitle="Configuración" />

    <div class="page">
      <div class="settings-grid">
        <!-- EMPRESA -->
        <div class="card full">
          <h3><svg lucideBuilding2 size="16"></svg> Datos de la empresa <small>Aparecen en los recibos y mensajes</small></h3>
          <div class="form-row">
            <div class="form-group">
              <label for="cfg-name">Nombre de la empresa</label>
              <input id="cfg-name" type="text" [(ngModel)]="config.companyName" (ngModelChange)="config.companyName.set($event)" class="form-input" />
            </div>
            <div class="form-group">
              <label for="cfg-slogan">Eslogan / descripción</label>
              <input id="cfg-slogan" type="text" [(ngModel)]="config.companySlogan" (ngModelChange)="config.companySlogan.set($event)" class="form-input" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label for="cfg-phone">Teléfono</label>
              <input id="cfg-phone" type="tel" [(ngModel)]="config.companyPhone" (ngModelChange)="config.companyPhone.set($event)" class="form-input" placeholder="809-000-0000" />
            </div>
            <div class="form-group">
              <label for="cfg-rnc">RNC / Cédula</label>
              <input id="cfg-rnc" type="text" [(ngModel)]="config.rnc" (ngModelChange)="config.rnc.set($event)" class="form-input" />
            </div>
          </div>
          <div class="form-group">
            <label for="cfg-address">Dirección</label>
            <input id="cfg-address" type="text" [(ngModel)]="config.companyAddress" (ngModelChange)="config.companyAddress.set($event)" class="form-input" />
          </div>
          <div class="form-group">
            <label>Tamaño de papel para recibos</label>
            <div class="paper-select" role="group" aria-label="Tamaño de papel">
              <button type="button" [class.active]="config.defaultPaperSize() === '58mm'" [attr.aria-pressed]="config.defaultPaperSize() === '58mm'" (click)="config.defaultPaperSize.set('58mm')">
                58 mm (pequeña)
              </button>
              <button type="button" [class.active]="config.defaultPaperSize() === '80mm'" [attr.aria-pressed]="config.defaultPaperSize() === '80mm'" (click)="config.defaultPaperSize.set('80mm')">
                80 mm (estándar)
              </button>
            </div>
          </div>
          <div class="actions-row">
            <button type="button" class="btn btn-primary" (click)="saveConfig()">
              <svg lucideSave size="16"></svg> Guardar datos
            </button>
            @if (saved()) {
              <span class="saved-msg"><svg lucideCircleCheck size="14"></svg> Guardado correctamente</span>
            }
          </div>
        </div>

        <!-- SALUD DEL SISTEMA -->
        <div class="card">
          <h3><svg lucideActivity size="16"></svg> Estado del sistema</h3>
          @if (opsHealth()) {
            <div class="health-grid">
              <div class="health-row">
                <span>Base de datos</span>
                <strong [class.ok]="opsHealth().database?.connected" [class.bad]="!opsHealth().database?.connected">
                  <i class="dot"></i>{{ opsHealth().database?.connected ? 'Conectada' : 'Con error' }}
                </strong>
              </div>
              <div class="health-row">
                <span>WispHub</span>
                <strong [class.ok]="opsHealth().wisphub?.configured" [class.bad]="!opsHealth().wisphub?.configured">
                  <i class="dot"></i>{{ opsHealth().wisphub?.configured ? 'Conectado' : 'Sin configurar' }}
                </strong>
              </div>
              <div class="health-row">
                <span>MikroTik</span>
                <strong [class.ok]="opsHealth().mikrotik?.connected" [class.bad]="!opsHealth().mikrotik?.connected">
                  <i class="dot"></i>{{ opsHealth().mikrotik?.connected ? 'Conectado' : 'Desconectado' }}
                </strong>
              </div>
              <div class="health-row">
                <span>WhatsApp</span>
                <strong [class.ok]="opsHealth().whatsapp?.status === 'connected'" [class.warn]="opsHealth().whatsapp?.status !== 'connected'">
                  <i class="dot"></i>{{ waStatusLabel(opsHealth().whatsapp?.status) }}
                </strong>
              </div>
              <div class="health-row">
                <span>Clientes / facturas</span>
                <strong>{{ opsHealth().counts?.clients || 0 }} / {{ opsHealth().counts?.invoices || 0 }}</strong>
              </div>
              <div class="health-row">
                <span>Encuestas / promesas de pago pendientes</span>
                <strong>{{ opsHealth().counts?.pendingSurveys || 0 }} / {{ opsHealth().counts?.pendingPromises || 0 }}</strong>
              </div>
            </div>

            @if (opsHealth().mikrotik?.captiveRules) {
              <div class="rules-box">
                <strong>Reglas del aviso de pago en el MikroTik</strong>
                <div class="rule-list">
                  <span [class.ok]="opsHealth().mikrotik.captiveRules.rules?.morosoRedirect?.ok" title="morosos-crm">{{ opsHealth().mikrotik.captiveRules.rules?.morosoRedirect?.ok ? '✓' : '✗' }} Aviso a morosos</span>
                  <span [class.ok]="opsHealth().mikrotik.captiveRules.rules?.bloqueadoRedirect?.ok" title="bloqueados-crm">{{ opsHealth().mikrotik.captiveRules.rules?.bloqueadoRedirect?.ok ? '✓' : '✗' }} Aviso a bloqueados</span>
                  <span [class.ok]="opsHealth().mikrotik.captiveRules.rules?.allowDns?.ok" title="allow DNS">{{ opsHealth().mikrotik.captiveRules.rules?.allowDns?.ok ? '✓' : '✗' }} Permitir DNS</span>
                  <span [class.ok]="opsHealth().mikrotik.captiveRules.rules?.allowCaptive?.ok" title="allow captive">{{ opsHealth().mikrotik.captiveRules.rules?.allowCaptive?.ok ? '✓' : '✗' }} Permitir página de aviso</span>
                  <span [class.ok]="opsHealth().mikrotik.captiveRules.rules?.dropRest?.ok" title="drop bloqueados">{{ opsHealth().mikrotik.captiveRules.rules?.dropRest?.ok ? '✓' : '✗' }} Cortar resto a bloqueados</span>
                </div>
              </div>
            }
          } @else {
            <p class="help-text">{{ opsBusy() ? 'Revisando el estado del sistema…' : 'Revisa si la base de datos, WispHub, el MikroTik y WhatsApp están funcionando.' }}</p>
          }
          <div class="actions-row">
            <button type="button" class="btn btn-primary" (click)="loadOpsHealth()" [disabled]="opsBusy()">
              <svg lucideRefreshCw size="15"></svg> {{ opsBusy() ? 'Revisando…' : 'Revisar ahora' }}
            </button>
            <button type="button" class="btn btn-warn" (click)="repairCaptiveRules()" [disabled]="opsBusy()" title="Vuelve a crear en el MikroTik las reglas que muestran el aviso de pago">
              <svg lucideWrench size="15"></svg> Reparar reglas del aviso
            </button>
          </div>
          @if (opsMessage()) {
            <p class="status-msg">{{ opsMessage() }}</p>
          }
        </div>

        <!-- BASE DE DATOS -->
        <div class="card">
          <h3><svg lucideDatabase size="16"></svg> Datos guardados</h3>
          <p class="help-text">Los datos se guardan de forma permanente en el servidor. Al sincronizar con WispHub se actualizan los registros existentes y se agregan los nuevos; no se borra nada.</p>
          <div class="db-info">
            <div class="db-stat">
              <span>Clientes guardados</span>
              <span class="db-val">{{ localClientsCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Facturas guardadas</span>
              <span class="db-val">{{ localInvoicesCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Direcciones IP registradas</span>
              <span class="db-val">{{ ipInventoryCount() }}</span>
            </div>
            <div class="db-stat">
              <span>Última sincronización</span>
              <span class="db-val">{{ lastSyncAt() || 'Nunca' }}</span>
            </div>
          </div>
          <div class="actions-row">
            <button type="button" class="btn btn-primary" (click)="downloadDatabaseBackup()" [disabled]="backupBusy()">
              <svg lucideDownload size="15"></svg> {{ backupBusy() ? 'Preparando…' : 'Descargar respaldo' }}
            </button>
            <button type="button" class="btn btn-outline" (click)="downloadAndroid()" [disabled]="androidBusy()">
              <svg lucideSmartphone size="15"></svg> {{ androidBusy() ? 'Descargando…' : 'App Android (versión preliminar)' }}
            </button>
          </div>
          <p class="help-text small-gap">Guarda el respaldo en un lugar seguro: contiene todos los datos de clientes y pagos.</p>
        </div>

        <!-- WHATSAPP AUTOMÁTICO -->
        <div class="card full">
          <h3><svg lucideMessageCircle size="16"></svg> Avisos automáticos por WhatsApp</h3>
          <p class="help-text">
            Envía mensajes automáticos a clientes con pago pendiente o cerca de la fecha de corte.
            Necesita que WhatsApp esté conectado.
          </p>

          <div class="toggle-row">
            <label class="switch">
              <input type="checkbox" role="switch" aria-label="Activar envío automático" [(ngModel)]="config.autoNotifEnabled" (ngModelChange)="config.autoNotifEnabled.set($event); saveConfig()" />
              <span class="slider"></span>
            </label>
            <div>
              <strong>Envío automático {{ config.autoNotifEnabled() ? 'activado' : 'apagado' }}</strong>
              <div class="sub-text">El sistema revisa cada 30 minutos si debe enviar mensajes. Se guarda al tocar el interruptor.</div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="cfg-hour">Hora del día para enviar (0 a 23)</label>
              <input id="cfg-hour" type="number" min="0" max="23" [(ngModel)]="config.autoNotifScheduleHour" (ngModelChange)="config.autoNotifScheduleHour.set(+$event)" class="form-input"
                [class.invalid]="!validHour(config.autoNotifScheduleHour())" />
              <span class="hint" [class.err]="!validHour(config.autoNotifScheduleHour())">{{ validHour(config.autoNotifScheduleHour()) ? 'Se enviará a las ' + formatHour(config.autoNotifScheduleHour()) + '.' : 'Escribe una hora entre 0 y 23.' }}</span>
            </div>
            <div class="form-group">
              <label for="cfg-days">Días antes del corte para recordar</label>
              <input id="cfg-days" type="number" min="1" max="10" [(ngModel)]="config.autoNotifReminderDays" (ngModelChange)="config.autoNotifReminderDays.set(+$event)" class="form-input" />
              <span class="hint">Entre 1 y 10 días.</span>
            </div>
          </div>

          <div class="form-group">
            <label for="cfg-rem-msg">Mensaje de recordatorio (antes del corte)</label>
            <textarea id="cfg-rem-msg" rows="3" [(ngModel)]="config.autoNotifReminderMsg" (ngModelChange)="config.autoNotifReminderMsg.set($event)" class="form-input"></textarea>
            <span class="hint">Datos que puedes insertar: <code>&#123;nombre&#125;</code> <code>&#123;empresa&#125;</code> <code>&#123;fecha_corte&#125;</code> <code>&#123;precio&#125;</code> <code>&#123;plan&#125;</code></span>
          </div>

          <div class="toggle-row">
            <label class="switch">
              <input type="checkbox" role="switch" aria-label="Enviar avisos a morosos" [(ngModel)]="config.autoNotifOverdueEnabled" (ngModelChange)="config.autoNotifOverdueEnabled.set($event); saveConfig()" />
              <span class="slider"></span>
            </label>
            <div>
              <strong>Avisar a clientes ya vencidos (morosos)</strong>
              <div class="sub-text">Se repite cada {{ config.autoNotifOverdueInterval() }} días mientras no pague.</div>
            </div>
          </div>

          <div class="form-group">
            <label for="cfg-interval">Cada cuántos días reenviar al moroso</label>
            <input id="cfg-interval" type="number" min="1" max="30" [(ngModel)]="config.autoNotifOverdueInterval" (ngModelChange)="config.autoNotifOverdueInterval.set(+$event)" class="form-input narrow" />
          </div>

          <div class="form-group">
            <label for="cfg-over-msg">Mensaje para morosos (ya vencido)</label>
            <textarea id="cfg-over-msg" rows="3" [(ngModel)]="config.autoNotifOverdueMsg" (ngModelChange)="config.autoNotifOverdueMsg.set($event)" class="form-input"></textarea>
            <span class="hint">Datos que puedes insertar: <code>&#123;nombre&#125;</code> <code>&#123;empresa&#125;</code> <code>&#123;fecha_corte&#125;</code> <code>&#123;precio&#125;</code> <code>&#123;dias_vencido&#125;</code></span>
          </div>

          <div class="actions-row">
            <button type="button" class="btn btn-primary" (click)="saveConfig()">
              <svg lucideSave size="16"></svg> Guardar avisos
            </button>
            <button type="button" class="btn btn-outline" (click)="runNotifNow()" title="Envía ahora los mensajes que correspondan, sin esperar la hora programada">
              <svg lucideSend size="15"></svg> Enviar ahora
            </button>
          </div>
        </div>

        <!-- AVISO DE PAGO EN EL NAVEGADOR -->
        <div class="card full">
          <h3><svg lucideGlobe size="16"></svg> Página de aviso de pago</h3>
          <p class="help-text">
            Marca como “moroso suave” a los clientes con factura vencida. Al navegar, el cliente verá una página con sus datos y su factura pendiente.
            No es un corte total: las páginas seguras (HTTPS) siguen funcionando.
          </p>

          <div class="toggle-row">
            <label class="switch">
              <input type="checkbox" role="switch" aria-label="Activar página de aviso de pago" [ngModel]="paymentWarningEnabled()" (ngModelChange)="paymentWarningEnabled.set($event); savePaymentWarning()" />
              <span class="slider"></span>
            </label>
            <div>
              <strong>Aviso automático {{ paymentWarningEnabled() ? 'activado' : 'apagado' }}</strong>
              <div class="sub-text">Solo se aplica cuando este interruptor está encendido. Es un aviso suave, no un bloqueo.</div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="pw-days">Días de atraso para mostrar el aviso</label>
              <input id="pw-days" type="number" min="1" max="90" [ngModel]="paymentWarningOverdueDays()" (ngModelChange)="paymentWarningOverdueDays.set(+$event)" class="form-input" />
            </div>
            <div class="form-group">
              <label for="pw-hour">Hora de revisión diaria (0 a 23)</label>
              <input id="pw-hour" type="number" min="0" max="23" [ngModel]="paymentWarningRunHour()" (ngModelChange)="paymentWarningRunHour.set(+$event)" class="form-input"
                [class.invalid]="!validHour(paymentWarningRunHour())" />
              <span class="hint" [class.err]="!validHour(paymentWarningRunHour())">{{ validHour(paymentWarningRunHour()) ? 'Se revisa todos los días a las ' + formatHour(paymentWarningRunHour()) + '.' : 'Escribe una hora entre 0 y 23.' }}</span>
            </div>
          </div>

          <div class="actions-row">
            <button type="button" class="btn btn-primary" (click)="savePaymentWarning()" [disabled]="paymentWarningBusy()">
              <svg lucideSave size="15"></svg> Guardar aviso
            </button>
            <button type="button" class="btn btn-outline" (click)="previewPaymentWarning()" [disabled]="paymentWarningBusy()">
              <svg lucideEye size="15"></svg> Ver a quién aplica
            </button>
            <button type="button" class="btn btn-warn" (click)="runPaymentWarning()" [disabled]="paymentWarningBusy() || !paymentWarningEnabled()"
              [title]="!paymentWarningEnabled() ? 'Activa el aviso automático para poder ejecutarlo' : 'Aplica el aviso ahora a los clientes que cumplen la condición'">
              <svg lucidePlay size="15"></svg> Aplicar ahora
            </button>
          </div>
          @if (!paymentWarningEnabled()) {
            <p class="hint">“Aplicar ahora” se habilita cuando el aviso automático está activado.</p>
          }

          @if (paymentWarningMessage()) {
            <p class="status-msg">{{ paymentWarningMessage() }}</p>
          }

          @if (paymentWarningPreview().length) {
            <div class="preview-box">
              <strong>{{ paymentWarningPreview().length }} {{ paymentWarningPreview().length === 1 ? 'cliente cumple' : 'clientes cumplen' }} la condición</strong>
              @if (paymentWarningPreview().length > 10) { <span class="hint">Se muestran los primeros 10.</span> }
              <div class="mini-table-wrap">
                <table class="mini-table">
                  <thead><tr><th>Cliente</th><th>IP</th><th>Días de atraso</th><th>Factura</th><th>Qué se hará</th></tr></thead>
                  <tbody>
                    @for (row of paymentWarningPreview().slice(0, 10); track row.idServicio) {
                      <tr>
                        <td>{{ row.nombre }}</td>
                        <td class="mono">{{ row.ip || '—' }}</td>
                        <td>{{ row.overdueDays }}</td>
                        <td>{{ row.invoice?.folio || row.invoice?.idFactura || '—' }}</td>
                        <td>{{ wouldDoLabel(row.wouldDo || row.reason) }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            </div>
          }
        </div>

        <!-- DIAGNÓSTICO DE RED -->
        <div class="card full">
          <h3><svg lucideWifi size="16"></svg> Diagnóstico de red</h3>
          <p class="help-text">
            Si abres esta página desde una red conectada al MikroTik, la IP pública que aparece es la IP WAN del negocio.
            Desde otra red (casa, datos móviles) será diferente.
          </p>
          @if (wanIp()) {
            <div class="wan-info">
              <div class="wan-row">
                <span class="wan-label">IP pública actual</span>
                <strong class="wan-value">{{ wanIp() }}</strong>
                <button type="button" class="btn-copy" (click)="copyIp()"><svg lucideCopy size="12"></svg> Copiar</button>
              </div>
              @if (isp()) {
                <div class="wan-row">
                  <span class="wan-label">Proveedor de internet</span>
                  <span>{{ isp() }}</span>
                </div>
              }
              @if (city()) {
                <div class="wan-row">
                  <span class="wan-label">Ubicación</span>
                  <span>{{ city() }}, {{ country() }}</span>
                </div>
              }
              <div class="wan-row">
                <span class="wan-label">Router WispHub (VPN)</span>
                <strong class="mono">172.29.33.223</strong>
                <span class="muted">IP privada: no es tu IP WAN</span>
              </div>
            </div>
          } @else {
            <button type="button" class="btn btn-primary" (click)="detectWanIp()" [disabled]="detecting()">
              {{ detecting() ? 'Detectando…' : 'Detectar IP pública' }}
            </button>
          }
        </div>

        <!-- INFORMACIÓN TÉCNICA (para el administrador) -->
        <details class="card full tech">
          <summary><svg lucideInfo size="16"></svg> Información técnica <span>Solo para soporte o el administrador</span></summary>
          <div class="info-grid">
            <div class="info-item"><span>Versión</span><span>1.0.0</span></div>
            <div class="info-item"><span>Conexión WispHub</span><span class="mono break">{{ apiUrl }}</span></div>
            <div class="info-item"><span>Clave de WispHub</span><span>Se configura solo en el servidor (<code>WISPHUB_API_KEY</code>). Se genera en WispHub › Staff › Generar API Key.</span></div>
            <div class="info-item"><span>Base de datos</span><span>SQLite + Prisma, volumen persistente <code>/data</code></span></div>
            <div class="info-item"><span>Framework</span><span>Angular 21</span></div>
            <div class="info-item"><span>Servidor</span><span>Railway</span></div>
            @if (opsHealth()?.mikrotik?.captiveRules?.target) {
              <div class="info-item"><span>Destino del aviso (captive)</span><span class="mono">{{ opsHealth().mikrotik.captiveRules.target?.address }}:{{ opsHealth().mikrotik.captiveRules.target?.port }}</span></div>
            }
          </div>
        </details>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 24px 32px; }

    .settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

    .card { background: white; border: 1px solid #dfe5ea; border-radius: 8px; padding: 20px; min-width: 0; }
    .card.full { grid-column: 1 / -1; }

    .card h3 {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      margin: 0 0 16px; font-size: 15px; font-weight: 600; color: #172535;
      padding-bottom: 12px; border-bottom: 1px solid #f0f3f6;
    }
    .card h3 svg { color: #1267dd; }
    .card h3 small { font-size: 12px; font-weight: 500; color: #667582; }

    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; color: #334250; margin-bottom: 6px; }
    .form-input {
      width: 100%; padding: 9px 12px; border: 1px solid #ccd6de; border-radius: 6px;
      font-size: 13px; color: #334250; outline: none; box-sizing: border-box; background: white;
    }
    .form-input:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.12); }
    .form-input:disabled { background: #f8fafc; color: #667582; }
    .form-input.invalid { border-color: #b42318; }
    .form-input.narrow { max-width: 200px; }

    .toggle-row {
      display: flex; align-items: center; gap: 14px; padding: 12px 0;
      border-bottom: 1px solid #f0f3f6; margin-bottom: 14px;
    }
    .toggle-row strong { display: block; font-size: 13px; color: #172535; }
    .toggle-row .sub-text { font-size: 12px; color: #667582; margin-top: 2px; }

    .switch { position: relative; display: inline-block; width: 44px; height: 24px; flex-shrink: 0; }
    .switch input { opacity: 0; width: 0; height: 0; }
    .slider { position: absolute; cursor: pointer; inset: 0; background: #ccd6de; transition: 0.2s; border-radius: 24px; }
    .slider:before { position: absolute; content: ''; height: 18px; width: 18px; left: 3px; bottom: 3px; background: white; transition: 0.2s; border-radius: 50%; }
    .switch input:checked + .slider { background: #13875a; }
    .switch input:checked + .slider:before { transform: translateX(20px); }
    .switch input:focus-visible + .slider { box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.25); }

    .actions-row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
    .hint { display: block; font-size: 11px; color: #667582; margin-top: 4px; }
    .hint.err { color: #b42318; }
    .hint code, .info-item code { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; background: #f1f4f7; padding: 0 4px; border-radius: 4px; color: #172535; font-size: 11px; }
    textarea.form-input { resize: vertical; font-family: inherit; }
    .status-msg { margin: 12px 0 0; color: #334250; font-size: 13px; }
    .preview-box { margin-top: 14px; border: 1px solid #dfe5ea; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .preview-box > strong { color: #172535; font-size: 13px; }
    .mini-table-wrap { overflow-x: auto; }
    .mini-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
    .mini-table th, .mini-table td { text-align: left; padding: 8px; border-bottom: 1px solid #dfe5ea; white-space: nowrap; color: #334250; }
    .mini-table th { color: #667582; font-weight: 700; }
    .health-grid { display: grid; gap: 4px; }
    .health-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f0f3f6; font-size: 13px; color: #667582; }
    .health-row strong { display: inline-flex; align-items: center; gap: 6px; color: #172535; text-align: right; }
    .health-row .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .ok { color: #13875a !important; }
    .warn { color: #b36b12 !important; }
    .bad { color: #b42318 !important; }
    .rules-box { margin-top: 14px; padding: 12px; border: 1px solid #dfe5ea; border-radius: 8px; background: #f8fafc; display: grid; gap: 8px; font-size: 12px; color: #667582; }
    .rules-box strong { color: #172535; font-size: 13px; }
    .rule-list { display: flex; gap: 6px; flex-wrap: wrap; }
    .rule-list span { padding: 4px 9px; border-radius: 999px; background: #fff0ef; color: #b42318; font-weight: 600; }
    .rule-list span.ok { background: #e9f8f1; color: #13875a !important; }

    .wan-info { background: #f8fafc; border-radius: 8px; padding: 12px 16px; }
    .wan-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 8px 0; border-bottom: 1px solid #dfe5ea; font-size: 13px; color: #334250; }
    .wan-row:last-child { border-bottom: none; }
    .wan-label { color: #667582; min-width: 160px; }
    .wan-value { color: #172535; font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; font-weight: 700; font-size: 17px; }
    .mono { font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
    .break { word-break: break-all; }
    .muted { color: #667582; font-size: 12px; }
    .btn-copy { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid #ccd6de; border-radius: 6px; background: white; color: #1267dd; font-size: 12px; font-weight: 600; cursor: pointer; }
    .btn-copy:hover { background: #edf4ff; border-color: #1267dd; }

    .paper-select { display: flex; gap: 8px; max-width: 420px; }
    .paper-select button {
      flex: 1; padding: 9px; border: 1px solid #ccd6de; border-radius: 6px;
      background: white; font-size: 13px; font-weight: 600; color: #334250;
      cursor: pointer; transition: all 0.15s;
    }
    .paper-select button.active { border-color: #1267dd; background: #edf4ff; color: #1267dd; box-shadow: inset 0 0 0 1px #1267dd; }
    .paper-select button:hover { border-color: #1267dd; }

    .help-text { font-size: 13px; color: #667582; line-height: 1.5; margin: 0 0 12px; }
    .help-text.small-gap { margin: 10px 0 0; font-size: 12px; }

    .btn {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 9px 16px; border-radius: 6px; font-size: 13px; font-weight: 600;
      cursor: pointer; border: 1px solid transparent; transition: background 0.15s, border-color 0.15s;
    }
    .btn:disabled { opacity: 0.55; cursor: not-allowed; }
    .btn-primary { background: #1267dd; color: white; }
    .btn-primary:hover:not(:disabled) { background: #0d58c0; }
    .btn-outline { background: white; border-color: #ccd6de; color: #334250; }
    .btn-outline:hover:not(:disabled) { border-color: #1267dd; color: #1267dd; }
    .btn-warn { background: white; border-color: #e7c28f; color: #b36b12; }
    .btn-warn:hover:not(:disabled) { background: #fff6e8; }

    .saved-msg { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #13875a; font-weight: 600; }

    .db-info { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
    .db-stat { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f0f3f6; font-size: 13px; color: #667582; }
    .db-val { font-weight: 700; color: #172535; text-align: right; }

    .tech summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600; color: #172535; list-style: none; }
    .tech summary::-webkit-details-marker { display: none; }
    .tech summary svg { color: #667582; }
    .tech summary span { font-size: 12px; font-weight: 500; color: #667582; }
    .tech[open] summary { margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #f0f3f6; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
    .info-item { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
    .info-item span:first-child { font-size: 11px; color: #667582; text-transform: uppercase; font-weight: 600; letter-spacing: 0.03em; }
    .info-item span:last-child { font-size: 13px; color: #172535; }

    @media (max-width: 768px) {
      .page { padding: 16px; }
      .settings-grid { grid-template-columns: 1fr; }
      .form-row { grid-template-columns: 1fr; gap: 0; }
      .info-grid { grid-template-columns: 1fr; }
      .wan-label { min-width: 0; width: 100%; }
    }
  `]
})
export class SettingsComponent implements OnInit {
  private scheduler = inject(NotificationSchedulerService);
  private toast = inject(ToastService);
  config = inject(ConfigService);

  apiUrl = environment.apiUrl;
  saved = signal(false);
  private http = inject(HttpClient);
  wanIp = signal('');
  isp = signal('');
  city = signal('');
  country = signal('');
  detecting = signal(false);
  localClientsCount = signal(0);
  localInvoicesCount = signal(0);
  ipInventoryCount = signal(0);
  lastSyncAt = signal('');
  backupBusy = signal(false);
  paymentWarningEnabled = signal(false);
  paymentWarningOverdueDays = signal(15);
  paymentWarningRunHour = signal(9);
  paymentWarningBusy = signal(false);
  paymentWarningMessage = signal('');
  paymentWarningPreview = signal<any[]>([]);
  opsHealth = signal<any | null>(null);
  opsBusy = signal(false);
  opsMessage = signal('');

  async ngOnInit() {
    this.loadDatabaseStatus();
    this.config.load();
    this.loadPaymentWarning();
    this.loadOpsHealth();
  }

  saveConfig() {
    this.config.save().subscribe({
      next: () => {
        this.saved.set(true);
        this.toast.success('Configuración guardada');
        if (this.config.autoNotifEnabled()) this.scheduler.start();
        else this.scheduler.stop();
        setTimeout(() => this.saved.set(false), 3000);
      },
      error: () => this.toast.error('No se pudo guardar la configuración'),
    });
  }

  runNotifNow() {
    if (!confirm('¿Enviar ahora los avisos automáticos por WhatsApp?\n\nSe enviarán mensajes reales a los clientes que cumplan las condiciones, sin esperar la hora programada.')) return;
    this.scheduler.runNow();
  }

  validHour(h: number | null | undefined): boolean {
    const n = Number(h);
    return Number.isInteger(n) && n >= 0 && n <= 23;
  }

  /** 14 -> "2:00 p. m." (solo visual). */
  formatHour(h: number | null | undefined): string {
    const n = Number(h);
    if (!this.validHour(n)) return '—';
    const suffix = n < 12 ? 'a. m.' : 'p. m.';
    const h12 = n % 12 === 0 ? 12 : n % 12;
    return `${h12}:00 ${suffix}`;
  }

  waStatusLabel(status?: string): string {
    const labels: Record<string, string> = {
      connected: 'Conectado', disconnected: 'Desconectado', qr: 'Esperando QR', connecting: 'Conectando',
      conflict: 'Sesión en conflicto', logged_out: 'Sesión cerrada', error: 'Con error',
    };
    return status ? (labels[status] || status) : 'Sin datos';
  }

  wouldDoLabel(action?: string): string {
    const labels: Record<string, string> = {
      moroso: 'Mostrar aviso', block: 'Bloquear', already_moroso: 'Ya tiene aviso',
      skip_blocked: 'Ya está bloqueado', already_blocked: 'Ya está bloqueado',
    };
    return action ? (labels[action] || action) : '—';
  }

  loadOpsHealth() {
    this.opsBusy.set(true);
    this.http.get<any>('/ops/status').subscribe({
      next: (r) => {
        this.opsBusy.set(false);
        this.opsHealth.set(r);
        this.opsMessage.set(`Última revisión: ${new Date(r.checkedAt).toLocaleString('es-DO')}`);
      },
      error: (e) => {
        this.opsBusy.set(false);
        this.opsMessage.set(e?.status === 0 ? 'Sin conexión con el servidor. Intenta de nuevo en un momento.' : (e.error?.error || 'No se pudo revisar el estado del sistema.'));
      },
    });
  }

  repairCaptiveRules() {
    if (!confirm('¿Reparar las reglas del aviso de pago en el MikroTik?\n\nSe actualizan las reglas de morosos-crm y bloqueados-crm para que apunten a este servidor. Afecta a los clientes morosos y bloqueados que estén navegando.')) return;
    this.opsBusy.set(true);
    this.http.post<any>('/ops/repair-captive', {}).subscribe({
      next: (r) => {
        this.opsBusy.set(false);
        this.opsHealth.update((prev) => ({ ...(prev || {}), mikrotik: { ...(prev?.mikrotik || {}), captiveRules: r.status } }));
        this.opsMessage.set('Reglas del aviso de pago reparadas correctamente.');
        this.toast.success('Reglas del aviso reparadas');
        this.loadOpsHealth();
      },
      error: (e) => {
        this.opsBusy.set(false);
        this.toast.error(e.error?.error || 'No se pudieron reparar las reglas del MikroTik');
      },
    });
  }

  loadPaymentWarning() {
    this.http.get<any>('/payment-warning/status').subscribe({
      next: (r) => {
        const cfg = r.config || {};
        this.paymentWarningEnabled.set(!!cfg.enabled);
        this.paymentWarningOverdueDays.set(cfg.overdueDays || 15);
        this.paymentWarningRunHour.set(cfg.runHour ?? 9);
      },
      error: () => this.paymentWarningMessage.set('No se pudo cargar la configuración de la página de aviso.'),
    });
  }

  savePaymentWarning() {
    this.paymentWarningBusy.set(true);
    this.http.put<any>('/payment-warning/settings', {
      enabled: this.paymentWarningEnabled(),
      overdueDays: this.paymentWarningOverdueDays(),
      runHour: this.paymentWarningRunHour(),
    }).subscribe({
      next: (r) => {
        this.paymentWarningBusy.set(false);
        const cfg = r.config || {};
        this.paymentWarningEnabled.set(!!cfg.enabled);
        this.paymentWarningOverdueDays.set(cfg.overdueDays || 15);
        this.paymentWarningRunHour.set(cfg.runHour ?? 9);
        this.paymentWarningMessage.set('Configuración del aviso guardada.');
        this.toast.success('Aviso de pago guardado');
      },
      error: (e) => {
        this.paymentWarningBusy.set(false);
        this.toast.error(e.error?.error || 'No se pudo guardar el aviso de pago');
      },
    });
  }

  previewPaymentWarning() {
    this.paymentWarningBusy.set(true);
    this.http.get<any>('/payment-warning/preview').subscribe({
      next: (r) => {
        this.paymentWarningBusy.set(false);
        this.paymentWarningPreview.set(r.candidates || []);
        const n = r.count || 0;
        this.paymentWarningMessage.set(n === 0 ? 'Ningún cliente cumple la condición ahora mismo.' : `${n} ${n === 1 ? 'cliente cumple' : 'clientes cumplen'} la condición actual.`);
      },
      error: (e) => {
        this.paymentWarningBusy.set(false);
        this.toast.error(e.error?.error || 'No se pudo generar la vista previa');
      },
    });
  }

  runPaymentWarning() {
    if (!this.paymentWarningEnabled()) {
      this.paymentWarningMessage.set('El aviso automático está apagado. Actívalo primero para poder aplicarlo.');
      this.toast.error('Activa el aviso de pago primero');
      return;
    }
    if (!confirm('¿Aplicar el aviso de pago ahora?\n\nLos clientes que cumplan la condición se marcarán como “moroso suave” y verán la página de aviso al navegar.')) return;
    this.paymentWarningBusy.set(true);
    this.http.post<any>('/payment-warning/run', {}).subscribe({
      next: (r) => {
        this.paymentWarningBusy.set(false);
        if (r.ran === false) {
          this.paymentWarningMessage.set('El aviso automático está apagado. No se aplicó ningún cambio.');
          this.toast.error('Aviso de pago apagado');
          return;
        }
        this.paymentWarningPreview.set(r.actions || []);
        this.paymentWarningMessage.set(`Listo: aviso aplicado a ${r.applied || 0}, ${r.alreadyMoroso || 0} ya lo tenían y ${r.cleared || 0} se quitaron porque ya pagaron.`);
        this.toast.success('Aviso de pago aplicado');
      },
      error: (e) => {
        this.paymentWarningBusy.set(false);
        this.toast.error(e.error?.error || 'No se pudo aplicar el aviso de pago');
      },
    });
  }

  async detectWanIp() {
    this.detecting.set(true);
    try {
      const ipRes: any = await this.http.get('https://api.ipify.org?format=json').toPromise();
      this.wanIp.set(ipRes.ip);
      try {
        const geo: any = await this.http.get(`https://ipapi.co/${ipRes.ip}/json/`).toPromise();
        this.isp.set(geo.org || geo.asn || '');
        this.city.set(geo.city || '');
        this.country.set(geo.country_name || '');
      } catch {}
    } catch (e) {
      this.toast.error('No se pudo detectar la IP pública. Revisa la conexión a internet.');
    }
    this.detecting.set(false);
  }

  copyIp() {
    navigator.clipboard.writeText(this.wanIp()).then(
      () => this.toast.success('IP copiada al portapapeles'),
      () => this.toast.error('No se pudo copiar la IP'),
    );
  }

  loadDatabaseStatus() {
    this.http.get<any>('/db/stats').subscribe({
      next: (stats) => {
        this.localClientsCount.set(stats.clients?.count || 0);
        this.localInvoicesCount.set(stats.invoices?.count || 0);
        this.ipInventoryCount.set(stats.ipam?.count || 0);
      },
    });
    this.http.get<any>('/sync/status').subscribe({
      next: (status) => this.lastSyncAt.set(status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString('es-DO') : ''),
    });
  }

  androidBusy = signal(false);

  downloadAndroid() {
    this.androidBusy.set(true);
    this.http.get('/android-api/download', { responseType: 'blob', observe: 'response' }).subscribe({
      next: response => {
        this.androidBusy.set(false);
        if (!response.body) return;
        const filename = response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'ISP-Max-Android.apk';
        const url = URL.createObjectURL(response.body);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: () => { this.androidBusy.set(false); this.toast.error('No se pudo descargar la app Android'); },
    });
  }

  downloadDatabaseBackup() {
    this.backupBusy.set(true);
    this.http.get('/db/backup', { responseType: 'blob', observe: 'response' }).subscribe({
      next: (response) => {
        this.backupBusy.set(false);
        const blob = response.body;
        if (!blob) return;
        const disposition = response.headers.get('content-disposition') || '';
        const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `isp-max-${new Date().toISOString().slice(0, 10)}.db`;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);
        this.toast.success('Respaldo de la base de datos descargado');
      },
      error: (error) => {
        this.backupBusy.set(false);
        this.toast.error(error.error?.error || 'No se pudo crear el respaldo');
      },
    });
  }
}
