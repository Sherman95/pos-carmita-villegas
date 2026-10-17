import { ChangeDetectorRef, Component, EventEmitter, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { RouterLink } from '@angular/router';
import {
  SidroAdminService,
  SidroRequest,
  SidroRequestStatus
} from '../../services/sidro-admin.service';
import { AuthService } from '../../services/auth.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-sidro-requests',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTableModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink
  ],
  templateUrl: './sidro-requests.component.html',
  styleUrl: './sidro-requests.component.scss'
})
export class SidroRequestsComponent implements OnInit {
  @Output() appointmentsChanged = new EventEmitter<void>();

  requests: SidroRequest[] = [];
  displayedColumns: string[] = [
    'client_name',
    'service_name',
    'employee_name',
    'date',
    'status',
    'actions'
  ];
  loading = true;
  loadError = '';
  processingId: number | null = null;
  searchTerm = '';
  statusFilter: SidroRequestStatus | 'ALL' = 'ALL';
  professionalFilter = 'ALL';

  readonly statusOptions: Array<{ value: SidroRequestStatus | 'ALL'; label: string }> = [
    { value: 'ALL', label: 'Todos los estados' },
    { value: 'PENDIENTE', label: 'Pendientes' },
    { value: 'PROPUESTA', label: 'Propuestas' },
    { value: 'CONFIRMADA', label: 'Confirmadas' },
    { value: 'APROBADA_PENDIENTE_VINCULACION', label: 'Pendientes de vinculación' },
    { value: 'CONFLICTO_VINCULACION', label: 'Con conflicto' },
    { value: 'RECHAZADA', label: 'Rechazadas' },
    { value: 'CANCELADA', label: 'Canceladas' }
  ];

  constructor(
    private sidroService: SidroAdminService,
    private authService: AuthService,
    private changeDetectorRef: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadRequests();
  }

  get isAdmin(): boolean {
    const user = this.authService.currentUser();
    return user?.role?.trim().toLowerCase() === 'admin' ||
      user?.username?.trim().toLowerCase() === 'admin';
  }

  get professionals(): string[] {
    return [...new Set(this.requests.map((request) => request.employee_name).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b, 'es')
    );
  }

  get filteredRequests(): SidroRequest[] {
    const term = this.searchTerm.trim().toLocaleLowerCase('es');

    return this.requests.filter((request) => {
      const matchesStatus = this.statusFilter === 'ALL' || request.status === this.statusFilter;
      const matchesProfessional =
        this.professionalFilter === 'ALL' || request.employee_name === this.professionalFilter;
      const searchableText = `${request.client_name} ${request.service_name} ${request.employee_name} ${request.client_notes || ''}`
        .toLocaleLowerCase('es');

      return matchesStatus && matchesProfessional && (!term || searchableText.includes(term));
    });
  }

  get hasLinkingPending(): boolean {
    return this.requests.some(
      (request) =>
        !request.linked_client_id &&
        ['PENDIENTE', 'APROBADA_PENDIENTE_VINCULACION', 'CONFLICTO_VINCULACION'].includes(
          request.status
        )
    );
  }

  loadRequests(): void {
    this.loading = true;
    this.loadError = '';
    this.sidroService.getRequests().subscribe({
      next: (data) => {
        this.requests = data;
        this.loading = false;
        this.changeDetectorRef.detectChanges();
      },
      error: (error: HttpErrorResponse) => {
        this.loading = false;
        this.loadError =
          error.status === 403
            ? 'No tienes permisos o no estás vinculado a un profesional para consultar solicitudes.'
            : 'No fue posible cargar las solicitudes SIDRO. Intenta nuevamente.';
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  setStatusFilter(status: SidroRequestStatus): void {
    this.statusFilter = status;
  }

  countByStatus(status: SidroRequestStatus): number {
    return this.requests.filter((request) => request.status === status).length;
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.statusFilter = 'ALL';
    this.professionalFilter = 'ALL';
  }

  canManage(request: SidroRequest): boolean {
    return request.status === 'PENDIENTE';
  }

  async accept(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const confirmation = await Swal.fire({
      title: '¿Aprobar solicitud?',
      text: `${request.client_name} · ${request.service_name} · ${this.formatDate(request.request_date)} ${this.formatTime(request.start_time)}`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, aprobar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#4b1e3a'
    });

    if (!confirmation.isConfirmed) return;

    this.processingId = request.id;
    this.sidroService.acceptRequest(request.id).subscribe({
      next: (res) => {
        this.processingId = null;
        const pendingLink = res.status === 'APROBADA_PENDIENTE_VINCULACION';
        Swal.fire({
          icon: 'success',
          title: pendingLink ? 'Aprobada, falta vincular' : 'Solicitud aprobada',
          text: res.message,
          confirmButtonColor: '#4b1e3a'
        });
        this.loadRequests();
        this.appointmentsChanged.emit();
      },
      error: (error: HttpErrorResponse) => {
        this.processingId = null;
        this.showActionError(error, 'aprobar la solicitud');
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  async reject(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const confirmation = await Swal.fire({
      title: '¿Rechazar solicitud?',
      text: 'La clienta verá la solicitud como rechazada.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, rechazar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#b42318'
    });

    if (!confirmation.isConfirmed) return;

    this.processingId = request.id;
    this.sidroService.rejectRequest(request.id).subscribe({
      next: () => {
        this.processingId = null;
        Swal.fire('Solicitud rechazada', 'El estado se actualizó correctamente.', 'success');
        this.loadRequests();
      },
      error: (error: HttpErrorResponse) => {
        this.processingId = null;
        this.showActionError(error, 'rechazar la solicitud');
        this.changeDetectorRef.detectChanges();
      }
    });
  }

  async propose(request: SidroRequest): Promise<void> {
    if (!this.canManage(request) || this.processingId !== null) return;

    const initialDate = this.normalizeDate(request.request_date);
    const initialTime = this.formatTime(request.start_time);
    const minimumDate = this.localDateValue(new Date());
    const { value: formValues } = await Swal.fire({
      title: 'Proponer otro horario',
      html: `
        <label class="swal-field-label" for="sidro-proposed-date">Nueva fecha</label>
        <input id="sidro-proposed-date" class="swal2-input" type="date" min="${minimumDate}" value="${initialDate}">
        <label class="swal-field-label" for="sidro-proposed-time">Nueva hora</label>
        <input id="sidro-proposed-time" class="swal2-input" type="time" value="${initialTime}">
      `,
      focusConfirm: false,
      showCancelButton: true,
      confirmButtonText: 'Enviar propuesta',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#4b1e3a',
      preConfirm: () => {
        const date = (document.getElementById('sidro-proposed-date') as HTMLInputElement).value;
        const time = (document.getElementById('sidro-proposed-time') as HTMLInputElement).value;
        if (!date || !time) {
          Swal.showValidationMessage('Selecciona una fecha y una hora.');
          return false;
        }
        return [date, time];
      }
    });

    if (formValues && formValues[0] && formValues[1]) {
      this.processingId = request.id;
      this.sidroService.proposeAlternative(request.id, formValues[0], formValues[1]).subscribe({
        next: () => {
          this.processingId = null;
          Swal.fire('Propuesta enviada', 'La clienta podrá aceptar o rechazar el nuevo horario.', 'success');
          this.loadRequests();
        },
        error: (error: HttpErrorResponse) => {
          this.processingId = null;
          this.showActionError(error, 'enviar la propuesta');
          this.changeDetectorRef.detectChanges();
        }
      });
    }
  }

  statusLabel(status: SidroRequestStatus): string {
    const labels: Record<SidroRequestStatus, string> = {
      PENDIENTE: 'Pendiente',
      PROPUESTA: 'Propuesta enviada',
      APROBADA_PENDIENTE_VINCULACION: 'Pendiente de vinculación',
      CONFIRMADA: 'Confirmada',
      RECHAZADA: 'Rechazada',
      CANCELADA: 'Cancelada',
      CONFLICTO_VINCULACION: 'Conflicto de vinculación'
    };
    return labels[status];
  }

  statusClass(status: SidroRequestStatus): string {
    return `status-${status.toLocaleLowerCase().replaceAll('_', '-')}`;
  }

  formatDate(value: string | null | undefined): string {
    const normalized = this.normalizeDate(value);
    const [year, month, day] = normalized.split('-').map(Number);
    if (!year || !month || !day) return 'Fecha no disponible';
    return new Intl.DateTimeFormat('es-EC', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    }).format(new Date(year, month - 1, day));
  }

  formatTime(value: string | null | undefined): string {
    return value?.slice(0, 5) || '--:--';
  }

  private normalizeDate(value: string | null | undefined): string {
    return value?.slice(0, 10) || '';
  }

  private localDateValue(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private showActionError(error: HttpErrorResponse, action: string): void {
    const backendMessage = error.error?.error;
    if (error.status === 409) {
      Swal.fire(
        'Conflicto de horario',
        backendMessage || 'Ese horario ya no está disponible. Revisa la agenda o propón otro horario.',
        'warning'
      );
      return;
    }
    if (error.status === 403) {
      Swal.fire('Sin permisos', backendMessage || `No tienes permiso para ${action}.`, 'error');
      return;
    }
    Swal.fire('No se pudo completar la acción', backendMessage || `Ocurrió un error al ${action}.`, 'error');
  }
}
