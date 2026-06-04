import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map } from 'rxjs';

export const authGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return auth.validateSession().pipe(
    map((ok) => ok ? true : router.createUrlTree(['/login'], { queryParams: { return: state.url } }))
  );
};
