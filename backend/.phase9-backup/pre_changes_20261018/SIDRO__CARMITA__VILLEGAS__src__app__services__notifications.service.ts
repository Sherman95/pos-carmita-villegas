import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface SidroNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  data: { url?: string; request_id?: number | string } | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationsResponse {
  items: SidroNotification[];
  total: number;
  unread: number;
  limit: number;
  offset: number;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationsService {
  private apiUrl = `${environment.apiUrl}/sidro/notifications`;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  items = signal<SidroNotification[]>([]);
  unreadCount = signal(0);
  lastError = signal('');

  constructor(private http: HttpClient) {}

  startPolling(intervalMs = 30000): void {
    if (this.pollingTimer) return;
    this.refresh();
    this.pollingTimer = setInterval(() => this.refresh(), intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.items.set([]);
    this.unreadCount.set(0);
    this.lastError.set('');
  }

  isPolling(): boolean {
    return this.pollingTimer !== null;
  }

  refresh(): void {
    this.http.get<NotificationsResponse>(`${this.apiUrl}?limit=10`).subscribe({
      next: (response) => {
        this.items.set(response.items ?? []);
        this.unreadCount.set(response.unread ?? 0);
        this.lastError.set('');
      },
      error: () => {
        this.lastError.set('No se pudieron actualizar las notificaciones.');
      }
    });
  }

  markAsRead(notification: SidroNotification): void {
    if (notification.read_at) return;
    this.http
      .post<{ id: number; read_at: string; changed: boolean }>(
        `${this.apiUrl}/${notification.id}/read`,
        {}
      )
      .subscribe({
        next: (response) => {
          this.items.update((list) =>
            list.map((item) =>
              item.id === notification.id ? { ...item, read_at: response.read_at } : item
            )
          );
          this.unreadCount.update((count) => Math.max(0, count - 1));
        },
        error: () => undefined
      });
  }
}
