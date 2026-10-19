import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, tap } from 'rxjs';
import { CashControlSetting, CashStatus, ClosingDetails } from '../models/cash.model';

@Injectable({
  providedIn: 'root'
})
export class CashService {
  private apiUrl = `${environment.apiBaseUrl}/api/cash`;
  private settingsUrl = `${environment.apiBaseUrl}/api/settings/cash-control`;
  private controlEnabledSig = signal(true);

  readonly controlEnabled = this.controlEnabledSig.asReadonly();

  constructor(private http: HttpClient) { }

  // 1. Verificar estado
  getStatus(): Observable<CashStatus> {
    return this.http.get<CashStatus>(`${this.apiUrl}/status`).pipe(
      tap(status => this.controlEnabledSig.set(status.controlEnabled !== false))
    );
  }

  getControlSetting(): Observable<CashControlSetting> {
    return this.http.get<CashControlSetting>(this.settingsUrl).pipe(
      tap(setting => this.controlEnabledSig.set(setting.controlEnabled !== false))
    );
  }

  updateControlSetting(controlEnabled: boolean): Observable<CashControlSetting> {
    return this.http.put<CashControlSetting>(this.settingsUrl, { controlEnabled }).pipe(
      tap(setting => this.controlEnabledSig.set(setting.controlEnabled !== false))
    );
  }

  // 2. Abrir caja
  openRegister(montoInicial: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/open`, { 
      monto_inicial: montoInicial
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
