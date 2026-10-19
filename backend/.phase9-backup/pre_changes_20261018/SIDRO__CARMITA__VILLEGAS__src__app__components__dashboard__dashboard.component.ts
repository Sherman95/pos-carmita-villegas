import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';
import { MobileNavComponent } from '../mobile-nav/mobile-nav.component';
import { BookingService, SidroService } from '../../services/booking.service';
import { VisualAssetsService } from '../../services/visual-assets.service';
import { NotificationsService, SidroNotification } from '../../services/notifications.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, MobileNavComponent],
  templateUrl: './dashboard.reference.html',
  styleUrls: ['./dashboard.reference.scss', './dashboard.mobile-fixes.scss', './dashboard.notifications.scss']
})
export class DashboardComponent implements OnInit, OnDestroy {
  profile: any = null;
  isLoading = true;
  errorMessage = '';
  featuredServices: SidroService[] = [];

  private authService = inject(AuthService);
  private bookingService = inject(BookingService);
  private router = inject(Router);
  readonly visualAssets = inject(VisualAssetsService);
  readonly visuals = this.visualAssets.assets;
  readonly notificationsService = inject(NotificationsService);

  get firstName(): string {
    return this.profile?.nombre_completo?.trim().split(/\s+/)[0] || 'bienvenida';
  }

  get profileInitials(): string {
    const names = this.profile?.nombre_completo?.trim().split(/\s+/).filter(Boolean) || [];
    return names.slice(0, 2).map((name: string) => name[0]).join('').toUpperCase() || 'S';
  }

  ngOnInit() {
    this.loadFeaturedServices();
    this.notificationsService.startPolling();

    this.authService.getProfile().subscribe({
      next: (data) => {
        this.profile = data;
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = 'No se pudo cargar la información.';
        this.isLoading = false;
        if (err.status === 401 || err.status === 403) {
           this.authService.logout();
           this.router.navigate(['/login']);
        }
      }
    });
  }

  ngOnDestroy(): void {
    this.notificationsService.stopPolling();
  }

  openNotification(notification: SidroNotification): void {
    this.notificationsService.markAsRead(notification);
    const url = notification.data?.url;
    if (url) {
      this.router.navigateByUrl(url);
    }
  }

  formatNotificationDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-EC', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  }

  trackNotificationById(index: number, notification: SidroNotification): number {
    return notification.id;
  }

  getServiceImage(service: SidroService, index: number): string {
    return this.visualAssets.resolveServiceImage(service.nombre, service.image_url, index);
  }

  private loadFeaturedServices(): void {
    this.bookingService.getServices().subscribe({
      next: (services) => {
        this.featuredServices = services.slice(0, 3);
      },
      error: () => {
        // El dashboard sigue disponible aunque el catálogo público esté temporalmente fuera de línea.
        this.featuredServices = [];
      }
    });
  }

  logout() {
    this.notificationsService.stopPolling();
    this.authService.logout();
    this.router.navigate(['/']);
  }
}
