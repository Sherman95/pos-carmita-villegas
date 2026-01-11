import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Client {
  id: string;
  nombre: string;
  cedula?: string | null;
  telefono?: string | null;
  email?: string | null;
  ultima_visita?: string | null;
  created_at?: string;
  updated_at?: string;
}

@Injectable({ providedIn: 'root' })
export class ClientsService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/clients';

  getClients(): Observable<Client[]> {
    return this.http.get<Client[]>(this.apiUrl);
  }

  createClient(payload: Partial<Client>): Observable<Client> {
    return this.http.post<Client>(this.apiUrl, payload);
  }

  updateClient(id: string, payload: Partial<Client>): Observable<Client> {
    return this.http.put<Client>(`${this.apiUrl}/${id}`, payload);
  }

  deleteClient(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
