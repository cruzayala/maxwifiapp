import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('/api') || req.url.startsWith(environment.apiUrl)) {
    const cloned = req.clone({
      setHeaders: {
        'Authorization': `Api-Key ${environment.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    return next(cloned);
  }
  return next(req);
};
