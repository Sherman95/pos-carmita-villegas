import { Component, ViewChild, signal } from '@angular/core';
import { RouterOutlet, RouterModule } from '@angular/router';
import { CommonModule } from '@angular/common';

// COMPONENTES HIJOS
import { CartFooterComponent } from './components/cart-footer/cart-footer';
import { NavigationComponent } from './components/navigation/navigation';

// MÓDULOS DE MATERIAL (Indispensables)
import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterModule,
    NavigationComponent,
    CartFooterComponent,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatDividerModule,
    MatButtonModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  // Referencia para controlar el menú
  @ViewChild('sidenav') sidenav!: MatSidenav;

  // Datos simulados (luego vendrán de tu AuthService)
  user = {
    name: 'Carmita Villegas',
    email: 'admin@poscarmita.com',
    role: 'Administrador',
    initial: 'C'
  };

  logout() {
    // Aquí pondrás tu lógica de auth.logout()
    console.log('Cerrando sesión...');
    this.sidenav.close();
  }
}