import { Injectable, signal } from '@angular/core';

export interface BusinessSettings {
  name: string;
  ruc: string;
  address: string;
  phone: string;
  taxRate: number; 
}

// 🔥 CAMBIO 1: Cambiamos 'v1' a 'v2' para obligar a borrar la memoria vieja en todos los navegadores
const STORAGE_KEY = 'business_settings_v2';

const DEFAULT_SETTINGS: BusinessSettings = {
  name: 'Carmita Villegas - Salón de Belleza',
  ruc: '1799999999001',
  address: 'Av. Siempre Viva 123',
  phone: '099 999 9999',
  // 🔥 CAMBIO 2: ¡MUERE, 15%! Ponemos 0 por defecto.
  taxRate: 0 
};

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private settingsSig = signal<BusinessSettings>(this.readStored());

  get settings() {
    return this.settingsSig.asReadonly();
  }

  update(next: Partial<BusinessSettings>) {
    const merged: BusinessSettings = { ...this.settingsSig(), ...next };
    this.settingsSig.set(merged);
    this.persist(merged);
  }

  private readStored(): BusinessSettings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_SETTINGS;
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        // Validación extra: si viene basura, usa el default (que ahora es 0)
        taxRate: typeof parsed?.taxRate === 'number' ? parsed.taxRate : DEFAULT_SETTINGS.taxRate
      } as BusinessSettings;
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  private persist(data: BusinessSettings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('No se pudo guardar settings', err);
    }
  }
}