import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private http = inject(HttpClient);
  private baseUrl = 'http://localhost:3000/api/sales';

  getByRange(from: string, to: string): Observable<any[]> {
    const params = new HttpParams().set('from', from).set('to', to);
    return this.http.get<any[]>(`${this.baseUrl}/range`, { params });
  }

  getSummary(opts: { period?: 'week' | 'month' | 'year'; year?: number; month?: number; from?: string; to?: string }): Observable<{ count: number; total: number }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    if (opts.year) params = params.set('year', opts.year);
    if (opts.month) params = params.set('month', opts.month);
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);
    return this.http.get<{ count: number; total: number }>(`${this.baseUrl}/summary`, { params });
  }

  getByClient(clientId: string, opts: { period?: 'week' | 'month' | 'year'; from?: string; to?: string } = {}): Observable<{ sales: any[]; summary: { count: number; total: number } }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);
    return this.http.get<{ sales: any[]; summary: { count: number; total: number } }>(`${this.baseUrl}/by-client/${clientId}`, { params });
  }

  getByItem(itemId: string, opts: { period?: 'week' | 'month' | 'year'; from?: string; to?: string } = {}): Observable<{ sales: any[]; summary: { count: number; total: number } }> {
    let params = new HttpParams();
    if (opts.period) params = params.set('period', opts.period);
    if (opts.from) params = params.set('from', opts.from);
    if (opts.to) params = params.set('to', opts.to);
    return this.http.get<{ sales: any[]; summary: { count: number; total: number } }>(`${this.baseUrl}/by-item/${itemId}`, { params });
  }
}
