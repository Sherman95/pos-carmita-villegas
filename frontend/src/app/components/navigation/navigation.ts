import { Component, Output, EventEmitter } from '@angular/core'; // 👈 1. Importamos Output
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatRippleModule } from '@angular/material/core';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule, MatRippleModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss'
})
export class NavigationComponent {
  
  // 📢 2. Creamos el "Timbre" para avisar al App.component
  @Output() toggleMenu = new EventEmitter<void>();

  navItems = [
    { path: '/', label: 'Inicio', icon: 'home' },
    { path: '/catalog', label: 'Catálogo', icon: 'storefront' },
    { path: '/reports', label: 'Reportes', icon: 'insights' }, // Opcional, si tienes poco espacio
    { path: '/clients', label: 'Clientes', icon: 'people' },
    
    // 👇 3. AQUÍ ESTÁ EL CAMBIO: Quitamos Perfil y ponemos Menú (sin path)
    { path: null, label: 'Menú', icon: 'menu', isAction: true }, 
  ];

  constructor(private auth: AuthService) {}

  // Función que decide qué hacer cuando tocan un botón
  handleItemClick(item: any) {
    if (item.isAction) {
      // Si es el botón de menú, tocamos el timbre
      this.toggleMenu.emit();
    }
    // Si tiene path, el routerLink del HTML se encarga solo
  }
}