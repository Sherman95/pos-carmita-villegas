import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, lastValueFrom, firstValueFrom } from 'rxjs'; // 👈 1. IMPORTANTE: Agregamos firstValueFrom
import { environment } from '../../environments/environment';
import { SettingsService } from './settings.service';

export interface DeudaCliente {
  cliente_id: string;
  nombre: string;
  total_deuda: number;
  ventas_pendientes: number;
  ventas: any[];
}

@Injectable({
  providedIn: 'root'
})
export class SalesService {
  private http = inject(HttpClient);
  private settings = inject(SettingsService);
  
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  // --- MÉTODOS DE VENTA ---
  saveSale(saleData: any): Observable<any> {
    const currentTaxRate = this.settings.settings().taxRate;
    const payload = { ...saleData, tax_rate: currentTaxRate };
    return this.http.post(this.apiUrl, payload);
  }

  getReceiptsByClient(clientId: string, params?: any): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/receipt-by-client/${clientId}`, { params });
  }

  // --- MÉTODOS DE CONSULTA Y REPORTES ---
  getSales(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getSaleDetails(id: string): Observable<{ sale: any; details: any[] }> {
    return this.http.get<{ sale: any; details: any[] }>(`${this.apiUrl}/${id}`);
  }

  getSaleDetailsBatch(ids: string[]): Observable<Record<string, any[]>> {
    return this.http.post<Record<string, any[]>>(`${this.apiUrl}/details/batch`, { ids });
  }

  getSalesByRange(from: string, to: string): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/range`, { params: { from, to } });
  }

  getSalesSummary(params: any): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/summary`, { params });
  }

  getSalesByClient(clientId: string, params?: any): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/by-client/${clientId}`, { params });
  }

  getSalesByItem(itemId: string, params?: any): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/by-item/${itemId}`, { params });
  }

  // --- MÉTODOS DE FIADOS ---
  async getCarteraVencida(): Promise<DeudaCliente[]> {
    const observable = this.http.get<DeudaCliente[]>(`${this.apiUrl}/debtors`);
    return await lastValueFrom(observable);
  }


  registrarAbono(saleId: string, monto: number, metodo: string = 'EFECTIVO') {
    // Usamos firstValueFrom directamenete (sin 'this.')
    return firstValueFrom(
      this.http.post(`${this.apiUrl}/payment`, { 
        saleId, 
        monto,
        metodo_pago: metodo 
      })
    );
  }
}
