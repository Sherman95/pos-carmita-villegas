import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NotificationsService, PosNotification } from './notifications.service';

const buildNotification = (overrides: Partial<PosNotification> = {}): PosNotification => ({
  id: 1,
  type: 'sidro_request_created',
  title: 'Nueva solicitud SIDRO',
  body: 'Ana solicitó Coloración.',
  data: { url: '/citas/solicitudes?open=1', request_id: 1 },
  read_at: null,
  created_at: new Date().toISOString(),
  ...overrides
});

describe('NotificationsService (POS)', () => {
  let service: NotificationsService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(NotificationsService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.stopPolling();
    vi.useRealTimers();
  });

  it('actualiza contador y listado al consultar', () => {
    service.refresh();
    const request = httpTesting.expectOne((req) => req.url.includes('/api/notifications?limit=20'));
    request.flush({ items: [buildNotification()], total: 1, unread: 1, limit: 20, offset: 0 });

    expect(service.items().length).toBe(1);
    expect(service.unreadCount()).toBe(1);
  });

  it('hace polling periódico y se detiene al cerrar sesión', () => {
    service.startPolling(30000);
    httpTesting.expectOne((req) => req.url.includes('/api/notifications?limit=20')).flush({
      items: [],
      total: 0,
      unread: 0,
      limit: 20,
      offset: 0
    });
    expect(service.isPolling()).toBe(true);

    vi.advanceTimersByTime(30000);
    httpTesting.expectOne((req) => req.url.includes('/api/notifications?limit=20')).flush({
      items: [],
      total: 0,
      unread: 0,
      limit: 20,
      offset: 0
    });

    service.stopPolling();
    expect(service.isPolling()).toBe(false);
    vi.advanceTimersByTime(90000);
    httpTesting.expectNone((req) => req.url.includes('/api/notifications?limit=20'));
    expect(service.items().length).toBe(0);
    expect(service.unreadCount()).toBe(0);
  });

  it('marcar como leída solo actualiza su propio registro', () => {
    const notification = buildNotification();
    service.items.set([notification]);
    service.unreadCount.set(1);

    service.markAsRead(notification);
    const request = httpTesting.expectOne((req) => req.url.endsWith('/api/notifications/1/read'));
    expect(request.request.method).toBe('POST');
    request.flush({ id: 1, read_at: new Date().toISOString(), changed: true });

    expect(service.items()[0].read_at).not.toBeNull();
    expect(service.unreadCount()).toBe(0);

    service.markAsRead(service.items()[0]);
    httpTesting.expectNone((req) => req.url.endsWith('/api/notifications/1/read'));
  });
});
