import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatButtonModule, 
    MatIconModule
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent {
  username = '';
  password = '';
  loading = false;
  error = '';
  hidePassword = true;
  
  // Variable para controlar si la imagen del logo cargó bien
  logoLoaded = true;

  constructor(private auth: AuthService, private router: Router) {}

  // Función que se activa si la imagen da error (404, etc)
  onLogoError() {
    this.logoLoaded = false;
  }

  submit() {
    const username = this.username.trim();
    const password = this.password.trim();
    
    if (!username || !password) {
      this.error = 'Por favor ingresa usuario y contraseña';
      return;
    }
    
    this.loading = true;
    this.error = '';
    
    this.auth.login(username, password).subscribe({
      next: () => {
        // Redirigir al home
        this.router.navigateByUrl('/');
        this.loading = false;
      },
      error: (err) => {
        this.loading = false;
        // Mensaje de error más amigable
        this.error = err?.error?.error || 'Credenciales incorrectas. Verifica tus datos.';
      }
    });
  }
}