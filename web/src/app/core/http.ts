import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SILENT_ERRORS } from './api.service';
import { ProblemDetails } from './api.models';
import { SessionService } from './session.service';
import { ToastService } from './toast.service';

/** Extracts a human-readable message from an RFC 7807 ProblemDetails error. */
export function problemMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'The server could not be reached. Check your connection and try again.';
    }
    const pd = error.error as ProblemDetails | null;
    if (pd && typeof pd === 'object') {
      const fieldErrors = pd.errors ? Object.values(pd.errors).flat() : [];
      if (fieldErrors.length > 0) {
        return fieldErrors.join(' ');
      }
      return pd.detail || pd.title || fallback;
    }
    return error.statusText || fallback;
  }
  return fallback;
}

/** Shows a toast for API errors unless the request opted out; sends users to the right page on 401/403/404. */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  const router = inject(Router);
  const session = inject(SessionService);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && !req.context.get(SILENT_ERRORS)) {
        if (error.status === 401) {
          session.me.set(null);
          void router.navigateByUrl('/login?expired=1');
        } else {
          toast.error(problemMessage(error));
        }
      }
      return throwError(() => error);
    }),
  );
};

export const authGuard: CanActivateFn = async (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);
  const me = await session.ensureLoaded();
  return me ? true : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};
