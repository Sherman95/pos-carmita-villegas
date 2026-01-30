import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { CashStatus, ClosingDetails } from '../models/cash.model';

@Injectable({
  providedIn: 'root'
})
export class CashService {
  private apiUrl = `${environment.apiBaseUrl}/api/cash`;

  constructor(private http: HttpClient) { }

  // 1. Verificar estado
  getStatus(): Observable<CashStatus> {
    return this.http.get<CashStatus>(`${this.apiUrl}/status`);
  }

  // 2. Abrir caja
  openRegister(montoInicial: number, usuarioId: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/open`, { 
      monto_inicial: montoInicial,
      usuario_id: usuarioId 
    });
  }

  // 3. Obtener cálculos para cerrar
  getClosingDetails(): Observable<ClosingDetails> {
    return this.http.get<ClosingDetails>(`${this.apiUrl}/details`);
  }

  // 4. Cerrar caja (Guardar arqueo)
  closeRegister(id: string, data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/close/${id}`, data);
  }

 // 5. Historial con filtros (from y to son opcionales)
  getHistory(from?: string, to?: string): Observable<any[]> {
    let params = {};
    if (from && to) {
        params = { from, to };
    }
    return this.http.get<any[]>(`${this.apiUrl}/history`, { params });
  }

  // 6. Obtener el reporte DETALLADO de un cierre específico
  getReport(id: string): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/report/${id}`);
  }


}