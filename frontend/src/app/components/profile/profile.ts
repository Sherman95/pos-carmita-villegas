import { Component, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { SettingsService, BusinessSettings } from '../../services/settings.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule,MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent {
  user = signal<{ id: string; username: string; role: string } | null>(null);
  username = signal('');
  role = signal('');
  message = signal('');
  business = signal<BusinessSettings>({
    name: '',
    ruc: '',
    address: '',
    phone: '',
    taxRate: 0.15
  });
  taxRateInput = signal('0.15');

  constructor(private auth: AuthService, private router: Router, private settings: SettingsService) {
    effect(() => {
      const current = this.auth.currentUser();
      this.user.set(current);
      this.username.set(current?.username ?? '');
      this.role.set(current?.role ?? '');
    });

    effect(() => {
      const s = this.settings.settings();
      this.business.set(s);
      this.taxRateInput.set(s.taxRate.toString());
    });
  }

  save() {
    const current = this.user();
    const nextUsername = this.username().trim();
    if (!current || !nextUsername) {
      this.message.set('Completa el usuario');
      return;
    }
    // Solo persiste en localStorage para este cliente
    this.auth.setUserLocal({ ...current, username: nextUsername });
    this.message.set('Guardado localmente');
  }

  saveBusiness() {
    const current = this.business();
    const next: BusinessSettings = {
      name: current.name?.trim() || 'Carmita Villegas - Salón de Belleza',
      ruc: current.ruc?.trim() || '1799999999001',
      address: current.address?.trim() || 'Av. Siempre Viva 123',
      phone: current.phone?.trim() || '099 999 9999',
      taxRate: this.parseRate(this.taxRateInput())
    };
    this.settings.update(next);
    this.message.set('Datos del recibo guardados');
  }

  private parseRate(raw: string): number {
    const n = Number(raw);
    if (Number.isNaN(n) || n < 0) return 0;
    return n;
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
