import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class SalesService {
  private http = inject(HttpClient);
  // Asegúrate de que esta URL coincida con tu backend
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  saveSale(saleData: any): Observable<any> {
    return this.http.post(this.apiUrl, saleData);
  }

  uploadReceipt(saleId: string, pdfBase64: string, docType: string = 'receipt'): Observable<any> {
    return this.http.post(`${this.apiUrl}/${saleId}/receipt`, { pdfBase64, docType });
  }

  getReceipt(saleId: string, docType?: string): Observable<{ pdfBase64: string; created_at: string; doc_type: string }> {
    const params: any = {};
    if (docType) params.docType = docType;
    return this.http.get<{ pdfBase64: string; created_at: string; doc_type: string }>(`${this.apiUrl}/${saleId}/receipt`, { params });
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