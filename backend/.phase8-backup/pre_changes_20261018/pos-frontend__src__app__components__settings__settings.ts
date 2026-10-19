import { Component, OnInit, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { EmployeeService, Employee } from '../../services/employee.service';
import Swal from 'sweetalert2';
import { CashService } from '../../services/cash';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatButtonModule, MatIconModule, FormsModule],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit {
  readonly serviceAccountEmail = 'robot-citas@pos-carmita-calendar.iam.gserviceaccount.com';
  calendars: any[] = [];
  employees: Employee[] = [];
  loading = true;
  loadError = '';
  cashControlEnabled = true;
  cashControlLoading = true;
  cashControlSaving = false;
  cashControlError = '';

  newCalendarId = '';
  newEmployeeId: number | null = null;
  newDescription = '';

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private employeeService: EmployeeService,
    private cashService: CashService
  ) {}

  ngOnInit() {
    this.employeeService.getEmployees().subscribe(res => {
      this.employees = res;
      this.cdr.detectChanges();
    });
    this.loadCashControlSetting();
    setTimeout(() => this.loadCalendars(), 0);
  }

  loadCashControlSetting(): void {
    this.cashControlLoading = true;
    this.cashControlError = '';
    this.cashService.getControlSetting().subscribe({
      next: (setting) => {
        this.cashControlEnabled = setting.controlEnabled;
        this.cashControlLoading = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.cashControlLoading = false;
        this.cashControlError = error.error?.error || 'No pudimos consultar la configuración de caja.';
        this.cdr.markForCheck();
      }
    });
  }

  async requestCashControlChange(): Promise<void> {
    if (this.cashControlLoading || this.cashControlSaving) return;
    const nextEnabled = !this.cashControlEnabled;
    const confirmation = await Swal.fire({
      icon: 'warning',
      title: nextEnabled ? '¿Activar control de caja?' : '¿Desactivar control de caja?',
      text: nextEnabled
        ? 'Después del cambio deberás abrir una nueva caja antes de registrar operaciones financieras.'
        : 'Ventas, abonos y gastos seguirán registrándose, pero no pertenecerán a una sesión de caja.',
      showCancelButton: true,
      confirmButtonText: nextEnabled ? 'Sí, activar' : 'Sí, desactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: 'var(--brand-base)'
    });
    if (!confirmation.isConfirmed) return;

    this.cashControlSaving = true;
    this.cashControlError = '';
    this.cdr.markForCheck();
    this.cashService.updateControlSetting(nextEnabled).subscribe({
      next: async (setting) => {
        this.cashControlEnabled = setting.controlEnabled;
        this.cashControlSaving = false;
        this.cdr.markForCheck();
        await Swal.fire({
          icon: 'success',
          title: setting.controlEnabled ? 'Control activado' : 'Control desactivado',
          text: setting.message,
          confirmButtonColor: 'var(--brand-base)'
        });
      },
      error: async (error) => {
        this.cashControlSaving = false;
        this.cashControlError = error.error?.error || 'No se pudo cambiar la configuración de caja.';
        this.cdr.markForCheck();
        await Swal.fire({
          icon: 'error',
          title: 'No se pudo realizar el cambio',
          text: this.cashControlError,
          confirmButtonColor: 'var(--brand-base)'
        });
      }
    });
  }

  get professionalCalendars(): number {
    return this.calendars.filter((calendar) => Boolean(calendar.employee_id)).length;
  }

  get generalCalendars(): number {
    return this.calendars.length - this.professionalCalendars;
  }

  loadCalendars() {
    this.loading = true;
    this.loadError = '';
    this.http.get<any[]>(`${environment.apiBaseUrl}/api/auth/google/calendars`).subscribe({
      next: (res) => {
        this.calendars = res;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error cargando calendarios', err);
        this.loadError = 'No pudimos consultar los calendarios vinculados. Revisa la conexión e inténtalo nuevamente.';
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  addCalendar() {
    const calendarId = this.newCalendarId.trim();
    if (!calendarId) return;

    this.loading = true;
    const payload = {
      calendarId,
      employeeId: this.newEmployeeId,
      description: this.newDescription.trim()
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

  async copyServiceEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.serviceAccountEmail);
      await Swal.fire({
        icon: 'success',
        title: 'Correo copiado',
        text: 'Ya puedes pegarlo en la configuración de Google Calendar.',
        toast: true,
        position: 'top-end',
        timer: 2200,
        showConfirmButton: false
      });
    } catch {
      await Swal.fire({
        icon: 'info',
        title: 'Copia el correo manualmente',
        text: this.serviceAccountEmail
      });
    }
  }

  deleteCalendar(id: number) {
    Swal.fire({
      title: '¿Eliminar vinculación?',
      text: 'Esto eliminará de Google Calendar todas las citas sincronizadas con esta vinculación.',
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
