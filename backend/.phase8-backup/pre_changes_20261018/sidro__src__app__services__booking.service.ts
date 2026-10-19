import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface SidroRequest {
  id?: number;
  service_id: string;
  service_ids?: string[];
  employee_id: string;
  request_date: string; // YYYY-MM-DD
  start_time: string; // HH:mm
  service_name?: string;
  employee_name?: string;
  status?: SidroRequestStatus;
  proposed_date?: string | null;
  proposed_start_time?: string | null;
  proposed_end_time?: string | null;
  client_notes?: string | null;
  services?: SidroRequestService[];
  image_url?: string | null;
}

export interface SidroRequestService {
  service_id: string;
  service_name: string;
  position?: number;
  duration_minutes?: number;
  padding_minutes?: number;
  official_appointment_id?: string | null;
  image_url?: string | null;
}

export type SidroRequestStatus =
  | 'PENDIENTE'
  | 'PROPUESTA'
  | 'APROBADA_PENDIENTE_VINCULACION'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'CONFLICTO_VINCULACION';

export interface SidroService {
  id: string;
  nombre: string;
  precio: number;
  duration_minutes: number | null;
  padding_minutes: number | null;
  image_url?: string | null;
}

export interface SidroProfessional {
  employee_id: string;
  nombre: string;
}

@Injectable({
  providedIn: 'root'
})
export class BookingService {
  private apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  getServices() {
    return this.http.get<SidroService[]>(`${this.apiUrl}/sidro/public/services`);
  }

  getProfessionals(serviceId: string) {
    return this.http.get<SidroProfessional[]>(`${this.apiUrl}/sidro/public/services/${serviceId}/professionals`);
  }

  getProfessionalsForServices(serviceIds: string[]) {
    return this.http.get<SidroProfessional[]>(`${this.apiUrl}/sidro/public/professionals`, {
      params: { service_ids: serviceIds.join(',') }
    });
  }

  getAvailability(serviceIds: string | string[], employeeId: string, requestDate: string) {
    const normalizedServiceIds = Array.isArray(serviceIds) ? serviceIds : [serviceIds];
    return this.http.get<string[]>(`${this.apiUrl}/sidro/availability`, {
      params: {
        service_ids: normalizedServiceIds.join(','),
        employee_id: employeeId,
        request_date: requestDate
      }
    });
  }

  createRequest(reqData: SidroRequest) {
    return this.http.post<SidroRequest>(`${this.apiUrl}/sidro/requests`, reqData);
  }

  getMyRequests() {
    return this.http.get<SidroRequest[]>(`${this.apiUrl}/sidro/requests`);
  }

  acceptProposal(requestId: number) {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/sidro/requests/${requestId}/accept-proposal`,
      {}
    );
  }

  rejectProposal(requestId: number) {
    return this.http.post<{ message: string }>(
      `${this.apiUrl}/sidro/requests/${requestId}/reject-proposal`,
      {}
    );
  }
}
