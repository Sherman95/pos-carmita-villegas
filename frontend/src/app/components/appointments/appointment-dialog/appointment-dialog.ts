import { Component, Inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AppointmentService } from '../../../services/appointment.service';
import { EmployeeService, Employee } from '../../../services/employee.service';
import { ClientsService } from '../../../services/clients.service';
import { ItemsService } from '../../../services/items.service';

@Component({
  selector: 'app-appointment-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './appointment-dialog.html',
  styleUrls: ['./appointment-dialog.scss']
})
export class AppointmentDialogComponent implements OnInit {
  form: FormGroup;
  isEdit = false;
  
  clients: any[] = [];
  servicesList: any[] = [];
  employees: Employee[] = [];

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
    this.clientsService.getClients().subscribe(res => this.clients = res);
    this.itemsService.getItems().subscribe(res => {
      // Filtrar solo los items que son de tipo SERVICIO
      this.servicesList = res.filter((i: any) => i.tipo === 'SERVICIO');
    });
    this.employeeService.getEmployees().subscribe(res => this.employees = res);
  }

  cancelar(): void {
    this.dialogRef.close();
  }

  guardar(): void {
    if (this.form.invalid) return;

    const payload = {
      ...this.form.value,
      // Convertir a ISO puro para el backend PostgreSQL
      fecha_inicio: new Date(this.form.value.fecha_inicio).toISOString(),
      fecha_fin: new Date(this.form.value.fecha_fin).toISOString()
    };

    if (this.isEdit) {
      this.appointmentService.updateAppointment(this.data.appointment.id, payload).subscribe(() => {
        this.dialogRef.close(true);
      });
    } else {
      this.appointmentService.createAppointment(payload).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }

  eliminar(): void {
    if (confirm('¿Estás seguro de eliminar esta cita?')) {
      this.appointmentService.deleteAppointment(this.data.appointment.id).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }
}
