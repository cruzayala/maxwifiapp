import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

// Endpoints publicos (NO requieren token) - sincronizado con server.js authMiddleware
// Cualquier otra URL recibe automaticamente el token. Evita bugs por olvidar
// agregar nuevos endpoints a una whitelist.
const PUBLIC_PATHS = [
  '/auth/login',
  '/auth/check',
  '/health',
  '/sys/info',
  '/captive',
  '/survey/landing',
  '/survey/submit',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();

  const isPublic = PUBLIC_PATHS.some((p) => req.url.startsWith(p));

  let modifiedReq = req;
  if (token && !isPublic) {
    modifiedReq = req.clone({ setHeaders: { 'X-Auth-Token': token } });
  }

  return next(modifiedReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !isPublic) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
