import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

const PROTECTED_PREFIXES = [
  '/db', '/wa', '/api', '/users', '/sync', '/mikrotik',
  '/clients-actions', '/web-activity', '/auto-block',
  '/notifications', '/templates', '/auth/me', '/auth/logout',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();

  let modifiedReq = req;
  if (token && PROTECTED_PREFIXES.some((p) => req.url.startsWith(p))) {
    modifiedReq = req.clone({ setHeaders: { 'X-Auth-Token': token } });
  }

  return next(modifiedReq).pipe(
    catchError((err) => {
      if (err.status === 401) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
