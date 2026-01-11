import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navigation',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule],
  templateUrl: './navigation.html',
  styleUrl: './navigation.scss'
})
export class NavigationComponent {
  navItems = [
    { path: '/', label: 'Inicio', icon: 'home' },
    { path: '/catalog', label: 'Catálogo', icon: 'storefront' },
    { path: '/reports', label: 'Reportes', icon: 'insights' },
    { path: '/clients', label: 'Clientes', icon: 'people' },
    { path: '/profile', label: 'Perfil', icon: 'account_circle' },
  ];

  constructor(private auth: AuthService, private router: Router) {}

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
