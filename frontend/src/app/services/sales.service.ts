import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { SettingsService } from './settings.service';

@Injectable({
  providedIn: 'root'
})
export class SalesService {
  private http = inject(HttpClient);
  private settings = inject(SettingsService); // <--- Ya lo tenías inyectado, ¡perfecto!
  
  // Asegúrate de que esta URL coincida con tu backend
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  saveSale(saleData: any): Observable<any> {
    // =========================================================================
    // CORRECCIÓN PRINCIPAL: INYECTAR EL IVA DEL PERFIL
    // =========================================================================
    
    // 1. Leemos el valor que tienes configurado en tu perfil AHORA MISMO
    const currentTaxRate = this.settings.settings().taxRate;

    // 2. Creamos el paquete final agregando el campo 'tax_rate'
    const payload = {
      ...saleData,
      tax_rate: currentTaxRate 
    };

    // 3. Enviamos 'payload' (que ya lleva el IVA) en lugar de 'saleData' solo
    return this.http.post(this.apiUrl, payload);
  }

  // Este método sigue enviando JSON porque subimos el Base64 generado por jsPDF
  uploadReceipt(saleId: string, pdfBase64: string, docType: string = 'receipt'): Observable<any> {
    return this.http.post(`${this.apiUrl}/${saleId}/receipt`, { pdfBase64, docType });
  }

  // =========================================================================
  // CORRECCIÓN PRINCIPAL (MANTENIDA):
  // Cambiamos el tipo de respuesta a 'blob' para recibir el archivo binario
  // =========================================================================
  getReceipt(saleId: string, docType?: string): Observable<Blob> {
    const params: any = {};
    if (docType) params.docType = docType;

    return this.http.get(`${this.apiUrl}/${saleId}/receipt`, {
      params,
      responseType: 'blob' // <--- ESTO ES LA CLAVE. Indica que esperamos un archivo.
    });
  }

  getReceiptsByClient(clientId: string, params?: { from?: string; to?: string; docType?: string }): Observable<any[]> {
    const httpParams: any = {};
    if (params?.from) httpParams.from = params.from;
    if (params?.to) httpParams.to = params.to;
    if (params?.docType) httpParams.docType = params.docType;
    return this.http.get<any[]>(`${this.apiUrl}/receipt-by-client/${clientId}`, { params: httpParams });
  }

  getSales(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getSaleDetails(id: string): Observable<{ sale: any; details: any[] }> {
    return this.http.get<{ sale: any; details: any[] }>(`${this.apiUrl}/${id}`);
  }
}