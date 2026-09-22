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
      <aside class="brand-panel" aria-hidden="true">
        <div class="brand-row">
          <div class="brand-mark"><span></span><span></span><span></span></div>
          <strong>ISP Max</strong>
        </div>
        <div class="brand-pitch">
          <h2>Toda tu red, tus clientes y tu cobranza en un solo lugar.</h2>
          <p>WispHub, MikroTik, la OLT y WhatsApp conectados. Desde la oficina, el celular o la PC del taller.</p>
        </div>
        <div class="brand-foot">Web · Android · ONU Studio para Windows</div>
      </aside>
      <div class="login-card">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true">
            <span></span><span></span><span></span>
          </div>
          <h1>Entrar</h1>
          <p>Con tu usuario del personal de ISP Max.</p>
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
      min-height: 100vh; min-height: 100dvh;
      display: grid; grid-template-columns: minmax(420px, 44%) 1fr;
      background: #ffffff;
    }

    /* Panel de marca */
    .brand-panel {
      position: relative; overflow: hidden;
      display: flex; flex-direction: column; justify-content: space-between; gap: 32px;
      padding: 56px 60px; color: #fff;
      background:
        radial-gradient(90% 60% at 10% 0%, rgba(19, 147, 108, 0.45), transparent 60%),
        radial-gradient(70% 50% at 100% 100%, rgba(11, 107, 82, 0.35), transparent 60%),
        #0e1d17;
    }
    .brand-panel::after {
      content: ''; position: absolute; inset: auto -120px -160px auto; width: 420px; height: 420px; border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.06); box-shadow: 0 0 0 60px rgba(255, 255, 255, 0.02), 0 0 0 120px rgba(255, 255, 255, 0.015);
    }
    .brand-row { display: flex; align-items: center; gap: 12px; }
    .brand-row strong { font-family: var(--isp-display); font-size: 22px; font-weight: 700; }
    .brand-pitch h2 { margin: 0; color: #fff; font-family: var(--isp-display); font-size: 44px; line-height: 1.12; font-weight: 600; letter-spacing: -1px; max-width: 520px; }
    .brand-pitch p { margin: 18px 0 0; color: #a9bdb3; font-size: 16px; line-height: 1.55; max-width: 460px; }
    .brand-foot { color: #6f877b; font-size: 13px; position: relative; z-index: 1; }

    /* Formulario */
    .login-card {
      align-self: center; justify-self: center;
      width: 100%; max-width: 400px; padding: 32px 24px;
      box-sizing: border-box; animation: fadeIn 0.35s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .brand { margin-bottom: 26px; }
    .brand .brand-mark { display: none; }
    .brand-mark {
      width: 44px; height: 44px; flex: 0 0 44px;
      display: flex; align-items: flex-end; justify-content: center; gap: 4px;
      padding: 10px; box-sizing: border-box; border-radius: 12px;
      background: linear-gradient(160deg, #13936c, #0b6b52);
      box-shadow: 0 8px 18px rgba(11, 107, 82, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.18);
    }
    .brand-mark span { width: 5px; background: #fff; border-radius: 2px; }
    .brand-mark span:nth-child(1) { height: 9px; opacity: 0.72; }
    .brand-mark span:nth-child(2) { height: 15px; opacity: 0.86; }
    .brand-mark span:nth-child(3) { height: 22px; }
    .brand h1 { margin: 0 0 6px; font-family: var(--isp-display); font-size: 32px; font-weight: 600; color: #15211c; letter-spacing: -0.5px; }
    .brand p { margin: 0; color: #56665e; font-size: 14px; }

    @media (max-width: 900px) {
      .login-container { grid-template-columns: 1fr; grid-template-rows: auto 1fr; background: #0e1d17; }
      .brand-panel { padding: 34px 24px 70px; gap: 18px; }
      .brand-pitch h2 { font-size: 27px; letter-spacing: -0.5px; }
      .brand-pitch p { font-size: 14.5px; margin-top: 10px; }
      .brand-foot { display: none; }
      .login-card {
        position: relative; z-index: 2; align-self: stretch; max-width: none; margin-top: -44px;
        padding: 30px 22px calc(28px + env(safe-area-inset-bottom));
        background: #fff; border-radius: 24px 24px 0 0; box-shadow: 0 -10px 30px rgba(0, 0, 0, 0.18);
      }
      .brand h1 { font-size: 26px; }
    }

    .field { display: block; margin-bottom: 14px; }
    .field > span { display: block; font-size: 12px; color: #2d3b34; margin-bottom: 6px; font-weight: 600; }
    .text-input {
      width: 100%; min-height: 48px; padding: 11px 14px;
      border: 1px solid #cfd8d2;
      border-radius: 12px;
      font-size: 15px;
      outline: none; box-sizing: border-box;
      color: #15211c;
      background: #fff;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .text-input::placeholder { color: #8a97a3; }
    .text-input:focus { border-color: #0b6b52; box-shadow: 0 0 0 3px rgba(11, 107, 82, 0.14); }
    .text-input.invalid { border-color: #b42318; }

    .password-wrap { position: relative; }
    .password-wrap .text-input { padding-right: 44px; }
    .toggle-pass {
      position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
      width: 36px; height: 36px; display: grid; place-items: center;
      background: none; border: none; border-radius: 9px; cursor: pointer; color: #56665e;
    }
    .toggle-pass:hover { background: #eef6f1; color: #0b6b52; }

    .hint { display: block; margin: 6px 0 0; font-size: 12px; color: #56665e; }
    .hint.warn { color: #b36b12; }
    .hint.center { text-align: center; margin-top: 10px; }

    .error-msg {
      display: flex; align-items: flex-start; gap: 8px;
      background: #fff0ef; color: #b42318; border: 1px solid #f5c9c4;
      padding: 10px 12px; border-radius: 9px;
      font-size: 13px; margin-bottom: 14px; font-weight: 500; line-height: 1.4;
    }
    .error-msg svg { flex-shrink: 0; margin-top: 1px; }

    .btn-login {
      width: 100%; min-height: 50px; padding: 12px;
      border: none; border-radius: 12px;
      background: linear-gradient(180deg, #11855f, #0b6b52); box-shadow: 0 8px 18px rgba(11, 107, 82, 0.28); color: white;
      font-size: 15px; font-weight: 600;
      cursor: pointer; transition: background 0.15s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-top: 6px;
    }
    .btn-login:hover:not(:disabled) { background: #08523f; }
    .btn-login:disabled { opacity: 0.55; cursor: not-allowed; }

    .spinner {
      width: 18px; height: 18px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

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
