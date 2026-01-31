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
  
  // 👇 AGREGAR ESTO para conectar con los Gastos
  getExpenses(from: string, to: string): Observable<any[]> {
    // Reutilizamos tu lógica maestra de horas para que cuadre perfecto
    const utcFrom = this.toEcuadorStart(from);
    const utcTo = this.toEcuadorEnd(to);

    const params = new HttpParams().set('from', utcFrom).set('to', utcTo);
    
    // OJO: Aquí usamos 'environment.apiBaseUrl' directo para ir a /api/reports/expenses
    // NO usamos 'this.baseUrl' porque esa apunta a /sales
    return this.http.get<any[]>(`${environment.apiBaseUrl}/api/reports/expenses`, { params });
  }
  
  // ===========================================================================
  // 🧠 LÓGICA DE ZONA HORARIA (ECUADOR UTC-5) - VERSIÓN AGRESIVA
  // ===========================================================================

  // Convierte "2026-01-15" (o "2026-01-15T00:00...") -> "2026-01-15T05:00:00.000Z"
  // Esto asegura que el día empiece a las 00:00 de Ecuador (05:00 UTC)
  private toEcuadorStart(dateStr: string): string {
    // 1. Nos quedamos solo con la parte de la fecha YYYY-MM-DD, ignoramos la hora que venga
    const dateOnly = dateStr.split('T')[0];
    
    // 2. Le pegamos el inicio de día ecuatoriano (05:00 UTC)
    return `${dateOnly}T05:00:00.000Z`;
  }

  // Convierte "2026-01-15" -> "2026-01-16T04:59:59.999Z"
  // Esto asegura que el día termine a las 23:59:59 de Ecuador
  private toEcuadorEnd(dateStr: string): string {
    // 1. Limpiamos la hora
    const dateOnly = dateStr.split('T')[0];

    // 2. Creamos fecha base y sumamos 1 día
    const date = new Date(dateOnly);
    date.setDate(date.getDate() + 1);
    
    // 3. Obtenemos el YYYY-MM-DD del día siguiente
    const nextDay = date.toISOString().split('T')[0];
    
    // 4. Retornamos justo antes de las 05:00 AM UTC del día siguiente
    return `${nextDay}T04:59:59.999Z`;
  }
}