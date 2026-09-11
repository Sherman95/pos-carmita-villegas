import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Appointment {
  id: string;
  client_id: string;
  item_id: string;
  employee_id: string;
  fecha_inicio: string; // ISO String
  fecha_fin: string;    // ISO String
  estado: string;
  notas?: string;
  google_event_id?: string;
  // Campos adicionales del JOIN
  client_nombre?: string;
  item_nombre?: string;
  employee_nombre?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AppointmentService {
  private apiUrl = `${environment.apiBaseUrl}/api/appointments`;

  constructor(private http: HttpClient) {}

  getAppointments(): Observable<Appointment[]> {
    return this.http.get<Appointment[]>(this.apiUrl);
  }

  getAppointmentById(id: string): Observable<Appointment> {
    return this.http.get<Appointment>(`${this.apiUrl}/${id}`);
  }

  createAppointment(appointment: Partial<Appointment>, force: boolean = false): Observable<Appointment> {
    const url = force ? `${this.apiUrl}?force=true` : this.apiUrl;
    return this.http.post<Appointment>(url, appointment);
  }

  updateAppointment(id: string, appointment: Partial<Appointment>, force: boolean = false): Observable<Appointment> {
    const url = force ? `${this.apiUrl}/${id}?force=true` : `${this.apiUrl}/${id}`;
    return this.http.put<Appointment>(url, appointment);
  }

  deleteAppointment(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/${id}`);
  }
}
