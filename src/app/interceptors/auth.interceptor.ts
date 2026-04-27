import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const token = auth.getToken();

  let modifiedReq = req;
  if (token && (req.url.startsWith('/db') || req.url.startsWith('/wa') || req.url.startsWith('/api'))) {
    modifiedReq = req.clone({ setHeaders: { 'X-Auth-Token': token } });
  }

  return next(modifiedReq).pipe(
    catchError((err) => {
      if (err.status === 401 && auth.pinRequired()) {
        auth.logout();
        router.navigate(['/login']);
      }
      return throwError(() => err);
    })
  );
};
