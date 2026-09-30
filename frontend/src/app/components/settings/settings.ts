import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { FormsModule } from '@angular/forms';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MatSelectModule } from '@angular/material/select';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatCardModule, FormsModule, MatSelectModule],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit {
  calendars: any[] = [];
  employees: Employee[] = [];
  loading = true;
  
  newCalendarId = '';
  newEmployeeId: number | null = null;
  newDescription = '';

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private employeeService: EmployeeService
  ) {}

  ngOnInit() {
    this.employeeService.getEmployees().subscribe(res => {
      this.employees = res;
      this.cdr.detectChanges();
    });
    setTimeout(() => this.loadCalendars(), 0);
  }

  loadCalendars() {
    this.loading = true;
    this.http.get<any[]>(`${environment.apiBaseUrl}/api/auth/google/calendars`).subscribe({
      next: (res) => {
        this.calendars = res;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando calendarios', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  addCalendar() {
    this.loading = true;
    const payload = {
      calendarId: this.newCalendarId,
      employeeId: this.newEmployeeId,
      description: this.newDescription
    };

    this.http.post<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar`, payload).subscribe({
      next: (res) => {
        Swal.fire({
          icon: 'success',
          title: '¡Vinculado!',
          text: res.message,
          timer: 2500,
          showConfirmButton: false
        });
        this.newCalendarId = '';
        this.newEmployeeId = null;
        this.newDescription = '';
        this.loadCalendars();
      },
      error: (err) => {
        const errorMsg = err.error?.error || 'Error desconocido';
        Swal.fire({
          icon: 'error',
          title: 'Error',
          text: errorMsg
        });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteCalendar(id: number) {
    Swal.fire({
      title: '¿Eliminar vinculación?',
      text: 'Las citas ya sincronizadas no se borrarán de Google.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.loading = true;
        this.http.delete<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar/${id}`).subscribe({
          next: (res) => {
            Swal.fire({ icon: 'success', title: 'Desvinculado', timer: 2000, showConfirmButton: false });
            this.loadCalendars();
          },
          error: (err) => {
            Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo desvincular' });
            this.loading = false;
            this.cdr.detectChanges();
          }
        });
      }
    });
  }

  syncCalendar(id: number) {
    this.loading = true;
    
    Swal.fire({
      title: 'Sincronizando...',
      text: 'Enviando citas a Google Calendar. Esto puede tardar unos segundos.',
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    this.http.post<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar/${id}/sync`, {}).subscribe({
      next: (res) => {
        Swal.fire({
          icon: 'success',
          title: '¡Listo!',
          text: res.message
        });
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        Swal.fire({
          icon: 'error',
          title: 'Error de Sincronización',
          text: 'Hubo un problema enviando las citas'
        });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
