import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/sidro`;
  
  private memoryToken: string | null = null;

  constructor(private http: HttpClient) {}

  login(email: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/login`, { email, password });
  }

  legacyLogin(telefono: string, password: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/login/legacy`, { telefono, password });
  }

  register(data: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/register`, data);
  }

  requestPasswordReset(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/password/forgot`, { email });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/password/reset`, { token, password });
  }

  updateRecoveryEmail(email: string, currentPassword: string): Observable<{ pending_email: string; message: string }> {
    return this.http.put<{ pending_email: string; message: string }>(`${this.apiUrl}/profile/recovery-email`, {
      email,
      current_password: currentPassword
    });
  }

  verifyEmail(token: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/email/verify`, { token });
  }

  updateWhatsapp(whatsapp: string, currentPassword = ''): Observable<{ whatsapp: string; message: string }> {
    return this.http.put<{ whatsapp: string; message: string }>(`${this.apiUrl}/profile/whatsapp`, {
      whatsapp,
      current_password: currentPassword
    });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.apiUrl}/profile/change-password`, {
      current_password: currentPassword,
      new_password: newPassword
    });
  }

  getProfile(): Observable<any> {
    return this.http.get(`${this.apiUrl}/profile`);
  }

  completeProfileData(data: {
    documento?: string;
    direccion?: string;
  }): Observable<{ message: string; documento: string | null; direccion: string | null; profile_complete: boolean }> {
    return this.http.put<{ message: string; documento: string | null; direccion: string | null; profile_complete: boolean }>(
      `${this.apiUrl}/profile/complete-data`,
      data
    );
  }

  setToken(token: string) {
    this.memoryToken = token;
  }

  getToken(): string | null {
    return this.memoryToken;
  }

  isLoggedIn(): boolean {
    return !!this.memoryToken;
  }

  logout() {
    this.memoryToken = null;
  }
}
