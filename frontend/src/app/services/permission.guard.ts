import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

export const permissionGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const required = (route.data?.['permissions'] || []) as string[];
  if (!auth.isAuthenticated()) return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  return auth.refreshCurrentUser().pipe(
    map(() => required.length === 0 || required.some(permission => auth.hasPermission(permission))
      ? true
      : router.parseUrl('/profile')),
    catchError(() => {
      auth.logout();
      return of(router.parseUrl('/login'));
    })
  );
};
