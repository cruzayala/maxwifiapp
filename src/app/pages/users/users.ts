import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { NavbarComponent } from '../../components/layout/navbar';
import { AuthService, UserRole } from '../../services/auth.service';
import { ToastService } from '../../services/toast.service';
import { LucideEye, LucideEyeOff } from '@lucide/angular';
import { initialsOf } from '../../pipes/initials';

interface ManagedUser {
  id: number;
  username: string;
  fullName?: string | null;
  email?: string | null;
  role: UserRole;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt?: string;
}

type ModalMode = 'create' | 'edit' | 'password' | null;

@Component({
  selector: 'app-users',
  standalone: true,
  imports: [NavbarComponent, FormsModule, LucideEye, LucideEyeOff],
  template: `
    <app-navbar pageTitle="Usuarios" />

    <div class="page">
      <section class="page-heading">
        <div>
          <span class="eyebrow">Administración</span>
          <h2>Usuarios y accesos</h2>
          <p>Controla quiénes pueden entrar al sistema y qué acciones pueden realizar.</p>
        </div>
        @if (isSuperAdmin()) {
          <button class="btn btn-primary" type="button" (click)="openCreate()">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
            Crear usuario
          </button>
        }
      </section>

      @if (forbidden()) {
        <section class="state-panel error-state">
          <div class="state-icon">!</div>
          <h3>Acceso restringido</h3>
          <p>Solo un administrador puede consultar los usuarios del sistema. Si necesitas acceso, pídeselo al administrador.</p>
        </section>
      } @else {
        <section class="summary-grid" aria-label="Resumen de usuarios">
          <div class="summary-item">
            <span class="summary-label">Total</span>
            <strong>{{ users().length }}</strong>
            <span class="summary-note">cuentas registradas</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Activos</span>
            <strong class="green">{{ activeCount() }}</strong>
            <span class="summary-note">pueden iniciar sesión</span>
          </div>
          <div class="summary-item">
            <span class="summary-label">Administradores</span>
            <strong class="blue">{{ adminCount() }}</strong>
            <span class="summary-note">acceso de gestión</span>
          </div>
        </section>

        <section class="table-panel">
          <div class="panel-toolbar">
            <div>
              <h3>Usuarios registrados</h3>
              <span class="toolbar-note">Las claves se almacenan cifradas y nunca se muestran.</span>
            </div>
            <label class="search-field">
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
              <input type="search" [(ngModel)]="searchTerm" placeholder="Buscar por nombre, usuario o rol…" aria-label="Buscar usuario" />
            </label>
          </div>

          @if (loading()) {
            <div class="state-panel compact"><div class="spinner"></div><p>Cargando usuarios…</p></div>
          } @else if (filteredUsers().length === 0) {
            <div class="state-panel compact"><div class="state-icon muted-icon">–</div>
              @if (searchTerm.trim()) {
                <h3>Sin resultados</h3><p>Ningún usuario coincide con “{{ searchTerm.trim() }}”. Revisa lo que escribiste o borra la búsqueda.</p>
              } @else {
                <h3>No hay usuarios</h3><p>Todavía no hay cuentas registradas{{ isSuperAdmin() ? '. Toca “Crear usuario” para agregar la primera.' : '.' }}</p>
              }
            </div>
          } @else {
            <div class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Último acceso</th>
                    <th class="actions-heading">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  @for (user of filteredUsers(); track user.id) {
                    <tr>
                      <td>
                        <div class="user-cell">
                          <div class="avatar">{{ initials(user) }}</div>
                          <div>
                            <strong>{{ user.fullName || user.username }}@if (user.id === currentUserId()) { <em class="you-tag">Tú</em> }</strong>
                            <span>{{ '@' + user.username }}{{ user.email ? ' · ' + user.email : '' }}</span>
                          </div>
                        </div>
                      </td>
                      <td><span class="role-badge" [class.super]="user.role === 'super_admin'">{{ roleLabel(user.role) }}</span></td>
                      <td>
                        <span class="status-badge" [class.active]="user.isActive" [class.inactive]="!user.isActive">
                          <span class="status-dot"></span>{{ user.isActive ? 'Activo' : 'Inactivo' }}
                        </span>
                      </td>
                      <td class="last-login">{{ formatDate(user.lastLoginAt) }}</td>
                      <td>
                        <div class="row-actions">
                          <button class="icon-btn" type="button" title="Editar usuario" aria-label="Editar usuario" (click)="openEdit(user)">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg>
                          </button>
                          @if (canChangePassword(user)) {
                            <button class="icon-btn" type="button" title="Cambiar clave" aria-label="Cambiar clave" (click)="openPassword(user)">
                              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0 1 10 0v3"/><circle cx="12" cy="16" r="1"/></svg>
                            </button>
                          }
                          @if (isSuperAdmin() && user.id !== currentUserId()) {
                            <button class="icon-btn danger" type="button" title="Eliminar usuario" aria-label="Eliminar usuario" (click)="removeUser(user)">
                              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15M10 11v6m4-6v6"/></svg>
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }
    </div>

    @if (modalMode()) {
      <div class="modal-backdrop" (click)="closeModal()">
        <section class="modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="modalTitleId" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <span class="eyebrow">{{ modalMode() === 'password' ? 'Seguridad' : 'Cuenta de acceso' }}</span>
              <h3 [id]="modalTitleId">{{ modalTitle() }}</h3>
            </div>
            <button class="close-btn" type="button" title="Cerrar" aria-label="Cerrar" (click)="closeModal()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
            </button>
          </div>

          @if (modalMode() === 'password') {
            <form (ngSubmit)="savePassword()">
              <p class="modal-copy">Actualiza la clave de <strong>{{ selectedUser()?.username }}</strong>.</p>
              @if (!isSuperAdmin()) {
                <label class="form-field"><span>Clave actual</span><input [type]="showPass() ? 'text' : 'password'" name="currentPassword" [(ngModel)]="passwordForm.currentPassword" autocomplete="current-password" required /></label>
              }
              <label class="form-field"><span>Nueva clave</span>
                <div class="pass-wrap">
                  <input [type]="showPass() ? 'text' : 'password'" name="newPassword" [(ngModel)]="passwordForm.newPassword" minlength="6" autocomplete="new-password" required />
                  <button type="button" class="eye-btn" [attr.aria-label]="showPass() ? 'Ocultar clave' : 'Mostrar clave'" [title]="showPass() ? 'Ocultar clave' : 'Mostrar clave'" (click)="showPass.set(!showPass())">
                    @if (showPass()) { <svg lucideEyeOff size="16"></svg> } @else { <svg lucideEye size="16"></svg> }
                  </button>
                </div>
                <small [class.warn]="passwordForm.newPassword.length > 0 && passwordForm.newPassword.length < 6">
                  {{ passwordForm.newPassword.length > 0 && passwordForm.newPassword.length < 6 ? 'Faltan ' + (6 - passwordForm.newPassword.length) + ' caracteres (mínimo 6).' : 'Mínimo 6 caracteres.' }}
                </small>
              </label>
              <div class="modal-actions"><button class="btn btn-secondary" type="button" (click)="closeModal()">Cancelar</button><button class="btn btn-primary" type="submit" [disabled]="busy() || passwordForm.newPassword.length < 6">{{ busy() ? 'Guardando…' : 'Cambiar clave' }}</button></div>
            </form>
          } @else {
            <form (ngSubmit)="saveUser()">
              @if (modalMode() === 'create') {
                <div class="form-row">
                  <label class="form-field"><span>Usuario *</span><input type="text" name="username" [(ngModel)]="userForm.username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Ej.: maria" required /><small>Con este nombre entrará al sistema.</small></label>
                  <label class="form-field"><span>Clave *</span>
                    <div class="pass-wrap">
                      <input [type]="showPass() ? 'text' : 'password'" name="password" [(ngModel)]="userForm.password" minlength="6" autocomplete="new-password" required />
                      <button type="button" class="eye-btn" [attr.aria-label]="showPass() ? 'Ocultar clave' : 'Mostrar clave'" [title]="showPass() ? 'Ocultar clave' : 'Mostrar clave'" (click)="showPass.set(!showPass())">
                        @if (showPass()) { <svg lucideEyeOff size="16"></svg> } @else { <svg lucideEye size="16"></svg> }
                      </button>
                    </div>
                    <small [class.warn]="userForm.password.length > 0 && userForm.password.length < 6">
                      {{ userForm.password.length > 0 && userForm.password.length < 6 ? 'Faltan ' + (6 - userForm.password.length) + ' caracteres (mínimo 6).' : 'Mínimo 6 caracteres.' }}
                    </small>
                  </label>
                </div>
              } @else {
                <div class="account-reference"><span>Usuario</span><strong>{{ selectedUser()?.username }}</strong></div>
              }
              <div class="form-row">
                <label class="form-field"><span>Nombre completo</span><input type="text" name="fullName" [(ngModel)]="userForm.fullName" autocomplete="name" /></label>
                <label class="form-field"><span>Correo</span><input type="email" name="email" [(ngModel)]="userForm.email" autocomplete="email" /></label>
              </div>
              <div class="form-row">
                <label class="form-field"><span>Rol</span><select name="role" [(ngModel)]="userForm.role" [disabled]="!isSuperAdmin()"><option value="admin">Administrador</option><option value="tecnico">Técnico</option><option value="cobranza">Cobranza</option><option value="viewer">Consulta</option><option value="super_admin">Super administrador</option></select><small>{{ !isSuperAdmin() ? 'Solo el super administrador puede cambiar el rol.' : roleHelp(userForm.role) }}</small></label>
                @if (modalMode() === 'edit') {
                  <label class="toggle-field"><input type="checkbox" name="isActive" [(ngModel)]="userForm.isActive" /><span><strong>Usuario activo</strong><small>{{ userForm.isActive ? 'Puede iniciar sesión' : 'No podrá iniciar sesión' }}</small></span></label>
                }
              </div>
              @if (modalMode() === 'edit' && !userForm.isActive && selectedUser()?.id === currentUserId()) {
                <p class="self-warn">Estás desactivando tu propia cuenta: no podrás volver a entrar hasta que otro administrador la active.</p>
              }
              @if (modalMode() === 'create' && (!userForm.username.trim() || userForm.password.length < 6)) {
                <p class="form-hint">{{ !userForm.username.trim() ? 'Falta el nombre de usuario.' : 'La clave debe tener al menos 6 caracteres.' }}</p>
              }
              <div class="modal-actions"><button class="btn btn-secondary" type="button" (click)="closeModal()">Cancelar</button><button class="btn btn-primary" type="submit" [disabled]="busy() || (modalMode() === 'create' && (!userForm.username.trim() || userForm.password.length < 6))">{{ busy() ? 'Guardando…' : (modalMode() === 'create' ? 'Crear usuario' : 'Guardar cambios') }}</button></div>
            </form>
          }
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-height: 100vh; }
    .page { padding: 28px 32px 44px; max-width: 1480px; margin: 0 auto; }
    .page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
    .eyebrow { display: block; color: #0b6b52; font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
    h2, h3, p { margin: 0; }
    h2 { color: #15211c; font-size: 24px; letter-spacing: 0; }
    .page-heading p { color: #56665e; font-size: 14px; margin-top: 7px; }
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 9px; min-height: 42px; padding: 0 16px; font-size: 13px; font-weight: 700; cursor: pointer; transition: .2s ease; }
    .btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .btn:disabled { opacity: .55; cursor: not-allowed; }
    .btn-primary { background: #0b6b52; color: white; }
    .btn-primary:hover:not(:disabled) { background: #08523f; }
    .btn-secondary { background: #eef2ee; color: #44534b; }
    .btn-secondary:hover { background: #e0e6e1; }
    .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 18px; }
    .summary-item { background: white; border: 1px solid #e0e6e1; border-radius: 12px; padding: 17px 19px; }
    .summary-label, .summary-note { display: block; color: #5d6d65; font-size: 12px; }
    .summary-item strong { display: block; color: #15211c; font-size: 22px; line-height: 1.1; margin: 8px 0 4px; }
    .summary-item strong.green { color: #0f7a53; }.summary-item strong.blue { color: #0b6b52; }
    .table-panel { background: white; border: 1px solid #e0e6e1; border-radius: 12px; overflow: hidden; }
    .panel-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 20px 22px; border-bottom: 1px solid #e0e6e1; }
    .panel-toolbar h3 { color: #12201a; font-size: 15px; }.toolbar-note { display: block; color: #56665e; font-size: 12px; margin-top: 4px; }
    .search-field { display: flex; align-items: center; gap: 8px; min-width: 240px; padding: 9px 12px; border: 1px solid #e0e6e1; border-radius: 9px; color: #8d9a93; }
    .search-field:focus-within { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82,.12); }.search-field svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .search-field input { width: 100%; border: 0; outline: 0; background: transparent; color: #334155; font-size: 13px; }
    .table-wrap { overflow-x: auto; } table { width: 100%; border-collapse: collapse; min-width: 760px; } th, td { text-align: left; padding: 14px 22px; border-bottom: 1px solid #eef2ee; } th { color: #5d6d65; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; font-weight: 800; background: #fafbfc; } td { color: #334155; font-size: 13px; vertical-align: middle; } tbody tr:last-child td { border-bottom: 0; } tbody tr:hover { background: #f4f6f2; }.actions-heading { text-align: right; }
    .user-cell { display: flex; align-items: center; gap: 11px; min-width: 240px; }.user-cell strong, .user-cell span { display: block; }.user-cell strong { color: #12201a; font-size: 13px; }.user-cell span { color: #56665e; font-size: 12px; margin-top: 3px; }.avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 12px; color: #0b6b52; background: #e6f2ec; font-weight: 800; font-size: 11px; flex: 0 0 auto; }
    .role-badge, .status-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 5px 9px; font-size: 11px; font-weight: 700; white-space: nowrap; }.role-badge { color: #44534b; background: #eef2ee; }.role-badge.super { color: #08523f; background: #e6f2ec; }.status-badge.active { color: #0f7a53; background: #e9f8f1; }.status-badge.inactive { color: #b42318; background: #fff0ef; }.status-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }.last-login { color: #5d6d65; white-space: nowrap; }.row-actions { display: flex; justify-content: flex-end; gap: 5px; }.icon-btn, .close-btn { display: inline-grid; place-items: center; border: 0; background: transparent; color: #5d6d65; cursor: pointer; border-radius: 10px; }.icon-btn { width: 32px; height: 32px; }.icon-btn:hover { background: #e6f2ec; color: #0b6b52; }.icon-btn.danger:hover { background: #fff0ef; color: #b42318; }.icon-btn svg, .close-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .state-panel { display: grid; place-items: center; text-align: center; padding: 56px 20px; color: #5d6d65; }.state-panel h3 { color: #334155; font-size: 16px; margin-top: 10px; }.state-panel p { font-size: 13px; margin-top: 5px; }.state-panel.compact { padding: 46px 20px; }.error-state { background: white; border: 1px solid #fecaca; border-radius: 12px; }.state-icon { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; color: #b91c1c; background: #fee2e2; font-weight: 900; }.muted-icon { color: #5d6d65; background: #eef2ee; }.spinner { width: 22px; height: 22px; border: 3px solid #e0e6e1; border-top-color: #0b6b52; border-radius: 50%; animation: spin .8s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
    .modal-backdrop { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; padding: 20px; background: rgba(14, 29, 23,.48); backdrop-filter: blur(3px); }.modal { width: min(560px, 100%); max-height: calc(100vh - 40px); overflow-y: auto; background: white; border-radius: 12px; box-shadow: 0 24px 80px rgba(14, 29, 23,.25); }.modal-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 22px 24px 16px; border-bottom: 1px solid #e0e6e1; }.modal-header h3 { color: #12201a; font-size: 19px; }.close-btn { width: 32px; height: 32px; }.close-btn:hover { background: #eef2ee; color: #12201a; }.modal form { padding: 20px 24px 24px; }.modal-copy { color: #5d6d65; font-size: 13px; margin-bottom: 18px; }.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.form-field { display: block; margin-bottom: 15px; }.form-field span, .toggle-field strong { display: block; color: #44534b; font-size: 12px; font-weight: 700; margin-bottom: 6px; }.form-field input, .form-field select { width: 100%; height: 40px; border: 1px solid #cdd6d0; border-radius: 12px; padding: 0 11px; color: #334155; background: white; outline: 0; font: inherit; font-size: 13px; }.form-field input:focus, .form-field select:focus { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82,.12); }.form-field select:disabled { background: #f4f6f2; color: #8d9a93; }.form-field small, .toggle-field small { display: block; color: #56665e; font-size: 11px; margin-top: 5px; }.form-field small.warn { color: #b36b12; }.toggle-field { display: flex; align-items: center; gap: 10px; padding-top: 23px; cursor: pointer; }.toggle-field input { width: 17px; height: 17px; accent-color: #0b6b52; }.toggle-field strong { margin: 0; color: #334155; }.account-reference { display: flex; justify-content: space-between; align-items: center; padding: 11px 13px; background: #f4f6f2; border-radius: 12px; margin-bottom: 15px; font-size: 13px; }.account-reference span { color: #5d6d65; }.account-reference strong { color: #12201a; }.modal-actions { display: flex; justify-content: flex-end; gap: 9px; padding-top: 8px; margin-top: 4px; border-top: 1px solid #eef2ee; }
    .pass-wrap { position: relative; }.pass-wrap input { padding-right: 40px !important; }.eye-btn { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); width: 32px; height: 32px; display: grid; place-items: center; background: none; border: 0; border-radius: 9px; color: #56665e; cursor: pointer; }.eye-btn:hover { background: #eef6f1; color: #0b6b52; }
    .you-tag { font-style: normal; font-size: 11px; font-weight: 700; color: #0b6b52; background: #e6f2ec; border-radius: 999px; padding: 1px 7px; margin-left: 6px; }
    .self-warn { margin: 0 0 12px; padding: 9px 12px; border-radius: 9px; background: #fff6e8; color: #8a5410; font-size: 12px; }
    .form-hint { margin: 0 0 10px; font-size: 12px; color: #56665e; }
    @media (max-width: 760px) { .page { padding: 20px 14px 32px; }.page-heading { align-items: flex-start; flex-direction: column; }.summary-grid { grid-template-columns: 1fr; }.panel-toolbar { align-items: stretch; flex-direction: column; }.search-field { min-width: 0; }.form-row { grid-template-columns: 1fr; gap: 0; }.toggle-field { padding-top: 0; margin-bottom: 15px; }.modal { border-radius: 12px; } }
  `]
})
export class UsersComponent implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  users = signal<ManagedUser[]>([]);
  loading = signal(true);
  busy = signal(false);
  forbidden = signal(false);
  searchTerm = '';
  modalMode = signal<ModalMode>(null);
  selectedUser = signal<ManagedUser | null>(null);
  readonly modalTitleId = 'user-modal-title';
  /** Mostrar/ocultar las claves en los formularios (solo visual). */
  showPass = signal(false);

  userForm: { username: string; password: string; fullName: string; email: string; role: UserRole; isActive: boolean } = this.emptyUserForm();
  passwordForm = { currentPassword: '', newPassword: '' };

  ngOnInit() {
    this.loadUsers();
  }

  isSuperAdmin() { return this.auth.hasRole(['super_admin']); }
  currentUserId() { return this.auth.currentUser()?.id ?? 0; }
  activeCount() { return this.users().filter(user => user.isActive).length; }
  adminCount() { return this.users().filter(user => user.role === 'admin' || user.role === 'super_admin').length; }

  filteredUsers() {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this.users();
    return this.users().filter(user => [user.username, user.fullName, user.email, this.roleLabel(user.role)].some(value => String(value || '').toLowerCase().includes(term)));
  }

  loadUsers() {
    this.loading.set(true);
    this.http.get<ManagedUser[]>('/users').subscribe({
      next: users => { this.users.set(users); this.loading.set(false); },
      error: error => {
        this.loading.set(false);
        this.forbidden.set(error.status === 401 || error.status === 403);
        this.toast.error(error.error?.error || 'No se pudieron cargar los usuarios');
      },
    });
  }

  openCreate() {
    this.userForm = this.emptyUserForm();
    this.selectedUser.set(null);
    this.showPass.set(false);
    this.modalMode.set('create');
  }

  openEdit(user: ManagedUser) {
    this.userForm = { username: user.username, password: '', fullName: user.fullName || '', email: user.email || '', role: user.role, isActive: user.isActive };
    this.selectedUser.set(user);
    this.modalMode.set('edit');
  }

  openPassword(user: ManagedUser) {
    this.passwordForm = { currentPassword: '', newPassword: '' };
    this.selectedUser.set(user);
    this.showPass.set(false);
    this.modalMode.set('password');
  }

  closeModal() {
    if (!this.busy()) this.modalMode.set(null);
  }

  modalTitle() {
    if (this.modalMode() === 'create') return 'Crear usuario';
    if (this.modalMode() === 'password') return 'Cambiar clave';
    return 'Editar usuario';
  }

  saveUser() {
    if (this.modalMode() === 'create') {
      if (!this.userForm.username.trim() || this.userForm.password.length < 6) {
        this.toast.error('Escribe el usuario y una clave de al menos 6 caracteres');
        return;
      }
      this.busy.set(true);
      this.http.post<ManagedUser>('/users', { ...this.userForm, username: this.userForm.username.trim(), fullName: this.userForm.fullName.trim(), email: this.userForm.email.trim() }).subscribe({
        next: created => { this.users.update(users => [created, ...users]); this.busy.set(false); this.modalMode.set(null); this.toast.success('Usuario creado correctamente'); },
        error: error => { this.busy.set(false); this.toast.error(error.error?.error || 'No se pudo crear el usuario'); },
      });
      return;
    }

    const user = this.selectedUser();
    if (!user) return;
    this.busy.set(true);
    const payload: Record<string, string | boolean> = { fullName: this.userForm.fullName.trim(), email: this.userForm.email.trim(), isActive: this.userForm.isActive };
    if (this.isSuperAdmin()) payload['role'] = this.userForm.role;
    this.http.patch<ManagedUser>(`/users/${user.id}`, payload).subscribe({
      next: updated => { this.users.update(users => users.map(item => item.id === updated.id ? { ...item, ...updated } : item)); this.busy.set(false); this.modalMode.set(null); this.toast.success('Usuario actualizado'); },
      error: error => { this.busy.set(false); this.toast.error(error.error?.error || 'No se pudo actualizar el usuario'); },
    });
  }

  savePassword() {
    const user = this.selectedUser();
    if (!user || this.passwordForm.newPassword.length < 6) {
      this.toast.error('La nueva clave debe tener mínimo 6 caracteres');
      return;
    }
    this.busy.set(true);
    this.http.post(`/users/${user.id}/password`, this.passwordForm).subscribe({
      next: () => { this.busy.set(false); this.modalMode.set(null); this.toast.success('Clave actualizada'); },
      error: error => { this.busy.set(false); this.toast.error(error.error?.error || 'No se pudo cambiar la clave'); },
    });
  }

  canChangePassword(user: ManagedUser) {
    return this.isSuperAdmin() || user.id === this.currentUserId();
  }

  removeUser(user: ManagedUser) {
    if (!confirm(`¿Eliminar el usuario "${user.username}"${user.fullName ? ' (' + user.fullName + ')' : ''}?\n\nYa no podrá entrar al sistema. Esta acción no se puede deshacer.`)) return;
    this.busy.set(true);
    this.http.delete(`/users/${user.id}`).subscribe({
      next: () => { this.users.update(users => users.filter(item => item.id !== user.id)); this.busy.set(false); this.toast.success('Usuario eliminado'); },
      error: error => { this.busy.set(false); this.toast.error(error.error?.error || 'No se pudo eliminar el usuario'); },
    });
  }

  roleLabel(role: UserRole) {
    const labels: Record<UserRole, string> = { super_admin: 'Super administrador', admin: 'Administrador', tecnico: 'Técnico', cobranza: 'Cobranza', viewer: 'Consulta' };
    return labels[role] || role;
  }

  /** Descripción corta de cada rol para el formulario (solo texto de ayuda). */
  roleHelp(role: UserRole) {
    const help: Record<UserRole, string> = {
      super_admin: 'Acceso total. Es el único que puede crear y eliminar usuarios o cambiar roles.',
      admin: 'Todos los módulos, incluidos inventario, gastos, nómina y configuración.',
      tecnico: 'Módulos de red y soporte (MikroTik, OLT, averías, mapa).',
      cobranza: 'Facturas, morosos y mensajes de WhatsApp a clientes.',
      viewer: 'Solo consulta, sin acceso a los módulos de gestión.',
    };
    return help[role] || '';
  }

  initials(user: ManagedUser) {
    return initialsOf(user.fullName || user.username);
  }

  formatDate(value?: string | null) {
    return value ? new Date(value).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' }) : 'Nunca';
  }

  private emptyUserForm() {
    return { username: '', password: '', fullName: '', email: '', role: 'admin' as UserRole, isActive: true };
  }
}
