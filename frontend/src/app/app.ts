import { Component, OnInit, ViewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';


// Componentes
import { CartFooterComponent } from './components/cart-footer/cart-footer';
import { NavigationComponent } from './components/navigation/navigation';
import { SidenavComponent } from './components/sidenav/sidenav'; // <--- IMPORTAMOS EL NUEVO

import { MatSidenavModule, MatSidenav } from '@angular/material/sidenav';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    NavigationComponent,
    CartFooterComponent,
    SidenavComponent,
    MatSidenavModule
],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  @ViewChild('sidenav') sidenav!: MatSidenav;

  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    if (this.authService.getToken()) {
      this.authService.refreshCurrentUser().subscribe({
        error: () => {
          // El interceptor gestiona sesiones vencidas; ante un fallo de red
          // conservamos temporalmente la sesión local existente.
        }
      });
    }
  }

  get isAuthenticated(): boolean {
    return this.authService.currentUser() !== null;
  }
}
