import { Component, OnInit, signal } from '@angular/core';
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
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent implements OnInit {
  user = signal<{ id: string; username: string; role: string; tax_rate?: number } | null>(null);
  username = signal('');
  role = signal('');
  message = signal('');
  
  // Datos del negocio (Visuales)
  business = signal<BusinessSettings>({
    name: '',
    ruc: '',
    address: '',
    phone: '',
    taxRate: 0 
  });
  
  // 🔥 CAMBIO 1: Lo inicializamos como número (para coincidir con el HTML type="number")
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
    // 1. Cargar Usuario (Desde la memoria del Auth)
    const currentUser = this.auth.currentUser();
    
    if (currentUser) {
      this.user.set(currentUser);
      this.username.set(currentUser.username);
      this.role.set(currentUser.role);

      // 🔥 CAMBIO 2: Si el usuario tiene IVA en la BD, lo ponemos en el input
      const taxFromDB = Number(currentUser.tax_rate || 0);
      this.taxRateInput.set(taxFromDB);
    }

    // 2. Cargar Datos del Negocio (SettingsService - Solo visuales como Nombre/RUC)
    const businessData = this.settings.settings();
    
    this.business.set({
      ...businessData,
      // Forzamos que el IVA del negocio sea el que dice el Usuario (BD), no el local
      taxRate: this.taxRateInput() 
    });
  }

  // Guardar Nombre de Usuario (En la Nube)
  save() {
    const nextUsername = this.username().trim();
    
    if (!nextUsername) {
      this.message.set('Completa el usuario');
      return;
    }

    this.message.set('Guardando nombre... ⏳');

    // Llamamos al Backend para guardar el nombre
    this.auth.updateProfile({ 
      username: nextUsername,
      tax_rate: this.taxRateInput() // Enviamos el IVA actual para que no se pierda
    }).subscribe({
      next: () => {
        this.message.set('Nombre actualizado en la nube ✅');
      },
      error: (err) => {
        console.error(err);
        this.message.set('Error al guardar nombre ❌');
      }
    });
  }

  // Guardar Datos del Negocio e IVA (En la Nube)
  saveBusiness() {
    const current = this.business();
    // Leemos el valor directo del signal numérico
    const nuevaTasa = this.taxRateInput(); 

    // 1. Guardamos configuración visual (Nombre tienda, RUC, etc.) en Local
    const nextSettings: BusinessSettings = {
      name: current.name?.trim() || 'Negocio',
      ruc: current.ruc?.trim() || '9999999999001',
      address: current.address?.trim() || 'Dirección',
      phone: current.phone?.trim() || '0999999999',
      taxRate: nuevaTasa
    };
    this.settings.update(nextSettings);
    
    // 2. 🔥 EL GRAN CAMBIO: Enviamos el IVA a la Base de Datos
    this.message.set('Sincronizando con la nube... ☁️');

    this.auth.updateProfile({ 
      tax_rate: nuevaTasa,
      username: this.username() // Mantenemos el nombre actual
    }).subscribe({
      next: (resp) => {
        // Al volver, el auth.service ya actualizó el currentUser automáticamente
        this.message.set('¡Guardado y Sincronizado! ✅');
      },
      error: (err) => {
        console.error('Error guardando en nube', err);
        this.message.set('Error de conexión ⚠️');
      }
    });
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}