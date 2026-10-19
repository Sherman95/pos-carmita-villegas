import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { from, switchMap } from 'rxjs';
import { environment } from '../../environments/environment';

export interface SidroRequest {
  id: number;
  request_date: string;
  start_time: string;
  end_time: string;
  proposed_date?: string | null;
  proposed_start_time?: string | null;
  proposed_end_time?: string | null;
  client_notes?: string | null;
  status: SidroRequestStatus;
  client_name: string;
  client_phone?: string | null;
  client_phone_normalized?: string | null;
  service_name: string;
  employee_name: string;
  linked_client_id?: string | null;
  official_appointment_id?: string | null;
}

export type SidroRequestStatus =
  | 'PENDIENTE'
  | 'PROPUESTA'
  | 'APROBADA_PENDIENTE_VINCULACION'
  | 'CONFIRMADA'
  | 'RECHAZADA'
  | 'CANCELADA'
  | 'CONFLICTO_VINCULACION';

export interface SidroServiceImageReference {
  id: string;
  sidro_image_url: string | null;
  sidro_image_public_id: string | null;
}

interface CloudinaryUploadSignature {
  upload_url: string;
  api_key: string;
  timestamp: number;
  signature: string;
  folder: string;
  public_id: string;
  overwrite: 'true';
  invalidate: 'true';
  allowed_formats: 'jpg,png,webp';
}

interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  error?: { message?: string };
}

@Injectable({ providedIn: 'root' })
export class SidroAdminService {
  private apiUrl = `${environment.apiBaseUrl}/api/admin/sidro`;

  constructor(private http: HttpClient) {}

  getAccounts(): Observable<any> {
    return this.http.get(`${this.apiUrl}/accounts`);
  }

  linkAccount(sidro_account_id: string, client_id: string, force = false): Observable<any> {
    return this.http.post(`${this.apiUrl}/link`, { sidro_account_id, client_id, force });
  }

  getRequests(): Observable<SidroRequest[]> {
    return this.http.get<SidroRequest[]>(`${this.apiUrl}/requests`);
  }

  acceptRequest(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/requests/${id}/accept`, {});
  }

  rejectRequest(id: number): Observable<any> {
    return this.http.post(`${this.apiUrl}/requests/${id}/reject`, {});
  }

  proposeAlternative(id: number, new_date: string, new_time: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/requests/${id}/propose`, { new_date, new_time });
  }

  getServiceConfig(id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/services/${id}`);
  }

  updateServiceConfig(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/services/${id}`, payload);
  }

  uploadServiceImage(id: string, file: File): Observable<SidroServiceImageReference> {
    return this.http.post<CloudinaryUploadSignature>(
      `${this.apiUrl}/services/${id}/image/signature`,
      {}
    ).pipe(
      switchMap((signed) => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('api_key', signed.api_key);
        formData.append('timestamp', String(signed.timestamp));
        formData.append('signature', signed.signature);
        formData.append('folder', signed.folder);
        formData.append('public_id', signed.public_id);
        formData.append('overwrite', signed.overwrite);
        formData.append('invalidate', signed.invalidate);
        formData.append('allowed_formats', signed.allowed_formats);

        return from(fetch(signed.upload_url, { method: 'POST', body: formData })).pipe(
          switchMap(async (response) => {
            const upload = await response.json() as CloudinaryUploadResult;
            if (!response.ok || !upload.secure_url || !upload.public_id) {
              throw new Error(upload.error?.message || 'Cloudinary no pudo cargar la imagen');
            }
            return upload;
          })
        );
      }),
      switchMap((upload) => this.http.put<SidroServiceImageReference>(
        `${this.apiUrl}/services/${id}/image`,
        { image_url: upload.secure_url, image_public_id: upload.public_id }
      ))
    );
  }

  removeServiceImage(id: string): Observable<SidroServiceImageReference> {
    return this.http.delete<SidroServiceImageReference>(`${this.apiUrl}/services/${id}/image`);
  }

  getEmployeeSchedule(employee_id: string): Observable<any> {
    return this.http.get(`${this.apiUrl}/employees/${employee_id}/schedule`);
  }

  setEmployeeSchedule(employee_id: string, payload: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/employees/${employee_id}/schedule`, payload);
  }
}
