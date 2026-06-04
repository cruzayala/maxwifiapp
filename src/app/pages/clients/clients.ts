import { Component, OnInit, OnDestroy, inject, signal } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { NavbarComponent } from '../../components/layout/navbar';
import { WisphubService } from '../../services/wisphub.service';
import { LocalDbService } from '../../services/local-db.service';
import { WispHubClient } from '../../models/client.model';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ExportService } from '../../services/export.service';
import { ClientBlockActionsComponent } from '../../components/client-block-actions/client-block-actions';
import { ClientActionsService } from '../../services/client-actions.service';
import { MetricsService } from '../../services/metrics.service';
import { SurveyService } from '../../services/survey.service';
import { ToastService } from '../../services/toast.service';
import { ClientMetric, tierStyle, consStyle, CreditTier } from '../../models/metrics.model';
import { DecimalPipe } from '@angular/common';

type ClientViewMode = 'table' | 'cards' | 'circles' | 'speed' | 'billing' | 'amount';

interface ClientGroup {
  key: string;
  title: string;
  subtitle: string;
  clients: WispHubClient[];
  totalMonthly: number;
  activeCount: number;
  pendingCount: number;
}

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [NavbarComponent, RouterLink, FormsModule, ClientBlockActionsComponent, DecimalPipe],
  template: `
    <app-navbar pageTitle="Clientes" />

    <div class="page">
      <div class="summary-grid">
        <button class="summary-card total" type="button" (click)="setQuickFilter('all')" [class.active]="quickFilter === 'all'">
          <span>Total clientes</span>
          <strong>{{ allClients().length }}</strong>
          <small>{{ filteredClients().length }} visibles</small>
        </button>
        <button class="summary-card success" type="button" (click)="setQuickFilter('active')" [class.active]="quickFilter === 'active'">
          <span>Activos</span>
          <strong>{{ countStatus('activo') }}</strong>
          <small>servicio operativo</small>
        </button>
        <button class="summary-card warning" type="button" (click)="setQuickFilter('debt')" [class.active]="quickFilter === 'debt'">
          <span>Facturas pendientes</span>
          <strong>{{ countPendingInvoices() }}</strong>
          <small>requieren seguimiento</small>
        </button>
        <button class="summary-card danger" type="button" (click)="setQuickFilter('risk')" [class.active]="quickFilter === 'risk'">
          <span>Riesgo</span>
          <strong>{{ countRiskClients() }}</strong>
          <small>score bajo</small>
        </button>
        <button class="summary-card info" type="button" (click)="setQuickFilter('suspended')" [class.active]="quickFilter === 'suspended'">
          <span>Suspendidos</span>
          <strong>{{ countStatus('suspendido') }}</strong>
          <small>revisar servicio</small>
        </button>
      </div>

      <div class="toolbar">
        <div class="search-filter">
          <div class="search-input">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" placeholder="Buscar nombre, IP, telefono, cedula, zona..." [(ngModel)]="searchTerm" (input)="filterClients()" />
          </div>
          <select [(ngModel)]="statusFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos</option>
            <option value="activo">Activo</option>
            <option value="suspendido">Suspendido</option>
            <option value="cortado">Cortado</option>
            <option value="gratis">Gratis</option>
            <option value="retirado">Retirado</option>
          </select>
          <select [(ngModel)]="invoiceFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todas las facturas</option>
            <option value="pending">Pendientes</option>
            <option value="paid">Pagadas</option>
          </select>
          <select [(ngModel)]="zoneFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todas las zonas</option>
            @for (zone of allZones(); track zone) {
              <option [value]="zone">{{ zone }}</option>
            }
          </select>
          <select [(ngModel)]="planFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos los planes</option>
            @for (plan of allPlans(); track plan) {
              <option [value]="plan">{{ plan }}</option>
            }
          </select>
          <select [(ngModel)]="tierFilter" (change)="filterClients()" class="filter-select">
            <option value="">Todos los tiers</option>
            <option value="EXCELENTE">🌟 Excelente</option>
            <option value="BUENO">✅ Bueno</option>
            <option value="REGULAR">⚠️ Regular</option>
            <option value="RIESGO">🟠 Riesgo</option>
            <option value="CRITICO">🔴 Crítico</option>
          </select>
          <button class="btn btn-ghost" type="button" (click)="clearFilters()">Limpiar</button>
        </div>
        <div class="toolbar-actions">
          <a routerLink="/clients/new" class="btn btn-green">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo
          </a>
          <button class="btn btn-outline" (click)="exportCSV()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            CSV
          </button>
          <button class="btn btn-primary" (click)="syncClients()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            {{ syncing() ? 'Sincronizando...' : 'Sincronizar' }}
          </button>
          <span class="client-count">{{ filteredClients().length }} de {{ allClients().length }}</span>
        </div>
      </div>

      @if (!loading() && allClients().length > 0) {
        <div class="view-strip" aria-label="Vistas de clientes">
          <button type="button" (click)="setViewMode('table')" [class.active]="viewMode === 'table'">
            <span class="view-icon">T</span>
            <span>Tabla</span>
          </button>
          <button type="button" (click)="setViewMode('cards')" [class.active]="viewMode === 'cards'">
            <span class="view-icon">C</span>
            <span>Cards</span>
          </button>
          <button type="button" (click)="setViewMode('circles')" [class.active]="viewMode === 'circles'">
            <span class="view-icon">O</span>
            <span>Circulos 5</span>
          </button>
          <button type="button" (click)="setViewMode('speed')" [class.active]="viewMode === 'speed'">
            <span class="view-icon">V</span>
            <span>Velocidad</span>
          </button>
          <button type="button" (click)="setViewMode('billing')" [class.active]="viewMode === 'billing'">
            <span class="view-icon">15</span>
            <span>Corte 15/30</span>
          </button>
          <button type="button" (click)="setViewMode('amount')" [class.active]="viewMode === 'amount'">
            <span class="view-icon">$</span>
            <span>Factura RD$</span>
          </button>
        </div>
      }

      @if (loading()) {
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Cargando clientes...</p>
        </div>
      } @else if (filteredClients().length === 0 && allClients().length === 0) {
        <div class="empty-state">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="1.5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
          <h3>Sin clientes</h3>
          <p>Presiona "Sincronizar" para cargar los 369 clientes desde WispHub</p>
        </div>
      } @else {
        @if (viewMode === 'table') {
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th class="sortable col-client" (click)="sort('nombre')">Cliente {{ sortIcon('nombre') }}</th>
                <th class="sortable col-service" (click)="sort('plan_internet.nombre')">Servicio {{ sortIcon('plan_internet.nombre') }}</th>
                <th class="sortable col-status" (click)="sort('estado')">Estado {{ sortIcon('estado') }}</th>
                <th>Facturas</th>
                <th class="sortable col-location" (click)="sort('zona.nombre')">Ubicacion {{ sortIcon('zona.nombre') }}</th>
                <th class="sortable col-score" (click)="sort('creditScore')">Score {{ sortIcon('creditScore') }}</th>
                <th class="sortable" (click)="sort('fecha_corte')">Corte {{ sortIcon('fecha_corte') }}</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              @for (c of filteredClients(); track c.id_servicio) {
                <tr (click)="openClient(c.id_servicio)" class="clickable-row">
                  <td data-label="Cliente">
                    <div class="cell-client">
                      <div class="avatar-sm" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                      <div>
                        <span class="name">{{ c.nombre }}</span>
                        <span class="sub">{{ clientSubline(c) }}</span>
                      </div>
                    </div>
                  </td>
                  <td data-label="Servicio">
                    <div class="service-cell">
                      <span class="plan-name">{{ c.plan_internet?.nombre || '-' }}</span>
                      <span class="sub mono">{{ serviceSubline(c) }}</span>
                    </div>
                  </td>
                  <td data-label="Estado">
                    <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ c.estado || '-' }}</span>
                  </td>
                  <td data-label="Facturas">
                    <span class="badge" [class]="'badge-' + getFacturaClass(c.estado_facturas)">{{ c.estado_facturas || '-' }}</span>
                  </td>
                  <td data-label="Ubicacion">
                    <div class="location-cell">
                      <span>{{ c.zona?.nombre || 'Sin zona' }}</span>
                      <small>{{ c.direccion || '-' }}</small>
                    </div>
                  </td>
                  <td data-label="Score" (click)="$event.stopPropagation()">
                    @if (getMetric(c.id_servicio); as m) {
                      <div class="score-cell">
                        @if (m.creditTier && tierStyle(m.creditTier); as ts) {
                          <span class="tier-pill" [style.background]="ts.bg" [style.color]="ts.color"
                                [title]="'Score: ' + (m.creditScore || '?') + '/100 — ' + ts.label">
                            {{ ts.emoji }} {{ m.creditScore }}
                          </span>
                        }
                        @if (m.consumptionTier && consStyle(m.consumptionTier); as cs) {
                          <span class="cons-pill" [style.background]="cs.bg" [style.color]="cs.color"
                                [title]="cs.label + ' — ' + ((m.consumptionMb30d || 0) / 1024 | number:'1.1-1') + ' GB en 30d'">
                            {{ cs.emoji }}
                          </span>
                        }
                      </div>
                    } @else {
                      <span class="empty-tier">—</span>
                    }
                  </td>
                  <td data-label="Corte" class="date">{{ c.fecha_corte || '-' }}</td>
                  <td data-label="Acciones" (click)="$event.stopPropagation()">
                    @if (crmActionLabel(c.id_servicio); as lbl) {
                      <span class="badge badge-{{ lbl.color }}">{{ lbl.text }}</span>
                    }
                    <app-client-block-actions
                      [idServicio]="c.id_servicio"
                      [clientName]="c.nombre"
                      [crmAction]="crmActionFor(c.id_servicio)"
                      (changed)="onActionChanged($event, c.id_servicio)"
                    />
                    @if (c.ip) {
                      <button
                        class="btn-survey"
                        [disabled]="surveyLoading() === c.id_servicio"
                        (click)="enviarEncuesta(c)"
                        title="Crear enlace seguro de encuesta sin tocar internet">
                        @if (surveyLoading() === c.id_servicio) {
                          ...
                        } @else {
                          &#x1F4DD; Encuesta
                        }
                      </button>
                      <button
                        class="btn-clear-survey"
                        [disabled]="surveyLoading() === c.id_servicio"
                        (click)="quitarEncuesta(c)"
                        title="Cancelar encuesta pendiente y limpiar MikroTik si quedo algo viejo">
                        Quitar encuesta
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        } @else if (viewMode === 'cards') {
          <div class="cards-grid">
            @for (c of filteredClients(); track c.id_servicio) {
              <article class="client-card" (click)="openClient(c.id_servicio)">
                <div class="client-card-head">
                  <div class="avatar-card" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</div>
                  <div class="client-card-title">
                    <strong>{{ c.nombre }}</strong>
                    <span>{{ c.usuario || ('#' + c.id_servicio) }}</span>
                  </div>
                  <span class="badge" [class]="'badge-' + getStatusClass(c.estado)">{{ c.estado || '-' }}</span>
                </div>
                <div class="client-card-service">
                  <span>{{ c.plan_internet?.nombre || 'Sin plan' }}</span>
                  <strong>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</strong>
                </div>
                <div class="client-card-grid">
                  <div><span>IP</span><strong class="mono">{{ c.ip || '-' }}</strong></div>
                  <div><span>Zona</span><strong>{{ c.zona?.nombre || '-' }}</strong></div>
                  <div><span>Factura</span><strong>{{ invoiceShort(c) }}</strong></div>
                  <div><span>Corte</span><strong>{{ billingCycleLabel(c) }}</strong></div>
                </div>
                <p>{{ c.direccion || c.telefono || 'Sin direccion registrada' }}</p>
              </article>
            }
          </div>
        } @else if (viewMode === 'circles') {
          <div class="circle-grid">
            @for (c of filteredClients(); track c.id_servicio) {
              <button class="circle-client" type="button" (click)="openClient(c.id_servicio)">
                <span class="circle-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                <strong>{{ c.nombre }}</strong>
                <span>{{ c.plan_internet?.nombre || 'Sin plan' }}</span>
                <small>{{ c.zona?.nombre || 'Sin zona' }} · {{ billingCycleLabel(c) }}</small>
              </button>
            }
          </div>
        } @else if (viewMode === 'speed') {
          <div class="group-layout">
            @for (group of speedGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="group-list">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ c.plan_internet?.nombre || c.servicio || '-' }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes mas</div>
                  }
                </div>
              </section>
            }
          </div>
        } @else if (viewMode === 'billing') {
          <div class="group-layout billing-layout">
            @for (group of billingGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="billing-bars">
                  <span [style.width.%]="groupShare(group.clients.length)"></span>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="group-list">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="group-row" (click)="openClient(c.id_servicio)">
                      <span class="mini-avatar" [class]="getStatusClass(c.estado)">{{ getInitials(c.nombre) }}</span>
                      <span class="group-client-name">{{ c.nombre }}</span>
                      <small>{{ c.fecha_corte || 'Sin corte' }}</small>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes mas</div>
                  }
                </div>
              </section>
            }
          </div>
        } @else {
          <div class="group-layout amount-layout">
            @for (group of amountGroups(); track group.key) {
              <section class="group-panel">
                <div class="group-head">
                  <div>
                    <h3>{{ group.title }}</h3>
                    <p>{{ group.subtitle }}</p>
                  </div>
                  <strong>{{ group.clients.length }}</strong>
                </div>
                <div class="group-metrics">
                  <span>{{ group.activeCount }} activos</span>
                  <span>{{ group.pendingCount }} pendientes</span>
                  <span>RD$ {{ group.totalMonthly | number:'1.0-0' }}</span>
                </div>
                <div class="amount-stack">
                  @for (c of previewClients(group.clients); track c.id_servicio) {
                    <button type="button" class="amount-row" (click)="openClient(c.id_servicio)">
                      <span>
                        <strong>{{ c.nombre }}</strong>
                        <small>{{ c.plan_internet?.nombre || 'Sin plan' }} · {{ c.zona?.nombre || 'Sin zona' }}</small>
                      </span>
                      <em>RD$ {{ monthlyAmount(c) | number:'1.0-0' }}</em>
                    </button>
                  }
                  @if (group.clients.length > 8) {
                    <div class="more-row">+{{ group.clients.length - 8 }} clientes mas</div>
                  }
                </div>
              </section>
            }
          </div>
        }
      }

      <div class="sync-bar" [class.visible]="syncing()">
        <div class="spinner small"></div>
        <span>{{ syncMessage() }}</span>
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 20px 24px 28px; }

    .summary-grid {
      display: grid; grid-template-columns: repeat(5, minmax(150px, 1fr));
      gap: 12px; margin-bottom: 14px;
    }

    .summary-card {
      text-align: left; border: 1px solid #e2e8f0; background: white; border-radius: 12px;
      padding: 12px 14px; cursor: pointer; transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
      min-height: 92px;
    }
    .summary-card:hover, .summary-card.active { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(15, 23, 42, 0.08); }
    .summary-card.active { border-color: #6366f1; }
    .summary-card span { display: block; font-size: 11px; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .summary-card strong { display: block; margin-top: 8px; font-size: 24px; line-height: 1; color: #0f172a; }
    .summary-card small { display: block; margin-top: 8px; font-size: 12px; color: #64748b; white-space: nowrap; }
    .summary-card.success.active { border-color: #22c55e; }
    .summary-card.warning.active { border-color: #f59e0b; }
    .summary-card.danger.active { border-color: #ef4444; }
    .summary-card.info.active { border-color: #3b82f6; }

    .toolbar {
      display: grid; grid-template-columns: 1fr;
      align-items: start; gap: 12px; margin-bottom: 14px;
      background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px;
    }

    .search-filter {
      display: grid; grid-template-columns: minmax(360px, 1.6fr) repeat(3, minmax(140px, 1fr));
      align-items: center; gap: 8px;
    }

    .search-input {
      display: flex; align-items: center; gap: 8px;
      background: #f8fafc; border: 1px solid #e2e8f0;
      border-radius: 10px; padding: 10px 14px; color: #94a3b8; min-width: 0;
    }
    .search-input input { border: none; background: none; outline: none; font-size: 14px; color: #334155; width: 100%; }

    .filter-select {
      padding: 10px 14px; border: 1px solid #e2e8f0; border-radius: 10px;
      font-size: 13px; color: #334155; background: white; cursor: pointer; outline: none;
    }

    .toolbar-actions { display: flex; align-items: center; justify-content: flex-start; gap: 8px; flex-wrap: wrap; }

    .btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 20px; border-radius: 10px;
      font-size: 14px; font-weight: 500; cursor: pointer; border: none; transition: all 0.2s;
    }
    .btn-outline { background: white; border: 1px solid #e2e8f0; color: #475569; }
    .btn-outline:hover { border-color: #6366f1; color: #6366f1; background: #eef2ff; }
    .btn-primary { background: #6366f1; color: white; }
    .btn-primary:hover { background: #4f46e5; }
    .btn-green { background: #22c55e; color: white; text-decoration: none; }
    .btn-green:hover { background: #16a34a; }
    .btn-ghost { background: #f8fafc; color: #475569; border: 1px solid #e2e8f0; padding: 10px 14px; }
    .btn-ghost:hover { background: #f1f5f9; color: #0f172a; }

    .client-count { font-size: 13px; color: #64748b; font-weight: 500; white-space: nowrap; }

    .view-strip {
      display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr));
      gap: 8px; margin: 0 0 14px;
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 8px;
    }
    .view-strip button {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      min-height: 38px; border: 1px solid transparent; border-radius: 10px;
      background: transparent; color: #475569; font-size: 13px; font-weight: 700;
      cursor: pointer; transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
    }
    .view-strip button:hover { background: white; border-color: #dbe3ef; color: #0f172a; }
    .view-strip button.active { background: white; border-color: #6366f1; color: #4338ca; box-shadow: 0 8px 20px rgba(99, 102, 241, 0.12); }
    .view-icon {
      width: 24px; height: 24px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
      background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: 900;
    }

    .table-container {
      background: white; border-radius: 14px;
      border: 1px solid #e2e8f0; overflow-x: auto; box-shadow: 0 10px 28px rgba(15, 23, 42, 0.04);
    }

    .data-table { width: 100%; border-collapse: collapse; min-width: 1100px; table-layout: fixed; }

    .data-table th {
      text-align: left; font-size: 11px; font-weight: 600; color: #64748b;
      text-transform: uppercase; letter-spacing: 0.5px;
      padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
      position: sticky; top: 0; z-index: 1;
    }
    .col-client { width: 250px; }
    .col-service { width: 190px; }
    .col-status { width: 110px; }
    .col-location { width: 220px; }
    .col-score { width: 120px; }
    .sortable { cursor: pointer; user-select: none; }
    .sortable:hover { color: #6366f1; }

    .data-table td {
      padding: 12px 14px; font-size: 13px; color: #334155; vertical-align: middle;
      border-bottom: 1px solid #f1f5f9;
    }

    .clickable-row { cursor: pointer; transition: background 0.15s; }
    .clickable-row:hover td { background: #f0f4ff; }

    .cell-client { display: flex; align-items: center; gap: 10px; }

    .avatar-sm {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 13px; color: white; flex-shrink: 0;
    }
    .avatar-sm.active { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .avatar-sm.suspended { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .avatar-sm.free { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .avatar-sm.default { background: linear-gradient(135deg, #94a3b8, #64748b); }

    .name { display: block; font-weight: 600; color: #0f172a; font-size: 14px; }
    .sub { display: block; font-size: 11px; color: #94a3b8; margin-top: 2px; line-height: 1.35; }

    .mono { font-family: 'Courier New', monospace; font-size: 12px; }
    .ip { color: #6366f1; font-weight: 500; }
    .price { font-weight: 700; color: #0f172a; }
    .date { font-size: 12px; color: #64748b; }

    .plan-name { display: block; font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.25; }
    .service-cell, .location-cell { min-width: 0; }
    .location-cell span { display: block; font-weight: 600; color: #334155; }
    .location-cell small {
      display: block; margin-top: 2px; color: #94a3b8; font-size: 11px; line-height: 1.35;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    .badge {
      display: inline-block; padding: 3px 8px;
      border-radius: 20px; font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    .badge-active { background: #dcfce7; color: #16a34a; }
    .badge-suspended { background: #fee2e2; color: #dc2626; }
    .badge-free { background: #dbeafe; color: #2563eb; }
    .badge-default { background: #f1f5f9; color: #64748b; }
    .badge-paid { background: #dcfce7; color: #16a34a; }
    .badge-pending { background: #fef3c7; color: #d97706; }

    .loading-state, .empty-state {
      display: flex; flex-direction: column;
      align-items: center; padding: 80px 40px; gap: 12px; color: #94a3b8;
    }
    .empty-state h3 { color: #475569; margin: 8px 0 0; }

    .spinner { width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    .spinner.small { width: 18px; height: 18px; border-width: 2px; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .sync-bar {
      position: fixed; bottom: -60px; left: 260px; right: 0;
      height: 48px; background: #0f172a; color: white;
      display: flex; align-items: center; justify-content: center;
      gap: 12px; font-size: 14px; transition: bottom 0.3s; z-index: 50;
    }
    .sync-bar.visible { bottom: 0; }

    .badge-warn { background: #fff7ed; color: #c2410c; border: 1px solid #fdba74; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }
    .badge-danger { background: #fef2f2; color: #b91c1c; border: 1px solid #fca5a5; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; margin-bottom: 4px; display: inline-block; }

    .score-cell { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
    .tier-pill { display: inline-flex; align-items: center; gap: 3px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: help; }
    .cons-pill { display: inline-flex; align-items: center; padding: 3px 6px; border-radius: 999px; font-size: 12px; cursor: help; }
    .empty-tier { color: #cbd5e1; font-size: 13px; }

    .btn-survey {
      display: inline-flex; align-items: center; gap: 4px;
      background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe;
      border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 600;
      cursor: pointer; margin-top: 4px; transition: all 0.15s;
    }
    .btn-survey:hover:not(:disabled) { background: #dbeafe; border-color: #3b82f6; }
    .btn-survey:disabled { opacity: 0.5; cursor: wait; }
    .btn-clear-survey {
      display: inline-flex; align-items: center; gap: 4px;
      background: #f8fafc; color: #475569; border: 1px solid #cbd5e1;
      border-radius: 8px; padding: 5px 10px; font-size: 11px; font-weight: 600;
      cursor: pointer; margin-top: 4px; margin-left: 4px; transition: all 0.15s;
    }
    .btn-clear-survey:hover:not(:disabled) { background: #f1f5f9; border-color: #94a3b8; color: #0f172a; }
    .btn-clear-survey:disabled { opacity: 0.5; cursor: wait; }

    .cards-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }
    .client-card {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px;
      cursor: pointer; box-shadow: 0 10px 26px rgba(15, 23, 42, 0.04);
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .client-card:hover { transform: translateY(-2px); border-color: #c7d2fe; box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08); }
    .client-card-head { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .avatar-card {
      width: 44px; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center;
      color: white; font-size: 14px; font-weight: 800; flex: 0 0 auto;
    }
    .avatar-card.active, .circle-avatar.active, .mini-avatar.active { background: linear-gradient(135deg, #22c55e, #16a34a); }
    .avatar-card.suspended, .circle-avatar.suspended, .mini-avatar.suspended { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .avatar-card.free, .circle-avatar.free, .mini-avatar.free { background: linear-gradient(135deg, #3b82f6, #2563eb); }
    .avatar-card.default, .circle-avatar.default, .mini-avatar.default { background: linear-gradient(135deg, #94a3b8, #64748b); }
    .client-card-title { min-width: 0; flex: 1; }
    .client-card-title strong {
      display: block; color: #0f172a; font-size: 14px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .client-card-title span { display: block; margin-top: 2px; color: #94a3b8; font-size: 12px; }
    .client-card-service {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      margin: 14px 0 12px; padding: 10px 12px; border-radius: 12px; background: #f8fafc;
    }
    .client-card-service span { color: #334155; font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card-service strong { color: #0f172a; font-size: 14px; white-space: nowrap; }
    .client-card-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .client-card-grid div { min-width: 0; border: 1px solid #edf2f7; border-radius: 10px; padding: 8px; }
    .client-card-grid span { display: block; color: #94a3b8; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; }
    .client-card-grid strong { display: block; margin-top: 3px; color: #334155; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .client-card p { margin: 12px 0 0; color: #64748b; font-size: 12px; line-height: 1.4; min-height: 34px; }

    .circle-grid {
      display: grid; grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px; align-items: stretch;
    }
    .circle-client {
      min-width: 0; min-height: 186px; border: 1px solid #e2e8f0; border-radius: 18px;
      background: white; cursor: pointer; padding: 14px 10px;
      display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
      transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
    }
    .circle-client:hover { transform: translateY(-2px); border-color: #c7d2fe; box-shadow: 0 16px 34px rgba(15, 23, 42, 0.08); }
    .circle-avatar {
      width: 76px; height: 76px; border-radius: 999px; display: flex; align-items: center; justify-content: center;
      color: white; font-size: 22px; font-weight: 900; margin-bottom: 10px; box-shadow: inset 0 -8px 16px rgba(15, 23, 42, 0.12);
    }
    .circle-client strong {
      width: 100%; color: #0f172a; font-size: 13px; line-height: 1.25;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .circle-client span:not(.circle-avatar) { margin-top: 5px; color: #475569; font-size: 12px; font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .circle-client small { margin-top: 4px; color: #94a3b8; font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .group-layout {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 12px; align-items: start;
    }
    .group-panel {
      background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px;
      box-shadow: 0 10px 26px rgba(15, 23, 42, 0.04);
    }
    .group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .group-head h3 { margin: 0; color: #0f172a; font-size: 16px; line-height: 1.2; }
    .group-head p { margin: 4px 0 0; color: #64748b; font-size: 12px; line-height: 1.35; }
    .group-head strong { color: #4338ca; font-size: 28px; line-height: 1; }
    .group-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .group-metrics span {
      display: inline-flex; padding: 5px 8px; border-radius: 999px; background: #f8fafc;
      color: #475569; border: 1px solid #e2e8f0; font-size: 11px; font-weight: 800;
    }
    .group-list, .amount-stack { display: grid; gap: 6px; }
    .group-row, .amount-row {
      width: 100%; min-width: 0; border: 1px solid #eef2f7; border-radius: 10px; background: #fff;
      color: inherit; cursor: pointer; transition: background 0.15s, border-color 0.15s;
    }
    .group-row {
      display: grid; grid-template-columns: 30px minmax(0, 1fr) auto; gap: 8px; align-items: center;
      padding: 8px; text-align: left;
    }
    .group-row:hover, .amount-row:hover { background: #f8fafc; border-color: #c7d2fe; }
    .mini-avatar { width: 30px; height: 30px; border-radius: 9px; color: white; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 900; }
    .group-client-name { color: #0f172a; font-size: 12px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-row small { color: #64748b; font-size: 11px; white-space: nowrap; }
    .more-row { color: #64748b; font-size: 12px; font-weight: 700; text-align: center; padding: 7px; }
    .billing-bars { height: 8px; background: #eef2ff; border-radius: 999px; overflow: hidden; margin-top: 12px; }
    .billing-bars span { display: block; height: 100%; min-width: 8%; border-radius: inherit; background: linear-gradient(90deg, #6366f1, #22c55e); }
    .amount-row {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding: 9px 10px; text-align: left;
    }
    .amount-row span { min-width: 0; }
    .amount-row strong { display: block; color: #0f172a; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row small { display: block; margin-top: 2px; color: #64748b; font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .amount-row em { color: #0f172a; font-size: 12px; font-weight: 900; font-style: normal; white-space: nowrap; }

    @media (max-width: 1200px) {
      .summary-grid { grid-template-columns: repeat(3, 1fr); }
      .toolbar { grid-template-columns: 1fr; }
      .search-filter { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .search-input { grid-column: 1 / -1; }
      .toolbar-actions { justify-content: flex-start; }
      .view-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .circle-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }

    @media (max-width: 760px) {
      .page { padding: 14px; }
      .summary-grid { grid-template-columns: repeat(2, 1fr); }
      .toolbar, .search-filter, .toolbar-actions { width: 100%; grid-template-columns: 1fr; }
      .search-input, .filter-select, .btn-ghost { width: 100%; }
      .toolbar-actions { justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .btn { flex: 1; justify-content: center; padding-inline: 12px; }
      .data-table { min-width: 980px; }
      .view-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .view-strip button { justify-content: flex-start; padding: 0 10px; }
      .cards-grid, .group-layout { grid-template-columns: 1fr; }
      .circle-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .circle-client { min-height: 168px; }
      .group-row { grid-template-columns: 30px minmax(0, 1fr); }
      .group-row small { grid-column: 2; }
    }
  `]
})
export class ClientsComponent implements OnInit, OnDestroy {
  private api = inject(WisphubService);
  private db = inject(LocalDbService);
  private exportSvc = inject(ExportService);
  private actions = inject(ClientActionsService);
  private survey = inject(SurveyService);
  private toast = inject(ToastService);
  private router = inject(Router);
  metrics = inject(MetricsService);

  surveyLoading = signal<number | null>(null);

  private destroy$ = new Subject<void>();

  // Re-export para usar en el template
  tierStyle = tierStyle;
  consStyle = consStyle;

  allClients = signal<WispHubClient[]>([]);
  filteredClients = signal<WispHubClient[]>([]);
  allPlans = signal<string[]>([]);
  allZones = signal<string[]>([]);
  loading = signal(true);
  syncing = signal(false);
  syncMessage = signal('');
  crmActions = signal<Map<number, string>>(new Map());
  searchTerm = '';
  quickFilter: 'all' | 'active' | 'debt' | 'risk' | 'suspended' = 'all';
  viewMode: ClientViewMode = 'table';
  statusFilter = '';
  invoiceFilter = '';
  zoneFilter = '';
  planFilter = '';
  tierFilter = '';
  sortCol = 'nombre';
  sortDir: 'asc' | 'desc' = 'asc';

  async ngOnInit() {
    await this.loadLocal();
    this.loadCrmStates();
    this.metrics.startAutoRefresh(30000);
  }

  ngOnDestroy() {
    this.metrics.stopAutoRefresh();
    this.destroy$.next();
    this.destroy$.complete();
  }

  getMetric(idServicio: number): ClientMetric | null {
    return this.metrics.get(idServicio);
  }

  loadCrmStates() {
    this.actions.states().pipe(takeUntil(this.destroy$)).subscribe({
      next: (rows) => {
        const map = new Map<number, string>();
        for (const r of rows) if (r.crmAction) map.set(r.idServicio, r.crmAction);
        this.crmActions.set(map);
      },
      error: () => {},
    });
  }

  crmActionFor(id: number): string | null {
    return this.crmActions().get(id) ?? null;
  }

  crmActionLabel(id: number): { text: string; color: string } | null {
    const a = this.crmActionFor(id);
    if (a === 'block') return { text: 'BLOQUEADO', color: 'danger' };
    if (a === 'moroso') return { text: 'MOROSO', color: 'warn' };
    return null;
  }

  onActionChanged(ev: { action: string; result: any }, id: number) {
    const map = new Map(this.crmActions());
    if (ev.action === 'clear') map.delete(id);
    else map.set(id, ev.action);
    this.crmActions.set(map);
  }

  enviarEncuesta(c: WispHubClient) {
    const ip = c.ip;
    if (!ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    const confirmMsg = `Crear encuesta para ${c.nombre} (${ip})?\n\nSe creara un enlace seguro en la nube y recordatorios. No se tocara MikroTik ni se afectara el internet del cliente.`;
    if (!confirm(confirmMsg)) return;
    this.surveyLoading.set(c.id_servicio);
    this.survey.start(ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.alreadySubmitted) {
          this.toast.info('Este cliente ya lleno la encuesta. No se enviara de nuevo.');
        } else if (r.alreadyPending) {
          this.copySurveyLink(r.publicUrl);
          this.toast.info('Ya hay encuesta pendiente. Enlace copiado y recordatorio reactivado.');
        } else if (r.ok) {
          this.copySurveyLink(r.publicUrl);
          this.toast.success(`Encuesta creada para ${c.nombre}. Enlace copiado y recordatorios activos, sin tocar internet.`);
        } else {
          this.toast.error(r.error || 'No se pudo activar la encuesta');
        }
      },
      error: (e) => {
        this.surveyLoading.set(null);
        this.toast.error(e.error?.error || e.message || 'Error al activar encuesta');
      },
    });
  }

  private copySurveyLink(url?: string | null) {
    if (!url) return;
    navigator.clipboard?.writeText(url).catch(() => {});
  }

  setQuickFilter(filter: 'all' | 'active' | 'debt' | 'risk' | 'suspended') {
    this.quickFilter = filter;
    this.filterClients();
  }

  clearFilters() {
    this.quickFilter = 'all';
    this.searchTerm = '';
    this.statusFilter = '';
    this.invoiceFilter = '';
    this.zoneFilter = '';
    this.planFilter = '';
    this.tierFilter = '';
    this.filterClients();
  }

  setViewMode(mode: ClientViewMode) {
    this.viewMode = mode;
  }

  speedGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-5', title: 'Hasta 5 Mbps', subtitle: 'Planes basicos y servicios livianos' },
      { key: '6-10', title: '6 a 10 Mbps', subtitle: 'Residencial pequeno' },
      { key: '11-20', title: '11 a 20 Mbps', subtitle: 'Residencial medio' },
      { key: '21-50', title: '21 a 50 Mbps', subtitle: 'Planes altos' },
      { key: 'gt-50', title: 'Mas de 50 Mbps', subtitle: 'Clientes premium o especiales' },
      { key: 'unknown', title: 'Sin velocidad clara', subtitle: 'Plan sin dato de Mbps detectado' },
    ];
    return this.buildGroups(definitions, (c) => this.speedGroupKey(c));
  }

  billingGroups(): ClientGroup[] {
    const definitions = [
      { key: 'day-15', title: 'Corte dia 15', subtitle: 'Clientes que facturan a mitad de mes' },
      { key: 'day-30', title: 'Corte dia 30/31', subtitle: 'Clientes que facturan a fin de mes' },
      { key: 'day-1-14', title: 'Corte dia 1-14', subtitle: 'Ciclos tempranos del mes' },
      { key: 'day-16-29', title: 'Corte dia 16-29', subtitle: 'Ciclos despues del dia 15' },
      { key: 'no-cut', title: 'Sin corte', subtitle: 'Sin fecha de corte registrada' },
    ];
    return this.buildGroups(definitions, (c) => this.billingGroupKey(c));
  }

  amountGroups(): ClientGroup[] {
    const definitions = [
      { key: 'lte-700', title: 'RD$ 700 o menos', subtitle: 'Facturas pequenas' },
      { key: '701-1000', title: 'RD$ 701 - 1,000', subtitle: 'Rango residencial comun' },
      { key: '1001-1500', title: 'RD$ 1,001 - 1,500', subtitle: 'Planes intermedios' },
      { key: 'gt-1500', title: 'Mas de RD$ 1,500', subtitle: 'Planes altos o especiales' },
      { key: 'unknown', title: 'Sin monto', subtitle: 'Sin precio de plan registrado' },
    ];
    return this.buildGroups(definitions, (c) => this.amountGroupKey(c));
  }

  previewClients(clients: WispHubClient[]): WispHubClient[] {
    return clients.slice(0, 8);
  }

  groupShare(count: number): number {
    const total = Math.max(this.filteredClients().length, 1);
    return Math.max(8, Math.round((count / total) * 100));
  }

  monthlyAmount(c: WispHubClient): number {
    return this.parseMoney(c.precio_plan);
  }

  invoiceShort(c: WispHubClient): string {
    if (this.hasPendingInvoices(c)) return 'Pendiente';
    if (this.isPaidClient(c)) return 'Pagada';
    return c.estado_facturas || '-';
  }

  billingCycleLabel(c: WispHubClient): string {
    const day = this.cutDay(c.fecha_corte);
    if (!day) return 'Sin corte';
    if (day === 15) return 'Dia 15';
    if (day >= 30) return 'Dia 30/31';
    return `Dia ${day}`;
  }

  countStatus(status: string): number {
    return this.allClients().filter(c => c.estado?.toLowerCase() === status).length;
  }

  countPendingInvoices(): number {
    return this.allClients().filter(c => this.hasPendingInvoices(c)).length;
  }

  countRiskClients(): number {
    return this.allClients().filter(c => this.isRiskClient(c)).length;
  }

  private hasPendingInvoices(c: WispHubClient): boolean {
    return c.estado_facturas?.toLowerCase().includes('pendiente') ?? false;
  }

  private isPaidClient(c: WispHubClient): boolean {
    const s = c.estado_facturas?.toLowerCase() || '';
    return s === 'pagada' || s === 'pagadas';
  }

  private isRiskClient(c: WispHubClient): boolean {
    const tier = this.getMetric(c.id_servicio)?.creditTier;
    return tier === 'RIESGO' || tier === 'CRITICO';
  }

  private buildGroups(
    definitions: { key: string; title: string; subtitle: string }[],
    keyFor: (client: WispHubClient) => string,
  ): ClientGroup[] {
    return definitions
      .map((definition) => {
        const clients = this.filteredClients().filter((client) => keyFor(client) === definition.key);
        return {
          ...definition,
          clients,
          totalMonthly: clients.reduce((sum, client) => sum + this.monthlyAmount(client), 0),
          activeCount: clients.filter((client) => client.estado?.toLowerCase() === 'activo').length,
          pendingCount: clients.filter((client) => this.hasPendingInvoices(client)).length,
        };
      })
      .filter((group) => group.clients.length > 0);
  }

  private speedGroupKey(c: WispHubClient): string {
    const speed = this.detectSpeedMbps(c);
    if (!speed) return 'unknown';
    if (speed <= 5) return 'lte-5';
    if (speed <= 10) return '6-10';
    if (speed <= 20) return '11-20';
    if (speed <= 50) return '21-50';
    return 'gt-50';
  }

  private amountGroupKey(c: WispHubClient): string {
    const amount = this.monthlyAmount(c);
    if (!amount) return 'unknown';
    if (amount <= 700) return 'lte-700';
    if (amount <= 1000) return '701-1000';
    if (amount <= 1500) return '1001-1500';
    return 'gt-1500';
  }

  private billingGroupKey(c: WispHubClient): string {
    const day = this.cutDay(c.fecha_corte);
    if (!day) return 'no-cut';
    if (day === 15) return 'day-15';
    if (day >= 30) return 'day-30';
    if (day < 15) return 'day-1-14';
    return 'day-16-29';
  }

  private detectSpeedMbps(c: WispHubClient): number | null {
    const text = [c.plan_internet?.nombre, c.servicio].filter(Boolean).join(' ');
    const matches = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(gb|g|mbps|mb|m|kbps|kb|k)\b/gi)];
    if (!matches.length) return null;
    const values = matches.map((match) => {
      const value = Number(String(match[1]).replace(',', '.'));
      const unit = match[2].toLowerCase();
      if (unit.startsWith('g')) return value * 1000;
      if (unit.startsWith('k')) return value / 1000;
      return value;
    });
    return Math.max(...values);
  }

  private cutDay(value: string | null | undefined): number | null {
    if (!value) return null;
    const iso = String(value).match(/\b\d{4}[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (iso) return this.validDay(Number(iso[2]));
    const local = String(value).match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
    if (local) return this.validDay(Number(local[1]));
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : this.validDay(date.getDate());
  }

  private validDay(day: number): number | null {
    return day >= 1 && day <= 31 ? day : null;
  }

  private parseMoney(value: string | number | null | undefined): number {
    if (typeof value === 'number') return value;
    const normalized = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '');
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  quitarEncuesta(c: WispHubClient) {
    if (!c.ip) {
      this.toast.error('Cliente sin IP asignada');
      return;
    }
    if (!confirm(`Pausar encuesta para ${c.nombre}?\n\nEl cliente navega normal. Si no la llena, el sistema volvera a recordarle en unas horas.`)) return;

    this.surveyLoading.set(c.id_servicio);
    this.survey.clear(c.ip, c.id_servicio).subscribe({
      next: (r) => {
        this.surveyLoading.set(null);
        if (r.ok) {
          const mtCleaned = r.mikrotik?.removed?.some((x: any) => x.wasInList);
          const detail = r.snoozed > 0
            ? `${r.snoozed} encuesta(s) pausada(s) por ${r.reminderIntervalHours || 4}h`
            : 'sin encuestas pendientes';
          this.toast.success(`Encuesta pausada: ${detail}${mtCleaned ? ', MikroTik limpio' : ''}`);
        } else {
          this.toast.error(r.error || 'No se pudo quitar la encuesta');
        }
      },
      error: (e) => {
        this.surveyLoading.set(null);
        this.toast.error(e.error?.error || e.message || 'Error al quitar encuesta');
      },
    });
  }

  async loadLocal() {
    this.loading.set(true);
    const clients = await this.db.getClients();
    this.allClients.set(clients);
    const plans = [...new Set(clients.map(c => c.plan_internet?.nombre).filter(Boolean))].sort();
    const zones = [...new Set(clients.map(c => c.zona?.nombre).filter(Boolean))].sort();
    this.allPlans.set(plans as string[]);
    this.allZones.set(zones as string[]);
    this.filterClients();
    this.loading.set(false);
  }

  filterClients() {
    let result = this.allClients();
    const term = this.searchTerm.toLowerCase().trim();

    if (term) {
      result = result.filter(c =>
        c.nombre?.toLowerCase().includes(term) ||
        c.ip?.includes(term) ||
        c.telefono?.includes(term) ||
        c.usuario?.toLowerCase().includes(term) ||
        c.cedula?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term) ||
        c.direccion?.toLowerCase().includes(term) ||
        c.zona?.nombre?.toLowerCase().includes(term) ||
        c.plan_internet?.nombre?.toLowerCase().includes(term) ||
        c.mac_cpe?.toLowerCase().includes(term)
      );
    }

    if (this.quickFilter === 'active') {
      result = result.filter(c => c.estado?.toLowerCase() === 'activo');
    } else if (this.quickFilter === 'debt') {
      result = result.filter(c => this.hasPendingInvoices(c));
    } else if (this.quickFilter === 'risk') {
      result = result.filter(c => this.isRiskClient(c));
    } else if (this.quickFilter === 'suspended') {
      result = result.filter(c => c.estado?.toLowerCase() === 'suspendido');
    }

    if (this.statusFilter) {
      result = result.filter(c => c.estado?.toLowerCase() === this.statusFilter);
    }

    if (this.invoiceFilter === 'pending') {
      result = result.filter(c => this.hasPendingInvoices(c));
    } else if (this.invoiceFilter === 'paid') {
      result = result.filter(c => this.isPaidClient(c));
    }

    if (this.zoneFilter) {
      result = result.filter(c => c.zona?.nombre === this.zoneFilter);
    }

    if (this.planFilter) {
      result = result.filter(c => c.plan_internet?.nombre === this.planFilter);
    }

    if (this.tierFilter) {
      result = result.filter(c => this.getMetric(c.id_servicio)?.creditTier === this.tierFilter);
    }

    if (this.sortCol) {
      result = [...result].sort((a, b) => {
        let valA: any, valB: any;
        if (this.sortCol === 'creditScore') {
          // Sort especial: usa el score del MetricsService
          valA = this.getMetric(a.id_servicio)?.creditScore ?? -1;
          valB = this.getMetric(b.id_servicio)?.creditScore ?? -1;
        } else {
          valA = this.getNestedVal(a, this.sortCol);
          valB = this.getNestedVal(b, this.sortCol);
        }
        const cmp = this.compareVals(valA, valB);
        return this.sortDir === 'asc' ? cmp : -cmp;
      });
    }

    this.filteredClients.set(result);
  }

  sort(col: string) {
    if (this.sortCol === col) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortCol = col;
      this.sortDir = 'asc';
    }
    this.filterClients();
  }

  sortIcon(col: string): string {
    if (this.sortCol !== col) return '';
    return this.sortDir === 'asc' ? '\u25B2' : '\u25BC';
  }

  openClient(idServicio: number | string) {
    this.router.navigate(['/clients', idServicio]);
  }

  private getNestedVal(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  private compareVals(a: any, b: any): number {
    if (a == null) return 1;
    if (b == null) return -1;
    const numA = parseFloat(a), numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return String(a).localeCompare(String(b), 'es');
  }

  syncClients() {
    this.syncing.set(true);
    this.syncMessage.set('Cargando todos los clientes desde WispHub...');

    this.api.getAllClients().subscribe({
      next: async (clients) => {
        await this.db.saveClients(clients);
        await this.db.updateSyncLog('clients');
        this.syncing.set(false);
        await this.loadLocal();
      },
      error: (err) => {
        this.syncMessage.set('Error: ' + (err.error?.detail || 'Sin conexion'));
        setTimeout(() => this.syncing.set(false), 3000);
      }
    });
  }

  getInitials(nombre: string): string {
    if (!nombre) return '?';
    const parts = nombre.trim().split(/\s+/);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
  }

  clientSubline(c: WispHubClient): string {
    const parts = [
      c.zona?.nombre,
      c.telefono,
      c.usuario,
    ].filter(Boolean);
    return parts.length ? parts.join(' · ') : (c.direccion || '-');
  }

  serviceSubline(c: WispHubClient): string {
    const parts = [
      c.ip || 'Sin IP',
      `RD$ ${c.precio_plan || '0'}`,
    ];
    return parts.join(' | ');
  }

  exportCSV() {
    this.exportSvc.exportCSV(this.filteredClients(), 'clientes', [
      { key: 'id_servicio', label: 'ID' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'telefono', label: 'Telefono' },
      { key: 'email', label: 'Email' },
      { key: 'cedula', label: 'Cedula' },
      { key: 'direccion', label: 'Direccion' },
      { key: 'plan_internet.nombre', label: 'Plan Internet' },
      { key: 'precio_plan', label: 'Precio' },
      { key: 'ip', label: 'IP' },
      { key: 'mac_cpe', label: 'MAC' },
      { key: 'estado', label: 'Estado' },
      { key: 'estado_facturas', label: 'Estado Facturas' },
      { key: 'zona.nombre', label: 'Zona' },
      { key: 'fecha_instalacion', label: 'Fecha Instalacion' },
      { key: 'fecha_corte', label: 'Fecha Corte' },
    ]);
  }

  getStatusClass(estado: string | null | undefined): string {
    const s = estado?.toLowerCase();
    if (s === 'activo') return 'active';
    if (s === 'suspendido' || s === 'cortado' || s === 'retirado') return 'suspended';
    if (s === 'gratis') return 'free';
    return 'default';
  }

  getFacturaClass(estado: string | null | undefined): string {
    const s = estado?.toLowerCase();
    if (s === 'pagadas' || s === 'pagada') return 'paid';
    if (s?.includes('pendiente')) return 'pending';
    return 'default';
  }
}
