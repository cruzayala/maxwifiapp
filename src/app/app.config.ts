import { ApplicationConfig, APP_INITIALIZER, provideBrowserGlobalErrorListeners, inject } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { apiInterceptor } from './interceptors/api.interceptor';
import { authInterceptor } from './interceptors/auth.interceptor';
import { LocalDbService } from './services/local-db.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor, apiInterceptor])),
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const db = inject(LocalDbService);
        return () => db.init();
      },
      multi: true
    }
  ]
};
