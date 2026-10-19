import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface WhatsappContactSetting {
  whatsapp: string | null;
  enabled: boolean;
  message: string;
  valid: boolean;
  active: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class WhatsappSettingsService {
  private settingsUrl = `${environment.apiBaseUrl}/api/settings/whatsapp-contact`;

  constructor(private http: HttpClient) {}

  getContactSetting(): Observable<WhatsappContactSetting> {
    return this.http.get<WhatsappContactSetting>(this.settingsUrl);
  }

  updateContactSetting(payload: {
    whatsapp: string;
    enabled: boolean;
    message: string;
  }): Observable<WhatsappContactSetting> {
    return this.http.put<WhatsappContactSetting>(this.settingsUrl, payload);
  }
}
