import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { EmployeeService, Employee } from '../../services/employee.service';
import { MatSelectModule } from '@angular/material/select';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatCardModule, MatSnackBarModule, FormsModule, MatSelectModule],
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
    private snackBar: MatSnackBar,
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
        this.snackBar.open(res.message, 'Cerrar', { duration: 3000 });
        this.newCalendarId = '';
        this.newEmployeeId = null;
        this.newDescription = '';
        this.loadCalendars();
      },
      error: (err) => {
        const errorMsg = err.error?.error || 'Error desconocido';
        this.snackBar.open(errorMsg, 'Cerrar', { duration: 5000, panelClass: ['error-snackbar'] });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  deleteCalendar(id: number) {
    if (!confirm('¿Estás seguro de eliminar esta vinculación? Las citas ya sincronizadas no se borrarán de Google.')) return;
    this.loading = true;
    this.http.delete<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar/${id}`).subscribe({
      next: (res) => {
        this.snackBar.open('Calendario desvinculado', 'Cerrar', { duration: 3000 });
        this.loadCalendars();
      },
      error: (err) => {
        this.snackBar.open('Error al desvincular', 'Cerrar', { duration: 3000 });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  syncCalendar(id: number) {
    this.loading = true;
    this.http.post<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar/${id}/sync`, {}).subscribe({
      next: (res) => {
        this.snackBar.open(res.message, 'Cerrar', { duration: 5000 });
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.snackBar.open('Error al sincronizar citas', 'Cerrar', { duration: 3000 });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
