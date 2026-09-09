import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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

@Component({
  selector: 'app-appointments',
  standalone: true,
  imports: [
    CommonModule, 
    FullCalendarModule, 
    MatDialogModule, 
    MatButtonModule, 
    MatIconModule, 
    MatProgressSpinnerModule
  ],
  templateUrl: './appointments.html',
  styleUrls: ['./appointments.scss']
})
export class AppointmentsComponent implements OnInit {
  calendarOptions: any = {
    plugins: [resourceTimeGridPlugin, interactionPlugin],
    initialView: 'resourceTimeGridDay',
    resources: [],
    events: [],
    slotMinTime: '08:00:00',
    slotMaxTime: '20:00:00',
    allDaySlot: false,
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'resourceTimeGridDay,resourceTimeGridWeek'
    },
    dateClick: this.handleDateClick.bind(this),
    eventClick: this.handleEventClick.bind(this),
    locale: 'es',
    schedulerLicenseKey: 'CC-Attribution-NonCommercial-NoDerivatives'
  };

  loading = true;

  constructor(
    private appointmentService: AppointmentService,
    private employeeService: EmployeeService,
    private dialog: MatDialog
  ) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.loading = true;
    this.employeeService.getEmployees().subscribe(employees => {
      const resources = employees.map(e => ({ id: e.id, title: e.nombre }));
      
      this.appointmentService.getAppointments().subscribe(appointments => {
        const events: any[] = appointments.map(a => ({
          id: a.id,
          resourceId: a.employee_id,
          title: `${a.client_nombre} - ${a.item_nombre}`,
          start: a.fecha_inicio,
          end: a.fecha_fin,
          backgroundColor: 'var(--brand-accent)',
          borderColor: 'var(--brand-base)',
          extendedProps: { ...a }
        }));
        
        this.calendarOptions.resources = resources;
        this.calendarOptions.events = events;
        this.loading = false;
      });
    });
  }

  openNewAppointment() {
    this.handleDateClick({ dateStr: '', resource: null });
  }

  handleDateClick(arg: any) {
    const dialogRef = this.dialog.open(AppointmentDialogComponent, {
      width: '500px',
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
      width: '500px',
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
