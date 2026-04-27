import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private readonly TOKEN_KEY = 'wishub_token';

  pinRequired = signal(false);
  isAuthenticated = signal(false);

  constructor() {
    // Check if token is valid on app load
    if (this.getToken()) this.isAuthenticated.set(true);
  }

  checkPinRequired(): Observable<{ pinRequired: boolean }> {
    return this.http.get<{ pinRequired: boolean }>('/auth/check').pipe(
      tap(res => {
        this.pinRequired.set(res.pinRequired);
        if (!res.pinRequired) this.isAuthenticated.set(true);
      })
    );
  }

  login(pin: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>('/auth/login', { pin }).pipe(
      tap(res => {
        if (res.token) {
          localStorage.setItem(this.TOKEN_KEY, res.token);
          this.isAuthenticated.set(true);
        }
      })
    );
  }

  logout() {
    this.http.post('/auth/logout', {}).subscribe();
    localStorage.removeItem(this.TOKEN_KEY);
    this.isAuthenticated.set(false);
  }

  getToken(): string | null {
    return localStorage.getItem(this.TOKEN_KEY);
  }
}
