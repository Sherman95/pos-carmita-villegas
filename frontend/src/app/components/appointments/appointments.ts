import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, OnDestroy, OnInit } from '@angular/core';

import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { FullCalendarModule } from '@fullcalendar/angular';
// Removido import de tipos de @fullcalendar/core debido a TS2306
import resourceTimeGridPlugin from '@fullcalendar/resource-timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import { AppointmentService } from '../../services/appointment.service';
import { EmployeeService } from '../../services/employee.service';
import { AppointmentDialogComponent } from './appointment-dialog/appointment-dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { SidroRequestsComponent } from '../sidro-requests/sidro-requests.component';

@Component({
  selector: 'app-appointments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FullCalendarModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    RouterLink,
    RouterLinkActive,
    SidroRequestsComponent
],
  templateUrl: './appointments.html',
  styleUrls: ['./appointments.scss']
})
export class AppointmentsComponent implements OnInit, OnDestroy {
  currentView: 'agenda' | 'requests' = 'agenda';
  lastUpdated: Date | null = null;
  private refreshTimer?: ReturnType<typeof setInterval>;

  calendarOptions: any = {
    plugins: [resourceTimeGridPlugin, interactionPlugin],
    initialView: 'resourceTimeGridDay',
    resources: [],
    events: [],
    allDaySlot: false,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'resourceTimeGridDay,resourceTimeGridWeek'
    },
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    locale: 'es',
    schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives',
    height: '100%',
    expandRows: true
  };

  loading = true;

  constructor(
    private appointmentService: AppointmentService,
    private employeeService: EmployeeService,
    private dialog: MatDialog,
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute
  ) {}

  ngOnInit() {
    this.currentView = this.route.snapshot.data['view'] === 'requests' ? 'requests' : 'agenda';
    if (this.currentView === 'agenda') {
      this.loadData();
      this.refreshTimer = setInterval(() => this.loadData(true), 30000);
    } else {
      this.loading = false;
    }
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  @HostListener('window:focus')
  refreshWhenWindowReturns(): void {
    if (this.currentView === 'agenda') this.loadData(true);
  }

  loadData(silent = false) {
    if (!silent) this.loading = true;
    this.employeeService.getEmployees().subscribe({
      next: employees => {
      const resources = employees.map(e => ({ id: e.id, title: e.nombre }));

        this.appointmentService.getAppointments().subscribe({
          next: appointments => {
            const events: any[] = appointments.map(a => ({
              id: a.id,
              resourceId: a.employee_id,
              title: `${a.client_nombre || 'Cliente'} - ${a.item_nombre || 'Servicio'}`,
              start: a.fecha_inicio,
              end: a.fecha_fin,
              backgroundColor: a.estado === 'CANCELADA' ? '#929baa' : 'var(--brand-accent)',
              borderColor: a.estado === 'CANCELADA' ? '#697386' : 'var(--brand-base)',
              extendedProps: { ...a }
            }));

            this.calendarOptions = { ...this.calendarOptions, resources, events };
            this.lastUpdated = new Date();
            this.loading = false;
            this.cdr.detectChanges();
          },
          error: () => {
            this.loading = false;
            this.cdr.detectChanges();
          }
        });
      },
      error: () => {
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  lastUpdatedLabel(): string {
    if (!this.lastUpdated) return 'Sincronizando agenda';
    return `Actualizada ${this.lastUpdated.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`;
  }

  refreshAgendaAfterRequest(): void {
    this.loadData();
  }

  openNewAppointment() {
    this.handleDateClick({ dateStr: '', resource: null });
  }

  handleDateClick(arg: any) {
    const dialogRef = this.dialog.open(AppointmentDialogComponent, {
      width: '840px',
      maxWidth: 'calc(100vw - 24px)',
      panelClass: 'appointment-dialog-panel',
      data: {
        isEdit: false,
        employee_id: arg.resource ? arg.resource.id : null,
        fecha_inicio: arg.dateStr
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        setTimeout(() => this.loadData(), 0);
      }
    });
  }

  handleEventClick(arg: any) {
    const dialogRef = this.dialog.open(AppointmentDialogComponent, {
      width: '840px',
      maxWidth: 'calc(100vw - 24px)',
      panelClass: 'appointment-dialog-panel',
      data: {
        isEdit: true,
        appointment: arg.event.extendedProps
      }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        setTimeout(() => this.loadData(), 0);
      }
    });
  }
}
