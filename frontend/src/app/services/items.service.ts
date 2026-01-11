import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Item } from '../interfaces/interfaces';

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:3000/api/items';

  getItems(): Observable<Item[]> {
    return this.http.get<Item[]>(this.apiUrl);
  }

  createItem(payload: Partial<Item> & { tipo: 'PRODUCTO' | 'SERVICIO' }): Observable<Item> {
    return this.http.post<Item>(this.apiUrl, payload);
  }

  updateItem(id: string, payload: Partial<Item>): Observable<Item> {
    return this.http.put<Item>(`${this.apiUrl}/${id}`, payload);
  }

  deleteItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}