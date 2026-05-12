import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export type UserRole = 'super_admin' | 'admin' | 'tecnico' | 'cobranza' | 'viewer';

export interface CurrentUser {
  id: number;
  username: string;
  fullName?: string | null;
  role: UserRole;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private readonly TOKEN_KEY = 'wishub_token';
  private readonly USER_KEY = 'wishub_user';

  isAuthenticated = signal(false);
  currentUser = signal<CurrentUser | null>(null);

  constructor() {
    const token = this.getToken();
    const userJson = localStorage.getItem(this.USER_KEY);
    if (token && userJson) {
      try {
        this.currentUser.set(JSON.parse(userJson));
        this.isAuthenticated.set(true);
      } catch {
        this.clearSession();
      }
    }
  }

  login(username: string, password: string): Observable<{ token: string; user: CurrentUser }> {
    return this.http.post<{ token: string; user: CurrentUser }>('/auth/login', { username, password }).pipe(
      tap(res => {
        if (res.token) {
          localStorage.setItem(this.TOKEN_KEY, res.token);
          localStorage.setItem(this.USER_KEY, JSON.stringify(res.user));
          this.currentUser.set(res.user);
          this.isAuthenticated.set(true);
        }
      })
    );
  }

  logout() {
    this.http.post('/auth/logout', {}).subscribe({ next: () => {}, error: () => {} });
    this.clearSession();
  }

  private clearSession() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }

  hasRole(roles: UserRole[]): boolean {
    const u = this.currentUser();
    if (!u) return false;
    const hierarchy: Record<UserRole, number> = {
      super_admin: 4, admin: 3, tecnico: 2, cobranza: 2, viewer: 1,
    };
    const userLevel = hierarchy[u.role] || 0;
    return roles.some(r => userLevel >= (hierarchy[r] || 99));
  }
}
