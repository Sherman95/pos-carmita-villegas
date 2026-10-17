import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';
import { Expense, ExpensesResponse, ExpenseCategoryItem } from '../models/expense.model';

@Injectable({
  providedIn: 'root'
})
export class ExpensesService {

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

  // ==========================================
  // CRUD DE CATEGORÍAS DE GASTOS
  // ==========================================

  /**
   * Obtener todas las categorías de gastos
   */
  getCategories(): Observable<ExpenseCategoryItem[]> {
    return this.http.get<ExpenseCategoryItem[]>(`${this.apiUrl}/categories`);
  }

  /**
   * Crear una nueva categoría de gasto
   */
  createCategory(category: Partial<ExpenseCategoryItem>): Observable<ExpenseCategoryItem> {
    return this.http.post<ExpenseCategoryItem>(`${this.apiUrl}/categories`, category);
  }

  /**
   * Actualizar una categoría existente
   */
  updateCategory(id: number, category: Partial<ExpenseCategoryItem>): Observable<ExpenseCategoryItem> {
    return this.http.put<ExpenseCategoryItem>(`${this.apiUrl}/categories/${id}`, category);
  }

  /**
   * Eliminar una categoría por ID
   */
  deleteCategory(id: number): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.apiUrl}/categories/${id}`);
  }
}
