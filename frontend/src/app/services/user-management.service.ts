import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type PosUserRole = 'owner' | 'admin' | 'reception' | 'professional';

export interface ManagedPosUser {
  id: string;
  username: string;
  role: PosUserRole;
  active: boolean;
  employee_id: string | null;
  employee_name: string | null;
  email: string | null;
  email_verified_at: string | null;
  must_change_password: boolean;
  last_login_at: string | null;
  password_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserAccessPayload {
  role: PosUserRole;
  active: boolean;
}

export interface ManagedEmployee { id: string | number; nombre: string; active?: boolean; }
export interface ManagedUserPayload {
  username: string;
  email?: string | null;
  role: PosUserRole;
  employee_id?: string | number | null;
  active?: boolean;
}

export interface AuditEntry {
  id: number;
  action: string;
  actor_username: string | null;
  target_username: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  private readonly apiUrl = `${environment.apiBaseUrl}/api/auth/users`;

  constructor(private http: HttpClient) {}

  getUsers() {
    return this.http.get<ManagedPosUser[]>(this.apiUrl);
  }

  getEmployees() {
    return this.http.get<ManagedEmployee[]>(`${environment.apiBaseUrl}/api/employees`);
  }

  createUser(payload: ManagedUserPayload) {
    return this.http.post<{ message: string; user: ManagedPosUser; temporary_password: string }>(this.apiUrl, payload);
  }

  updateUser(userId: string, payload: Partial<ManagedUserPayload>) {
    return this.http.patch<{ message: string; user: ManagedPosUser }>(`${this.apiUrl}/${userId}`, payload);
  }

  updateAccess(userId: string, payload: UpdateUserAccessPayload) {
    return this.http.patch<{ message: string; user: ManagedPosUser }>(
      `${this.apiUrl}/${userId}/access`,
      payload
    );
  }

  resetPassword(userId: string, mode: 'temporary' | 'email') {
    return this.http.post<{ message: string; delivery: string; temporary_password?: string }>(`${this.apiUrl}/${userId}/password-reset`, { mode });
  }

  revokeSessions(userId: string) {
    return this.http.post<{ message: string }>(`${this.apiUrl}/${userId}/revoke-sessions`, {});
  }

  getAudit() {
    return this.http.get<AuditEntry[]>(`${environment.apiBaseUrl}/api/auth/audit`);
  }
}
