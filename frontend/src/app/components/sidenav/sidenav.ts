import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule, // Importante para que routerLink funcione
    MatListModule,
    MatIconModule,
    MatDividerModule
  ],
  templateUrl: './sidenav.html',
  styleUrls: ['./sidenav.scss']
})
export class SidenavComponent {
  
  // Evento para avisar al padre que cierre el menú
  @Output() closeMenu = new EventEmitter<void>();

  // Datos del usuario (Idealmente vendrían de un AuthService)
  user = {
    name: 'Carmita Villegas',
    email: 'admin@poscarmita.com',
    role: 'Administrador',
    initial: 'C'
  };

  // Función auxiliar para emitir el cierre
  onClose() {
    this.closeMenu.emit();
  }

  logout() {
    console.log('Cerrando sesión...');
    // Aquí tu lógica de auth.logout()
    this.onClose();
  }
}