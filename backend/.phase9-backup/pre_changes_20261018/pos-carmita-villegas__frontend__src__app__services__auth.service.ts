import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface PosCurrentUser {
  id: string;
  username: string;
  role: 'owner' | 'admin' | 'reception' | 'professional';
  permissions: string[];
  employee_id?: string | number | null;
  email?: string | null;
  email_verified_at?: string | null;
  must_change_password?: boolean;
  tax_rate?: number;
  business_name?: string;
  business_ruc?: string;
  business_address?: string;
  business_phone?: string;
}

interface LoginResponse {
  token: string;
  user: PosCurrentUser;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = `${environment.apiBaseUrl}/api/auth`;

  currentUser = signal<LoginResponse['user'] | null>(this.getStoredUser());

  constructor(private http: HttpClient) {}

  login(username: string, password: string) {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
      tap((resp) => {
        resp.user.tax_rate = Number(resp.user.tax_rate || 0);

        localStorage.setItem('token', resp.token);
        localStorage.setItem('currentUser', JSON.stringify(resp.user));

        this.currentUser.set(resp.user);
      })
    );
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    this.currentUser.set(null);
  }

  refreshCurrentUser() {
    return this.http.get<{ user: LoginResponse['user'] }>(`${this.apiUrl}/me`).pipe(
      tap((resp) => {
        if (resp.user) {
          resp.user.tax_rate = Number(resp.user.tax_rate || 0);
          this.setUserLocal(resp.user);
        }
      })
    );
  }

  isAdmin(): boolean {
    const user = this.currentUser();
    const role = user?.role?.trim().toLowerCase();
    return role === 'owner' || role === 'admin';
  }

  isOwner(): boolean {
    return this.currentUser()?.role === 'owner';
  }

  hasPermission(permission: string): boolean {
    return this.currentUser()?.permissions?.includes(permission) ?? false;
  }

  changePassword(payload: { current_password: string; new_password: string; confirmation: string }) {
    return this.http.post<{ message: string; token: string }>(`${this.apiUrl}/change-password`, payload).pipe(
      tap((response) => localStorage.setItem('token', response.token))
    );
  }

  completePasswordReset(payload: { token: string; new_password: string; confirmation: string }) {
    return this.http.post<{ message: string }>(`${this.apiUrl}/password-reset/complete`, payload);
  }

  // ✅ MÉTODO CORREGIDO: Ahora SÍ construye y envía la cabecera con el Token
  updateProfile(data: Record<string, unknown>) {

    // 1. Recuperamos el token del almacenamiento local
    const token = this.getToken();

    // 2. Creamos la cabecera (Header) con la autorización
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${token}`
    });

    // 3. Enviamos la petición PUT incluyendo los 'headers'
    return this.http.put<{ message: string, user: LoginResponse['user'] }>(
      `${this.apiUrl}/profile`,
      data,
      { headers } // 👈 ¡ESTA ES LA LLAVE QUE FALTABA!
    ).pipe(
      tap((resp) => {
        if (resp.user) {
          resp.user.tax_rate = Number(resp.user.tax_rate || 0);
          this.setUserLocal(resp.user); // Actualizamos la vista inmediatamente
          console.log('☁️ Sincronizado con la nube:', resp.user);
        }
      })
    );
  }

  setUserLocal(user: LoginResponse['user']) {
    localStorage.setItem('currentUser', JSON.stringify(user));
    this.currentUser.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private getStoredUser(): LoginResponse['user'] | null {
    const raw = localStorage.getItem('currentUser');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
