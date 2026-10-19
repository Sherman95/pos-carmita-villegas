import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { NotificationsService, PosNotification } from '../../services/notifications.service';
import { PushNotificationsService } from '../../services/push-notifications.service';

@Component({
  selector: 'app-notifications-bell',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './notifications-bell.html',
  styleUrl: './notifications-bell.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationsBellComponent implements OnInit, OnDestroy {
  panelOpen = signal(false);

  constructor(
    public notifications: NotificationsService,
    private auth: AuthService,
    readonly pushNotifications: PushNotificationsService,
    private router: Router,
    private elementRef: ElementRef<HTMLElement>
  ) {}

  ngOnInit(): void {
    if (this.auth.getToken()) {
      this.notifications.startPolling();
      this.pushNotifications.initialize();
    }
  }

  ngOnDestroy(): void {
    this.notifications.stopPolling();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.panelOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) {
      this.panelOpen.set(false);
    }
  }

  togglePanel(): void {
    const next = !this.panelOpen();
    this.panelOpen.set(next);
    if (next) this.notifications.refresh();
  }

  unreadLabel(): string {
    const count = this.notifications.unreadCount();
    return count > 99 ? '99+' : String(count);
  }

  formatWhen(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-EC', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  openNotification(notification: PosNotification): void {
    this.notifications.markAsRead(notification);
    this.panelOpen.set(false);
    const url = notification.data?.url;
    if (url) {
      this.router.navigateByUrl(url);
    }
  }
}
