import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

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
    { path: '/history', label: 'Diario', icon: 'history' },
    { path: '/reports', label: 'Reportes', icon: 'insights' },
    { path: '/clients', label: 'Clientes', icon: 'people' },
  ];
}
