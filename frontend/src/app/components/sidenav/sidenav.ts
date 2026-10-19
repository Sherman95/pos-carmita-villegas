import { Component, EventEmitter, Output , ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

import { RouterModule } from '@angular/router';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { NotificationsBellComponent } from '../notifications-bell/notifications-bell';

@Component({
  selector: 'app-sidenav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    RouterModule,
    MatListModule,
    MatIconModule,
    MatDividerModule,
    NotificationsBellComponent
],
  templateUrl: './sidenav.html',
  styleUrls: ['./sidenav.scss']
})
export class SidenavComponent {

  // Evento para avisar al padre que cierre el menú
  @Output() closeMenu = new EventEmitter<void>();

  constructor(private auth: AuthService, private router: Router) {}

  get user() {
    const current = this.auth.currentUser();
    const labels: Record<string, string> = {
      owner: 'Propietaria', admin: 'Administración', reception: 'Recepción / Caja', professional: 'Profesional'
    };
    return {
      name: current?.username || 'Cuenta POS',
      email: current?.email || 'Personal autorizado',
      role: labels[current?.role || ''] || 'Personal',
      initial: (current?.username || 'P').charAt(0).toUpperCase()
    };
  }

  // Función auxiliar para emitir el cierre
  onClose() {
    this.closeMenu.emit();
  }

  get isAdmin(): boolean {
    return this.auth.isAdmin();
  }

  can(permission: string): boolean { return this.auth.hasPermission(permission); }

  logout() {
    console.log('Cerrando sesión...');
    this.auth.logout();
    this.onClose();
    this.router.navigate(['/login']);
  }
}
