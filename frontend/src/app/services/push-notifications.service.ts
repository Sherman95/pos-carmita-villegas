import { HttpClient } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { take } from 'rxjs/operators';
import { environment } from '../../environments/environment';

type PushState = 'loading' | 'unsupported' | 'unavailable' | 'prompt' | 'enabled' | 'denied' | 'error';
interface PushConfig { enabled: boolean; publicKey: string | null; }

@Injectable({ providedIn: 'root' })
export class PushNotificationsService {
  private readonly apiUrl = `${environment.apiBaseUrl}/api/notifications`;
  readonly state = signal<PushState>('loading');
  readonly busy = signal(false);
  readonly message = signal('');
  readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  readonly isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  readonly isBrave = Boolean((navigator as any).brave);
  private config: PushConfig | null = null;

  constructor(private http: HttpClient, private swPush: SwPush) {}

  initialize(): void {
    this.state.set('loading');
    this.http.get<PushConfig>(`${this.apiUrl}/push/config`).subscribe({
      next: (config) => {
        this.config = config;
        if (!config.enabled || !config.publicKey) return this.state.set('unavailable');
        if (!this.swPush.isEnabled || !('Notification' in window)) {
          this.message.set(environment.production
            ? 'No hay un service worker activo. Recarga la aplicación y vuelve a comprobar.'
            : 'Push no funciona con ng serve. Usa la compilación local de producción para activar el service worker.');
          return this.state.set('unsupported');
        }
        this.swPush.subscription.pipe(take(1)).subscribe((subscription) => {
          if (subscription) {
            this.register(subscription, false);
          } else {
            this.state.set(Notification.permission === 'denied' ? 'denied' : 'prompt');
          }
        });
      },
      error: () => { this.message.set('No se pudo consultar la configuración Push.'); this.state.set('error'); }
    });
  }

  async enable(): Promise<void> {
    if (this.busy() || !this.config?.enabled || !this.config.publicKey) return;
    if (this.isIos && !this.isStandalone) {
      this.message.set('En iPhone, agrega primero el POS a la pantalla de inicio y ábrelo desde su icono.');
      return;
    }
    this.busy.set(true);
    this.message.set('');
    try {
      const subscription = await this.swPush.requestSubscription({ serverPublicKey: this.config.publicKey });
      this.register(subscription, true);
    } catch (error: unknown) {
      this.busy.set(false);
      this.state.set(Notification.permission === 'denied' ? 'denied' : 'error');
      this.message.set(this.activationErrorMessage(error));
    }
  }

  private activationErrorMessage(error: unknown): string {
    if (Notification.permission === 'denied') {
      return 'El permiso fue denegado. Puedes cambiarlo desde la configuración del navegador.';
    }
    const detail = error instanceof Error ? `${error.name} ${error.message}`.toLowerCase() : '';
    console.warn('[PUSH] El navegador no pudo crear la suscripción', {
      name: error instanceof Error ? error.name : 'UnknownError',
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      brave: this.isBrave
    });
    if (this.isBrave && /push|registration|abort|service/.test(detail)) {
      return 'Brave permitió las notificaciones del sitio, pero no pudo conectarse a su servicio Push. Activa “Usar servicios de Google para mensajes push” en brave://settings/privacy y reinicia Brave.';
    }
    if (!navigator.serviceWorker?.controller) {
      return 'El service worker todavía no controla esta página. Recarga completamente la aplicación e inténtalo otra vez.';
    }
    return 'El navegador no pudo crear la suscripción Push. Revisa los permisos y el servicio Push del navegador.';
  }

  disable(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.swPush.subscription.pipe(take(1)).subscribe((subscription) => {
      if (!subscription) { this.busy.set(false); this.state.set('prompt'); return; }
      this.http.delete<{ changed: boolean }>(`${this.apiUrl}/subscriptions`, { body: { endpoint: subscription.endpoint } }).subscribe({
        next: async () => { await subscription.unsubscribe(); this.busy.set(false); this.state.set('prompt'); this.message.set('Notificaciones desactivadas en este dispositivo.'); },
        error: () => { this.busy.set(false); this.message.set('No se pudo desactivar el dispositivo. Inténtalo nuevamente.'); }
      });
    });
  }

  revokeForLogout(token: string | null): void {
    if (!token || !this.swPush.isEnabled) return;
    this.swPush.subscription.pipe(take(1)).subscribe((subscription) => {
      if (!subscription) return;
      void fetch(`${this.apiUrl}/subscriptions`, {
        method: 'DELETE', keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: subscription.endpoint })
      }).finally(() => subscription.unsubscribe());
    });
  }

  private register(subscription: PushSubscription, userInitiated: boolean): void {
    this.http.post(`${this.apiUrl}/subscriptions`, subscription.toJSON()).subscribe({
      next: () => { this.busy.set(false); this.state.set('enabled'); if (userInitiated) this.message.set('Este dispositivo recibirá avisos operativos del POS.'); },
      error: () => { this.busy.set(false); this.state.set('error'); this.message.set('No se pudo asociar este dispositivo con tu cuenta.'); }
    });
  }
}
