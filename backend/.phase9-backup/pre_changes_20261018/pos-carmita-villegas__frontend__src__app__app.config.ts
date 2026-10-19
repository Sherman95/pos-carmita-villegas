import { ApplicationConfig, LOCALE_ID } from '@angular/core'; // <--- Importar LOCALE_ID
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './interceptors/auth.interceptor';

// 1. IMPORTAR IDIOMA ESPAÑOL
import localeEs from '@angular/common/locales/es-EC';
import { registerLocaleData } from '@angular/common';

// 2. REGISTRARLO
registerLocaleData(localeEs, 'es-EC');

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideHttpClient(withInterceptors([authInterceptor])),
    
    // 3. CONFIGURAR COMO DEFAULT
    { provide: LOCALE_ID, useValue: 'es-EC' } 
  ]
};