import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BookingService, SidroRequest } from '../../services/booking.service';
import { MobileNavComponent } from '../mobile-nav/mobile-nav.component';
import { RouterLink } from '@angular/router';
import { VisualAssetsService } from '../../services/visual-assets.service';

@Component({
  selector: 'app-my-requests',
  standalone: true,
  imports: [CommonModule, RouterLink, MobileNavComponent],
  templateUrl: './my-requests.view.html',
  styleUrls: ['./my-requests.view.scss', './my-requests.luxury-extension.scss']
})
export class MyRequestsComponent implements OnInit {
  isLoading = true;
  actionRequestId: number | null = null;
  errorMessage = '';
  successMessage = '';
  requests: SidroRequest[] = [];
  filter: 'ALL' | 'ACTIVE' | 'COMPLETED' = 'ALL';
  
  private bookingService = inject(BookingService);
  readonly visualAssets = inject(VisualAssetsService);
  readonly visuals = this.visualAssets.assets;

  ngOnInit() {
    this.loadRequests();
  }

  get filteredRequests(): SidroRequest[] {
    if (this.filter === 'ACTIVE') {
      return this.requests.filter((request) => this.isActive(request));
    }
    if (this.filter === 'COMPLETED') {
      return this.requests.filter((request) => !this.isActive(request));
    }
    return this.requests;
  }

  get activeCount(): number {
    return this.requests.filter((request) => this.isActive(request)).length;
  }

  get confirmedCount(): number {
    return this.requests.filter((request) => request.status === 'CONFIRMADA').length;
  }

  loadRequests() {
    this.isLoading = true;
    this.errorMessage = '';
    this.bookingService.getMyRequests().subscribe({
       next: (data) => {
           this.requests = data;
           this.actionRequestId = null;
           this.isLoading = false;
       },
       error: (err) => {
           console.error(err);
           this.errorMessage = 'No se pudieron cargar tus solicitudes.';
           this.isLoading = false;
       }
    });
  }

  acceptProposal(request: SidroRequest) {
    if (request.id === undefined) return;
    this.actionRequestId = request.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.bookingService.acceptProposal(request.id).subscribe({
      next: () => {
        this.successMessage = 'Propuesta aceptada. Actualizamos el estado de tu solicitud.';
        this.loadRequests();
      },
      error: () => {
        this.actionRequestId = null;
        this.errorMessage = 'No se pudo aceptar la propuesta.';
      }
    });
  }

  rejectProposal(request: SidroRequest) {
    if (request.id === undefined) return;
    this.actionRequestId = request.id;
    this.errorMessage = '';
    this.successMessage = '';
    this.bookingService.rejectProposal(request.id).subscribe({
      next: () => {
        this.successMessage = 'Propuesta rechazada. La solicitud quedó cancelada.';
        this.loadRequests();
      },
      error: () => {
        this.actionRequestId = null;
        this.errorMessage = 'No se pudo rechazar la propuesta.';
      }
    });
  }

  formatStatus(status: SidroRequest['status']): string {
      if (!status) return 'Desconocido';
      switch (status) {
          case 'PENDIENTE': return 'En Revisión';
          case 'PROPUESTA': return 'Propuesta';
          case 'APROBADA_PENDIENTE_VINCULACION': return 'Aprobada (Req. Vinculación)';
          case 'CONFIRMADA': return 'Confirmada';
          case 'RECHAZADA': return 'Rechazada';
          case 'CANCELADA': return 'Cancelada';
          case 'CONFLICTO_VINCULACION': return 'Conflicto (Agenda Llena)';
          default: return status;
      }
  }

  statusClass(status: SidroRequest['status']): string {
    return `status-${(status || 'desconocido').toLowerCase().replaceAll('_', '-')}`;
  }

  isActive(request: SidroRequest): boolean {
    return ['PENDIENTE', 'PROPUESTA', 'APROBADA_PENDIENTE_VINCULACION', 'CONFLICTO_VINCULACION']
      .includes(request.status || '');
  }

  formatDate(value: string | null | undefined): string {
    const [year, month, day] = (value?.slice(0, 10) || '').split('-').map(Number);
    if (!year || !month || !day) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-EC', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }).format(new Date(year, month - 1, day));
  }

  formatTime(value: string | null | undefined): string {
    return value?.slice(0, 5) || '--:--';
  }

  getRequestImage(request: SidroRequest, index = 0): string {
    const primaryService = request.services?.[0];
    const primaryServiceName = primaryService?.service_name || request.service_name || 'Servicio SIDRO';
    return this.visualAssets.resolveServiceImage(
      primaryServiceName,
      primaryService?.image_url || request.image_url,
      index
    );
  }
}
