import { AfterViewInit, Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { LucideCircleAlert, LucideEye, LucideEyeOff, LucideLogIn } from '@lucide/angular';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule, LucideCircleAlert, LucideEye, LucideEyeOff, LucideLogIn],
  template: `
    <div class="login-container">
      <div class="login-card">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <h1>ISP <span>MAX</span></h1>
          <p>Centro de control · Ingresa con tu cuenta</p>
        </div>

        <form (submit)="login(); $event.preventDefault()" novalidate>
          <label class="field">
            <span>Usuario</span>
            <input
              #userInput
              type="text"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [(ngModel)]="username"
              (ngModelChange)="error.set('')"
              name="username"
              placeholder="Tu nombre de usuario"
              class="text-input"
              [class.invalid]="!!error()" />
          </label>

          <label class="field">
            <span>Clave</span>
            <div class="password-wrap">
              <input
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="current-password"
                [(ngModel)]="password"
                (ngModelChange)="error.set('')"
                (keyup)="checkCapsLock($event)"
                name="password"
                placeholder="Tu clave"
                class="text-input"
                [class.invalid]="!!error()" />
              <button type="button" class="toggle-pass"
                [attr.aria-label]="showPassword() ? 'Ocultar clave' : 'Mostrar clave'"
                [title]="showPassword() ? 'Ocultar clave' : 'Mostrar clave'"
                [attr.aria-pressed]="showPassword()"
                (click)="showPassword.set(!showPassword())">
                @if (showPassword()) { <svg lucideEyeOff size="18"></svg> } @else { <svg lucideEye size="18"></svg> }
              </button>
            </div>
            @if (capsLock()) {
              <small class="hint warn">Tienes activadas las mayúsculas (Bloq Mayús).</small>
            }
          </label>

          @if (error()) {
            <div class="error-msg" role="alert">
              <svg lucideCircleAlert size="16"></svg>
              <span>{{ error() }}</span>
            </div>
          }

          <button type="submit" class="btn-login" [disabled]="loading() || !username || !password">
            @if (loading()) {
              <div class="spinner"></div>
            } @else {
              <svg lucideLogIn size="18"></svg>
            }
            <span>{{ loading() ? 'Validando…' : 'Ingresar' }}</span>
          </button>
          @if (!loading() && (!username || !password)) {
            <p class="hint center">Escribe tu usuario y tu clave para continuar.</p>
          }
        </form>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at 20% 10%, #1b2a38 0%, #111a24 55%, #0c131b 100%);
      padding: 20px 16px;
      box-sizing: border-box;
    }

    .login-card {
      background: white;
      border-radius: 8px;
      border-top: 4px solid #1e8a67;
      padding: 36px 32px 32px;
      width: 100%;
      max-width: 400px;
      box-sizing: border-box;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .brand { text-align: center; margin-bottom: 28px; }
    .brand-mark {
      width: 48px; height: 48px; margin: 0 auto 14px;
      display: flex; align-items: flex-end; justify-content: center; gap: 4px;
      padding: 11px; box-sizing: border-box;
      background: #1e8a67; border-radius: 8px;
      box-shadow: 0 6px 16px rgba(30, 138, 103, 0.28);
    }
    .brand-mark span { width: 5px; background: #fff; border-radius: 1px; }
    .brand-mark span:nth-child(1) { height: 10px; opacity: 0.72; }
    .brand-mark span:nth-child(2) { height: 17px; opacity: 0.86; }
    .brand-mark span:nth-child(3) { height: 25px; }
    .brand h1 { margin: 0 0 6px; font-size: 24px; font-weight: 800; color: #172535; letter-spacing: 0.2px; }
    .brand h1 span { color: #1e8a67; }
    .brand p { margin: 0; color: #667582; font-size: 13px; }

    .field { display: block; margin-bottom: 14px; }
    .field > span { display: block; font-size: 12px; color: #334250; margin-bottom: 6px; font-weight: 600; }
    .text-input {
      width: 100%; padding: 11px 12px;
      border: 1px solid #ccd6de;
      border-radius: 6px;
      font-size: 15px;
      outline: none; box-sizing: border-box;
      color: #172535;
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .text-input::placeholder { color: #8a97a3; }
    .text-input:focus { border-color: #1267dd; box-shadow: 0 0 0 3px rgba(18, 103, 221, 0.14); }
    .text-input.invalid { border-color: #b42318; }

    .password-wrap { position: relative; }
    .password-wrap .text-input { padding-right: 44px; }
    .toggle-pass {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 36px; height: 36px; display: grid; place-items: center;
      background: none; border: none; border-radius: 6px; cursor: pointer; color: #667582;
    }
    .toggle-pass:hover { background: #f2f7ff; color: #1267dd; }

    .hint { display: block; margin: 6px 0 0; font-size: 12px; color: #667582; }
    .hint.warn { color: #b36b12; }
    .hint.center { text-align: center; margin-top: 10px; }

    .error-msg {
      display: flex; align-items: flex-start; gap: 8px;
      background: #fff0ef; color: #b42318; border: 1px solid #f5c9c4;
      padding: 10px 12px; border-radius: 6px;
      font-size: 13px; margin-bottom: 14px; font-weight: 500; line-height: 1.4;
    }
    .error-msg svg { flex-shrink: 0; margin-top: 1px; }

    .btn-login {
      width: 100%; padding: 12px;
      border: none; border-radius: 6px;
      background: #1267dd; color: white;
      font-size: 15px; font-weight: 600;
      cursor: pointer; transition: background 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-top: 6px;
    }
    .btn-login:hover:not(:disabled) { background: #0d58c0; }
    .btn-login:disabled { opacity: 0.55; cursor: not-allowed; }

    .spinner {
      width: 18px; height: 18px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    @media (max-width: 420px) {
      .login-card { padding: 28px 20px 24px; }
    }
  `]
})
export class LoginComponent implements AfterViewInit {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private userInput = viewChild<ElementRef<HTMLInputElement>>('userInput');

  username = '';
  password = '';
  loading = signal(false);
  error = signal('');
  showPassword = signal(false);
  capsLock = signal(false);

  ngAfterViewInit() {
    // Foco automático en el usuario (el atributo autofocus no es fiable en navegación SPA).
    setTimeout(() => this.userInput()?.nativeElement.focus(), 0);
  }

  checkCapsLock(event: KeyboardEvent) {
    this.capsLock.set(!!event.getModifierState?.('CapsLock'));
  }

  login() {
    if (!this.username || !this.password) return;
    this.loading.set(true);
    this.error.set('');

    this.auth.login(this.username, this.password).subscribe({
      next: () => {
        this.loading.set(false);
        const returnUrl = this.route.snapshot.queryParams['return'] || '/dashboard';
        this.router.navigateByUrl(returnUrl);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(this.friendlyError(e));
        this.password = '';
      }
    });
  }

  /** Solo cambia el texto mostrado; la autenticación no se toca. */
  private friendlyError(e: any): string {
    const status = e?.status;
    if (status === 0) return 'No se pudo conectar con el servidor. Revisa tu conexión a internet e intenta de nuevo.';
    if (status === 401) return 'Usuario o clave incorrectos. Verifica e intenta de nuevo.';
    if (status === 429) return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
    if (status >= 500) return 'El servidor tuvo un problema al validar tu cuenta. Intenta de nuevo en un momento.';
    const msg = e?.error?.error;
    if (msg === 'username y password requeridos') return 'Escribe tu usuario y tu clave.';
    return msg || 'Usuario o clave incorrectos.';
  }
}
