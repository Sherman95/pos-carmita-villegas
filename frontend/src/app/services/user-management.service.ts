import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export type PosUserRole = 'admin' | 'user';

export interface ManagedPosUser {
  id: string;
  username: string;
  role: PosUserRole;
  active: boolean;
  employee_id: string | null;
  employee_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpdateUserAccessPayload {
  role: PosUserRole;
  active: boolean;
}

@Injectable({ providedIn: 'root' })
export class UserManagementService {
  private readonly apiUrl = `${environment.apiBaseUrl}/api/auth/users`;

  constructor(private http: HttpClient) {}

  getUsers() {
    return this.http.get<ManagedPosUser[]>(this.apiUrl);
  }

  updateAccess(userId: string, payload: UpdateUserAccessPayload) {
    return this.http.patch<{ message: string; user: ManagedPosUser }>(
      `${this.apiUrl}/${userId}/access`,
      payload
    );
  }
}
