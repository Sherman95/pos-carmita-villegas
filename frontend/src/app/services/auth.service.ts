import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../environments/environment';

interface LoginResponse {
  token: string;
  user: { id: string; username: string; role: string };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private apiUrl = `${environment.apiBaseUrl}/api/auth`;
  currentUser = signal<LoginResponse['user'] | null>(this.getStoredUser());

  constructor(private http: HttpClient) {}

  login(username: string, password: string) {
    return this.http.post<LoginResponse>(`${this.apiUrl}/login`, { username, password }).pipe(
      tap((resp) => {
        localStorage.setItem('token', resp.token);
        localStorage.setItem('user', JSON.stringify(resp.user));
        this.currentUser.set(resp.user);
      })
    );
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
  }

  // Solo actualiza el usuario en memoria/localStorage (para uso en perfil local)
  setUserLocal(user: LoginResponse['user']) {
    localStorage.setItem('user', JSON.stringify(user));
    this.currentUser.set(user);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  private getStoredUser(): LoginResponse['user'] | null {
    const raw = localStorage.getItem('user');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
