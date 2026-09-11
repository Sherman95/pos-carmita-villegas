import { Component, OnInit, ChangeDetectorRef , ChangeDetectionStrategy } from '@angular/core';

import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatCardModule, MatSnackBarModule, FormsModule],
  templateUrl: './settings.html',
  styleUrls: ['./settings.scss']
})
export class SettingsComponent implements OnInit {
  isGoogleConnected = false;
  loading = true;
  calendarId = '';

  constructor(
    private http: HttpClient,
    private snackBar: MatSnackBar,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    // Avoid NG0100 by executing in next tick if it's too fast
    setTimeout(() => this.checkGoogleStatus(), 0);
  }

  checkGoogleStatus() {
    this.loading = true;
    this.http.get<{isConnected: boolean, calendarId: string}>(`${environment.apiBaseUrl}/api/auth/google/status`).subscribe({
      next: (res) => {
        this.isGoogleConnected = res.isConnected;
        this.calendarId = res.calendarId || '';
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        console.error('Error verificando estado de Google', err);
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }

  saveCalendar() {
    this.loading = true;
    this.http.post<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar`, { calendarId: this.calendarId }).subscribe({
      next: (res) => {
        this.snackBar.open(res.message, 'Cerrar', { duration: 3000 });
        this.isGoogleConnected = true;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        const errorMsg = err.error?.error || 'Error desconocido';
        this.snackBar.open(errorMsg, 'Cerrar', { duration: 5000, panelClass: ['error-snackbar'] });
        this.loading = false;
        this.isGoogleConnected = false;
        this.cdr.detectChanges();
      }
    });
  }

  disconnectCalendar() {
    this.loading = true;
    this.http.post<{success: boolean, message: string}>(`${environment.apiBaseUrl}/api/auth/google/calendar`, { calendarId: '' }).subscribe({
      next: (res) => {
        this.snackBar.open('Calendario desvinculado', 'Cerrar', { duration: 3000 });
        this.isGoogleConnected = false;
        this.calendarId = '';
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.snackBar.open('Error al desvincular', 'Cerrar', { duration: 3000 });
        this.loading = false;
        this.cdr.detectChanges();
      }
    });
  }
}
