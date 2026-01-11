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

  getSales(): Observable<any[]> {
    return this.http.get<any[]>(this.apiUrl);
  }

  getSaleDetails(id: string): Observable<{ sale: any; details: any[] }> {
    return this.http.get<{ sale: any; details: any[] }>(`${this.apiUrl}/${id}`);
  }
}