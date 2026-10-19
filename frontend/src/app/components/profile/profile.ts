import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
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

const ROLE_LABELS: Record<string, string> = {
  owner: 'Propietaria',
  admin: 'Administración',
  reception: 'Recepción / Caja',
  professional: 'Profesional'
};

@Component({
  selector: 'app-profile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  user = signal<{ id: string; username: string; role: string; tax_rate?: number; email?: string | null; email_verified_at?: string | null } | null>(null);
  roleLabel = signal('');
  businessMessage = signal('');
  businessMessageType = signal<'success' | 'error' | 'info'>('info');
  passwordMessage = signal('');
  passwordMessageType = signal<'success' | 'error' | 'info'>('info');
  savingBusiness = signal(false);
  savingPassword = signal(false);
  currentPassword = signal('');
  newPassword = signal('');
  passwordConfirmation = signal('');

  // Datos del negocio (Visuales)
  business = signal<BusinessSettings>({
    name: 'Carmita Villegas',
    ruc: '',
    address: 'Piñas, El Oro',
    phone: '',
    taxRate: 0
  });

  taxRateInput = signal<number>(0);

  constructor(
    private auth: AuthService,
    private router: Router,
    private settings: SettingsService
  ) {}

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    const currentUser: any = this.auth.currentUser();

    if (currentUser) {
      this.user.set(currentUser);
      this.roleLabel.set(ROLE_LABELS[currentUser.role] || 'Personal');

      const taxFromDB = Number(currentUser.tax_rate || 0);
      this.taxRateInput.set(taxFromDB);

      this.business.set({
        name: currentUser.business_name || 'Carmita Villegas',
        ruc: currentUser.business_ruc || '',
        address: currentUser.business_address || 'Piñas, El Oro',
        phone: currentUser.business_phone || '',
        taxRate: taxFromDB
      });
    }
  }

  canManageBusiness(): boolean {
    return this.auth.hasPermission('business_settings.manage');
  }

  mustChangePassword(): boolean {
    return Boolean(this.auth.currentUser()?.must_change_password);
  }

  emailVerified(): boolean {
    return Boolean(this.user()?.email && this.user()?.email_verified_at);
  }

  // Guardar Datos del Negocio e IVA (solo propietaria)
  saveBusiness() {
    const current = this.business();
    const nuevaTasa = this.taxRateInput();

    const nextSettings: BusinessSettings = {
      name: current.name?.trim() || 'Carmita Villegas',
      ruc: current.ruc?.trim() || '9999999999001',
      address: current.address?.trim() || 'Piñas, El Oro',
      phone: current.phone?.trim() || '0999999999',
      taxRate: nuevaTasa
    };
    this.settings.update(nextSettings);

    this.savingBusiness.set(true);
    this.businessMessageType.set('info');
    this.businessMessage.set('Sincronizando los datos del negocio...');

    const payload = {
      tax_rate: nuevaTasa,
      business_name: nextSettings.name,
      business_ruc: nextSettings.ruc,
      business_address: nextSettings.address,
      business_phone: nextSettings.phone
    };

    this.auth.updateProfile(payload).subscribe({
      next: () => {
        this.savingBusiness.set(false);
        this.businessMessageType.set('success');
        this.businessMessage.set('Datos guardados y sincronizados correctamente.');
      },
      error: () => {
        this.savingBusiness.set(false);
        this.businessMessageType.set('error');
        this.businessMessage.set('No se pudo sincronizar. Revisa tu conexión e intenta nuevamente.');
      }
    });
  }

  // Cambio de la propia contraseña (todos los roles)
  changePassword() {
    const current = this.currentPassword();
    const next = this.newPassword();
    const confirmation = this.passwordConfirmation();

    if (next.length < 10) {
      this.passwordMessageType.set('error');
      this.passwordMessage.set('La nueva contraseña debe tener al menos 10 caracteres.');
      return;
    }
    if (next !== confirmation) {
      this.passwordMessageType.set('error');
      this.passwordMessage.set('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    if (next === current) {
      this.passwordMessageType.set('error');
      this.passwordMessage.set('La nueva contraseña debe ser diferente a la actual.');
      return;
    }

    this.savingPassword.set(true);
    this.passwordMessageType.set('info');
    this.passwordMessage.set('Actualizando tu contraseña...');

    this.auth.changePassword({ current_password: current, new_password: next, confirmation }).subscribe({
      next: () => {
        this.savingPassword.set(false);
        this.currentPassword.set('');
        this.newPassword.set('');
        this.passwordConfirmation.set('');
        this.passwordMessageType.set('success');
        this.passwordMessage.set('Contraseña actualizada. Las demás sesiones fueron cerradas.');
      },
      error: (err) => {
        this.savingPassword.set(false);
        this.passwordMessageType.set('error');
        this.passwordMessage.set(err?.error?.error || 'No se pudo cambiar la contraseña.');
      }
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }

  businessInitials(): string {
    return (this.business().name || 'Carmita Villegas')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase();
  }

  profileCompletion(): number {
    const current = this.business();
    const completed = [
      current.name,
      current.ruc,
      current.address,
      current.phone
    ].filter(value => String(value || '').trim()).length;

    return Math.round((completed / 4) * 100);
  }
}
