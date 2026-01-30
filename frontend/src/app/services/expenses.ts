import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { Expense, ExpensesResponse } from '../models/expense.model'; 

@Injectable({
  providedIn: 'root'
})
export class ExpensesService { // 👈 ¡AQUÍ ESTÁ LA CLAVE! "export class"
  
  // Asegúrate que esta ruta sea correcta (/api/expenses)
  private apiUrl = `${environment.apiBaseUrl}/api/expenses`; 

  constructor(private http: HttpClient) { }

  /**
   * Obtener lista de gastos con filtros
   */
  getExpenses(from?: string, to?: string, categoria?: string): Observable<ExpensesResponse> {
    let params = new HttpParams();
    
    if (from && to) {
      params = params.set('from', from).set('to', to);
    }
    
    if (categoria && categoria !== 'TODAS') {
      params = params.set('categoria', categoria);
    }

    return this.http.get<ExpensesResponse>(this.apiUrl, { params });
  }

  /**
   * Registrar un nuevo gasto
   */
  createExpense(expense: Expense): Observable<any> {
    return this.http.post(this.apiUrl, expense);
  }

  /**
   * Eliminar un gasto por ID
   */
  deleteExpense(id: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }
}