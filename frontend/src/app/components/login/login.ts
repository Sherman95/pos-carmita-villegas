import { Component, ChangeDetectorRef, ChangeDetectionStrategy, OnDestroy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { safeReturnUrl } from '../../utils/safe-return-url';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule
],
  templateUrl: './login.html',
  styleUrl: './login.scss'
})
export class LoginComponent implements OnDestroy {
  username = '';
  password = '';
  loading = false;
  error = '';
  hidePassword = true;
  loginSuccess = false;
  welcomeName = '';
  private navigationTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Variable para controlar si la imagen del logo cargó bien
  logoLoaded = true;

  constructor(private auth: AuthService, private router: Router, private route: ActivatedRoute, private cdr: ChangeDetectorRef) {}

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
      next: ({ user }) => {
        const returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'), '/');
        this.welcomeName = this.formatWelcomeName(user?.username || username);
        this.loginSuccess = true;
        this.cdr.detectChanges();
        this.navigationTimer = setTimeout(() => {
          this.navigateAfterWelcome(user.must_change_password ? '/profile' : returnUrl);
        }, 1450);
      },
      error: (err) => {
        this.loading = false;
        // Mensaje de error más amigable
        this.error = err?.error?.error || 'Credenciales incorrectas. Verifica tus datos.';
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.navigationTimer) clearTimeout(this.navigationTimer);
  }

  private formatWelcomeName(value: string): string {
    const cleaned = String(value || '').trim().replace(/[._-]+/g, ' ');
    if (!cleaned) return 'Carmita';
    return cleaned
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private navigateAfterWelcome(url: string): void {
    void this.router.navigateByUrl(url);
  }
}
