import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="login-container">
      <div class="login-card">
        <div class="brand">
          <div class="brand-icon">
            <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" rx="8" fill="#6366f1"/>
              <path d="M8 16L14 22L24 10" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h1>WISP RD</h1>
          <p>Ingresa con tu cuenta</p>
        </div>

        <form (submit)="login(); $event.preventDefault()">
          <label class="field">
            <span>Usuario</span>
            <input
              type="text"
              autocomplete="username"
              [(ngModel)]="username"
              name="username"
              placeholder="maximo"
              class="text-input"
              autofocus />
          </label>

          <label class="field">
            <span>Clave</span>
            <input
              type="password"
              autocomplete="current-password"
              [(ngModel)]="password"
              name="password"
              placeholder="••••••••"
              class="text-input" />
          </label>

          @if (error()) {
            <div class="error-msg">{{ error() }}</div>
          }

          <button type="submit" class="btn-login" [disabled]="loading() || !username || !password">
            @if (loading()) {
              <div class="spinner"></div>
            } @else {
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            }
            <span>{{ loading() ? 'Validando...' : 'Ingresar' }}</span>
          </button>
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
      background: linear-gradient(135deg, #0f172a, #1e293b, #312e81);
      padding: 20px;
    }

    .login-card {
      background: white;
      border-radius: 24px;
      padding: 40px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 25px 60px rgba(0,0,0,0.3);
      animation: fadeIn 0.4s ease;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

    .brand { text-align: center; margin-bottom: 32px; }
    .brand-icon { display: inline-block; margin-bottom: 16px; }
    .brand h1 { margin: 0 0 8px; font-size: 24px; font-weight: 700; color: #0f172a; }
    .brand p { margin: 0; color: #64748b; font-size: 14px; }

    .field { display: block; margin-bottom: 14px; }
    .field span { display: block; font-size: 13px; color: #475569; margin-bottom: 6px; font-weight: 500; }
    .text-input {
      width: 100%; padding: 12px 14px;
      border: 2px solid #e2e8f0;
      border-radius: 10px;
      font-size: 15px;
      outline: none; box-sizing: border-box;
      color: #0f172a;
      transition: all 0.2s;
    }
    .text-input:focus { border-color: #6366f1; box-shadow: 0 0 0 4px rgba(99,102,241,0.1); }

    .error-msg {
      background: #fee2e2; color: #dc2626;
      padding: 10px 14px; border-radius: 10px;
      font-size: 13px; margin-bottom: 16px;
      text-align: center; font-weight: 500;
    }

    .btn-login {
      width: 100%; padding: 14px;
      border: none; border-radius: 14px;
      background: #6366f1; color: white;
      font-size: 16px; font-weight: 600;
      cursor: pointer; transition: all 0.2s;
      display: flex; align-items: center; justify-content: center; gap: 8px;
      margin-top: 6px;
    }
    .btn-login:hover:not(:disabled) { background: #4f46e5; transform: translateY(-1px); }
    .btn-login:disabled { opacity: 0.5; cursor: not-allowed; }

    .spinner {
      width: 18px; height: 18px;
      border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class LoginComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  username = '';
  password = '';
  loading = signal(false);
  error = signal('');

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
        this.error.set(e.error?.error || 'Usuario o clave incorrectos');
        this.password = '';
      }
    });
  }
}
