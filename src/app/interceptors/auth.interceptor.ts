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
  '/captive',
  '/survey/landing',
  '/survey/submit',
  '/s/',
];

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();

  const isPublic = PUBLIC_PATHS.some((p) => req.url.startsWith(p));
  const isWisphubProxy = req.url.startsWith('/api/') && !req.url.startsWith('/api/survey/');

  // La sesion solo viaja a nuestro propio servidor (rutas relativas). Antes tambien se
  // enviaba a sitios externos como api.ipify.org e ipapi.co desde Ajustes.
  const isOwnServer = !/^[a-z][a-z0-9+.-]*:\/\//i.test(req.url) && !req.url.startsWith('//');

  let modifiedReq = req;
  if (token && !isPublic && isOwnServer) {
    modifiedReq = req.clone({ setHeaders: { 'X-Auth-Token': token } });
  }

  return next(modifiedReq).pipe(
    catchError((err) => {
      if (err.status === 401 && !isPublic && !isWisphubProxy && isOwnServer) {
        auth.clearSession();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
