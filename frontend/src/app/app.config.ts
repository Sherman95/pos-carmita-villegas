import { ApplicationConfig, LOCALE_ID } from '@angular/core'; // <--- Importar LOCALE_ID
import { provideRouter, withViewTransitions } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from '../environments/environment';

// 1. IMPORTAR IDIOMA ESPAÑOL
import localeEs from '@angular/common/locales/es-EC';
import { registerLocaleData } from '@angular/common';

// 2. REGISTRARLO
registerLocaleData(localeEs, 'es-EC');

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withViewTransitions()),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: environment.production,
      registrationStrategy: 'registerWhenStable:30000'
    }),
    
    // 3. CONFIGURAR COMO DEFAULT
    { provide: LOCALE_ID, useValue: 'es-EC' } 
  ]
};
