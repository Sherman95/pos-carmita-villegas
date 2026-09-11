import { Component, EventEmitter, Output } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
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

  constructor(private auth: AuthService, private router: Router) {}

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
    this.auth.logout();
    this.onClose();
    this.router.navigate(['/login']);
  }
}