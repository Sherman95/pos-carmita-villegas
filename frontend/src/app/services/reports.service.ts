import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiBaseUrl}/api/sales`;

  // ===========================================================================
  // MODIFICADO: Aplicamos el "Parche de Zona Horaria" en getByRange
  // ===========================================================================
  getByRange(from: string, to: string): Observable<any[]> {
    // Convertimos '2026-01-15' -> '2026-01-15T05:00:00.000Z' (Inicio real en Ecuador)
    // Convertimos '2026-01-15' -> '2026-01-16T04:59:59.999Z' (Fin real en Ecuador)
    const utcFrom = this.toEcuadorStart(from);
    const utcTo = this.toEcuadorEnd(to);

    const params = new HttpParams().set('from', utcFrom).set('to', utcTo);
    return this.http.get<any[]>(`${this.baseUrl}/range`, { params });
  }

  getSummary(opts: { period?: 'week' | 'month' | 'year'; year?: number; month?: number; from?: string; to?: string }): Observable<{ count: number; total: number }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    if (opts.year) params = params.set('year', opts.year);
    if (opts.month) params = params.set('month', opts.month);
    
    // MODIFICADO: Si mandamos fechas específicas, también las ajustamos
    if (opts.from) params = params.set('from', this.toEcuadorStart(opts.from));
    if (opts.to) params = params.set('to', this.toEcuadorEnd(opts.to));

    return this.http.get<{ count: number; total: number }>(`${this.baseUrl}/summary`, { params });
  }

  getByClient(clientId: string, opts: { period?: 'week' | 'month' | 'year'; from?: string; to?: string } = {}): Observable<{ sales: any[]; summary: { count: number; total: number } }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    
    // MODIFICADO: Ajuste de zona horaria
    if (opts.from) params = params.set('from', this.toEcuadorStart(opts.from));
    if (opts.to) params = params.set('to', this.toEcuadorEnd(opts.to));

    return this.http.get<{ sales: any[]; summary: { count: number; total: number } }>(`${this.baseUrl}/by-client/${clientId}`, { params });
  }

  getByItem(itemId: string, opts: { period?: 'week' | 'month' | 'year'; from?: string; to?: string } = {}): Observable<{ sales: any[]; summary: { count: number; total: number } }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    
    // MODIFICADO: Ajuste de zona horaria
    if (opts.from) params = params.set('from', this.toEcuadorStart(opts.from));
    if (opts.to) params = params.set('to', this.toEcuadorEnd(opts.to));

    return this.http.get<{ sales: any[]; summary: { count: number; total: number } }>(`${this.baseUrl}/by-item/${itemId}`, { params });
  }

  // ===========================================================================
  // 🧠 LÓGICA DE ZONA HORARIA (ECUADOR UTC-5)
  // ===========================================================================

  // Convierte "2026-01-14" (00:00 EC) -> "2026-01-14T05:00:00Z" (UTC)
  private toEcuadorStart(dateStr: string): string {
    // Si ya viene con formato largo, no lo tocamos
    if (dateStr.includes('T')) return dateStr; 
    return `${dateStr}T05:00:00.000Z`;
  }

  // Convierte "2026-01-14" (23:59 EC) -> "2026-01-15T04:59:59Z" (UTC del día siguiente)
  private toEcuadorEnd(dateStr: string): string {
    if (dateStr.includes('T')) return dateStr;

    // Creamos la fecha base
    const date = new Date(dateStr);
    // Le sumamos 1 día para irnos al día siguiente
    date.setDate(date.getDate() + 1);
    
    // Obtenemos el string YYYY-MM-DD del día siguiente
    const nextDay = date.toISOString().split('T')[0];
    
    // Retornamos las 04:59:59 AM UTC (que son las 23:59:59 PM Ecuador del día anterior)
    return `${nextDay}T04:59:59.999Z`;
  }
}