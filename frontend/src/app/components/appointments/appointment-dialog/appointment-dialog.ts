import { Component, Inject, OnInit , ChangeDetectionStrategy } from '@angular/core';

import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { AppointmentService } from '../../../services/appointment.service';
import { EmployeeService, Employee } from '../../../services/employee.service';
import { ClientsService } from '../../../services/clients.service';
import { ItemsService } from '../../../services/items.service';
import { Item } from '../../../interfaces/interfaces';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-appointment-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule
],
  templateUrl: './appointment-dialog.html',
  styleUrls: ['./appointment-dialog.scss']
})
export class AppointmentDialogComponent implements OnInit {
  form: FormGroup;
  isEdit = false;
  isSaving = false;

  clients: any[] = [];
  filteredClients: any[] = [];

  servicesList: Item[] = [];
  filteredServices: Item[] = [];

  employees: Employee[] = [];
  filteredEmployees: Employee[] = [];

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<AppointmentDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private appointmentService: AppointmentService,
    private clientsService: ClientsService,
    private itemsService: ItemsService,
    private employeeService: EmployeeService
  ) {
    this.isEdit = data.isEdit;
    const isEditing = data.isEdit && data.appointment;

    // Si la fecha viene del click, ajustamos el formato
    let defaultStart = '';
    let defaultEnd = '';
    if (data.fecha_inicio) {
      const d = new Date(data.fecha_inicio);
      // Formato para datetime-local (YYYY-MM-DDTHH:mm)
      defaultStart = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      d.setHours(d.getHours() + 1); // Por defecto 1 hora
      defaultEnd = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    if (isEditing) {
      const startD = new Date(data.appointment.fecha_inicio);
      const endD = new Date(data.appointment.fecha_fin);
      defaultStart = new Date(startD.getTime() - startD.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      defaultEnd = new Date(endD.getTime() - endD.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }

    this.form = this.fb.group({
      client_id: [isEditing ? data.appointment.client_id : '', Validators.required],
      item_id: [isEditing ? data.appointment.item_id : '', Validators.required],
      employee_id: [isEditing ? data.appointment.employee_id : data.employee_id || '', Validators.required],
      fecha_inicio: [defaultStart, Validators.required],
      fecha_fin: [defaultEnd, Validators.required],
      estado: [isEditing ? data.appointment.estado : 'PROGRAMADA', Validators.required],
      notas: [isEditing ? data.appointment.notas : '']
    });
  }

  ngOnInit() {
    this.clientsService.getClients().subscribe(res => {
      this.clients = res;
      this.filteredClients = res;
    });
    this.itemsService.getItems().subscribe(res => {
      // Filtrar solo los items que son de tipo SERVICIO
      this.servicesList = res.filter((i: any) => i.tipo === 'SERVICIO');
      this.filteredServices = this.servicesList;
      if (!this.isEdit) this.updateEndFromService();
    });
    this.employeeService.getEmployees().subscribe(res => {
      this.employees = res;
      this.filteredEmployees = res;
    });

    this.form.get('item_id')?.valueChanges.subscribe(() => this.updateEndFromService());
    this.form.get('fecha_inicio')?.valueChanges.subscribe(() => this.updateEndFromService());
  }

  filterClients(event: Event) {
    const term = (event.target as HTMLInputElement).value.toLowerCase();
    this.filteredClients = this.clients.filter(c => c.nombre.toLowerCase().includes(term));
  }

  filterServices(event: Event) {
    const term = (event.target as HTMLInputElement).value.toLowerCase();
    this.filteredServices = this.servicesList.filter(s => s.nombre.toLowerCase().includes(term));
  }

  filterEmployees(event: Event) {
    const term = (event.target as HTMLInputElement).value.toLowerCase();
    this.filteredEmployees = this.employees.filter(e => e.nombre.toLowerCase().includes(term));
  }

  private updateEndFromService(): void {
    const service = this.servicesList.find(item => item.id === this.form.get('item_id')?.value);
    const startValue = this.form.get('fecha_inicio')?.value;
    if (!service || !startValue) return;

    const start = new Date(startValue);
    if (Number.isNaN(start.getTime())) return;
    const duration = Number(service.duration_minutes || 60);
    const padding = Number(service.padding_minutes || 0);
    const end = new Date(start.getTime() + (duration + padding) * 60000);
    const localEnd = new Date(end.getTime() - end.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    this.form.get('fecha_fin')?.setValue(localEnd, { emitEvent: false });
  }

  cancelar(): void {
    this.dialogRef.close();
  }

  selectedClientName(): string {
    return this.clients.find(client => client.id === this.form.get('client_id')?.value)?.nombre || 'Por seleccionar';
  }

  selectedProfessionalName(): string {
    return this.employees.find(employee => employee.id === this.form.get('employee_id')?.value)?.nombre || 'Por seleccionar';
  }

  selectedServiceName(): string {
    return this.servicesList.find(service => service.id === this.form.get('item_id')?.value)?.nombre || 'Por seleccionar';
  }

  appointmentDateLabel(): string {
    const value = this.form.get('fecha_inicio')?.value;
    if (!value) return 'Fecha pendiente';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Fecha pendiente';
    return new Intl.DateTimeFormat('es-EC', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  }

  appointmentTimeLabel(): string {
    const startValue = this.form.get('fecha_inicio')?.value;
    const endValue = this.form.get('fecha_fin')?.value;
    if (!startValue || !endValue) return 'Horario pendiente';
    const format = (value: string) => new Intl.DateTimeFormat('es-EC', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
    return `${format(startValue)} – ${format(endValue)}`;
  }

  appointmentDurationLabel(): string {
    const start = new Date(this.form.get('fecha_inicio')?.value).getTime();
    const end = new Date(this.form.get('fecha_fin')?.value).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 'Duración pendiente';
    const minutes = Math.round((end - start) / 60000);
    return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} h` : `${minutes} min`;
  }

  guardar(): void {
    const injectTopLayer = () => {
      const swalContainer = Swal.getContainer();
      if (swalContainer && !swalContainer.hasAttribute('popover')) {
        swalContainer.setAttribute('popover', 'manual');
        try { swalContainer.showPopover(); } catch (e) {}
      }
    };

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      Swal.fire({
        icon: 'warning',
        title: 'Faltan datos',
        text: 'Por favor completa todos los campos requeridos.',
        confirmButtonColor: 'var(--brand-base)',
        didOpen: injectTopLayer
      });
      return;
    }

    if (this.isSaving) return;
    this.isSaving = true;

    const payload = {
      ...this.form.value,
      fecha_inicio: new Date(this.form.value.fecha_inicio).toISOString(),
      fecha_fin: new Date(this.form.value.fecha_fin).toISOString()
    };

    if (this.isEdit) {
      this.appointmentService.updateAppointment(this.data.appointment.id, payload).subscribe({
        next: () => {
          this.isSaving = false;
          this.dialogRef.close(true);
        },
        error: async (err) => {
          this.isSaving = false;
          if (err.status === 409) {
            const result = await Swal.fire({
              icon: 'warning',
              title: 'Conflicto de Horario',
              text: err.error.conflict || 'Ya existe una cita en este horario.',
              showCancelButton: true,
              confirmButtonText: 'Agendar de todos modos',
              cancelButtonText: 'Cancelar',
              confirmButtonColor: '#ff9800',
              didOpen: injectTopLayer
            });
            if (result.isConfirmed) {
              this.isSaving = true;
              this.appointmentService.updateAppointment(this.data.appointment.id, payload, true).subscribe({
                next: () => this.dialogRef.close(true),
                error: () => {
                  this.isSaving = false;
                  Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo actualizar la cita.', didOpen: injectTopLayer });
                }
              });
            }
          } else {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al actualizar la cita.', didOpen: injectTopLayer });
          }
        }
      });
    } else {
      this.appointmentService.createAppointment(payload).subscribe({
        next: () => {
          this.isSaving = false;
          this.dialogRef.close(true);
        },
        error: async (err) => {
          this.isSaving = false;
          if (err.status === 409) {
            const result = await Swal.fire({
              icon: 'warning',
              title: 'Conflicto de Horario',
              text: err.error.conflict || 'Ya existe una cita en este horario.',
              showCancelButton: true,
              confirmButtonText: 'Agendar de todos modos',
              cancelButtonText: 'Cancelar',
              confirmButtonColor: '#ff9800',
              didOpen: injectTopLayer
            });
            if (result.isConfirmed) {
              this.isSaving = true;
              this.appointmentService.createAppointment(payload, true).subscribe({
                next: () => this.dialogRef.close(true),
                error: () => {
                  this.isSaving = false;
                  Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo agendar la cita.', didOpen: injectTopLayer });
                }
              });
            }
          } else {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al crear la cita.', didOpen: injectTopLayer });
          }
        }
      });
    }
  }

  async eliminar() {
    const result = await Swal.fire({
      icon: 'warning',
      title: '¿Eliminar cita?',
      text: 'Esta acción se reflejará en el calendario y no se puede deshacer.',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      didOpen: () => {
        const swalContainer = Swal.getContainer();
        if (swalContainer && !swalContainer.hasAttribute('popover')) {
          swalContainer.setAttribute('popover', 'manual');
          try { swalContainer.showPopover(); } catch (e) {}
        }
      }
    });
    if (result.isConfirmed) {
      this.appointmentService.deleteAppointment(this.data.appointment.id).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }
}
