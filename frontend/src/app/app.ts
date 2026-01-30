import { Component, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

// Componentes
import { CartFooterComponent } from './components/cart-footer/cart-footer';
import { NavigationComponent } from './components/navigation/navigation';
import { SidenavComponent } from './components/sidenav/sidenav'; // <--- IMPORTAMOS EL NUEVO

import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    NavigationComponent,
    CartFooterComponent,
    SidenavComponent, // <--- LO USAMOS
    MatSidenavModule
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  @ViewChild('sidenav') sidenav!: MatSidenav;
}