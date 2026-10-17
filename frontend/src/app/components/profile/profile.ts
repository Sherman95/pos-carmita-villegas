import { Component, OnInit, signal , ChangeDetectionStrategy } from '@angular/core';
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  user = signal<{ id: string; username: string; role: string; tax_rate?: number } | null>(null);
  username = signal('');
  role = signal('');
  businessMessage = signal('');
  businessMessageType = signal<'success' | 'error' | 'info'>('info');
  accountMessage = signal('');
  accountMessageType = signal<'success' | 'error' | 'info'>('info');
  savingBusiness = signal(false);
  savingAccount = signal(false);

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
    // 1. Cargar Usuario (Desde la memoria del Auth - Base de Datos)
    const currentUser: any = this.auth.currentUser(); // Tipado any para acceder a campos nuevos

    if (currentUser) {
      this.user.set(currentUser);
      this.username.set(currentUser.username);
      this.role.set(currentUser.role);

      // Cargamos el IVA de la BD
      const taxFromDB = Number(currentUser.tax_rate || 0);
      this.taxRateInput.set(taxFromDB);

      // 🔥 CAMBIO CRÍTICO:
      // Si la BD trae datos del negocio, úsalos. Si no, usa valores vacíos.
      // Ya no dependemos solo del localStorage.
      this.business.set({
        name: currentUser.business_name || 'Carmita Villegas',
        ruc: currentUser.business_ruc || '',
        address: currentUser.business_address || 'Piñas, El Oro',
        phone: currentUser.business_phone || '',
        taxRate: taxFromDB
      });
    }
  }

  // Guardar Nombre de Usuario
  save() {
    const nextUsername = this.username().trim();

    if (!nextUsername) {
      this.accountMessageType.set('error');
      this.accountMessage.set('Completa el nombre de usuario.');
      return;
    }

    this.savingAccount.set(true);
    this.accountMessageType.set('info');
    this.accountMessage.set('Guardando nombre de usuario...');

    this.auth.updateProfile({
      username: nextUsername,
      tax_rate: this.taxRateInput()
    }).subscribe({
      next: () => {
        this.savingAccount.set(false);
        this.accountMessageType.set('success');
        this.accountMessage.set('Nombre de usuario actualizado correctamente.');
      },
      error: (err) => {
        console.error(err);
        this.savingAccount.set(false);
        this.accountMessageType.set('error');
        this.accountMessage.set('No se pudo guardar el nombre. Intenta nuevamente.');
      }
    });
  }

  // Guardar Datos del Negocio e IVA
  saveBusiness() {
    const current = this.business();
    const nuevaTasa = this.taxRateInput();

    // 1. Guardamos configuración visual en Local (SettingsService)
    const nextSettings: BusinessSettings = {
      name: current.name?.trim() || 'Carmita Villegas',
      ruc: current.ruc?.trim() || '9999999999001',
      address: current.address?.trim() || 'Piñas, El Oro',
      phone: current.phone?.trim() || '0999999999',
      taxRate: nuevaTasa
    };
    this.settings.update(nextSettings);

    // 2. 🔥 EL GRAN FIX: Enviamos TODO a la Base de Datos
    this.savingBusiness.set(true);
    this.businessMessageType.set('info');
    this.businessMessage.set('Sincronizando los datos del negocio...');

    // Mapeamos los nombres del formulario (name, ruc) a los de la BD (business_name, business_ruc)
    const payload = {
      tax_rate: nuevaTasa,
      username: this.username(),
      business_name: nextSettings.name,
      business_ruc: nextSettings.ruc,
      business_address: nextSettings.address,
      business_phone: nextSettings.phone
    };

    this.auth.updateProfile(payload).subscribe({
      next: (resp) => {
        console.log('✅ Respuesta del servidor:', resp);
        this.savingBusiness.set(false);
        this.businessMessageType.set('success');
        this.businessMessage.set('Datos guardados y sincronizados correctamente.');
      },
      error: (err) => {
        console.error('Error guardando en nube', err);
        this.savingBusiness.set(false);
        this.businessMessageType.set('error');
        this.businessMessage.set('No se pudo sincronizar. Revisa tu conexión e intenta nuevamente.');
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
      current.phone,
      this.username()
    ].filter(value => String(value || '').trim()).length;

    return Math.round((completed / 5) * 100);
  }
}
