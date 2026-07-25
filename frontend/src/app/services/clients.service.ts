import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface Client {
  id: string;
  nombre: string;
  cedula?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null; // <--- NUEVO CAMPO AGREGADO
  ultima_visita?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DeleteClientResponse {
  message: string;
  reassignedSales: number;
}

export interface ClientDeletionImpact {
  clientName: string;
  salesCount: number;
  pendingDebtCount: number;
  pendingDebtAmount: number;
  isFinalConsumer: boolean;
}

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/clients`;

  getClients(): Observable<Client[]> {
    return this.http.get<Client[]>(this.apiUrl);
  }

  createClient(payload: Partial<Client>): Observable<Client> {
    return this.http.post<Client>(this.apiUrl, payload);
  }

  updateClient(id: string, payload: Partial<Client>): Observable<Client> {
    return this.http.put<Client>(`${this.apiUrl}/${id}`, payload);
  }

  deleteClient(id: string): Observable<DeleteClientResponse> {
    return this.http.delete<DeleteClientResponse>(`${this.apiUrl}/${id}`);
  }

  getDeletionImpact(id: string): Observable<ClientDeletionImpact> {
    return this.http.get<ClientDeletionImpact>(`${this.apiUrl}/${id}/deletion-impact`);
  }
}
