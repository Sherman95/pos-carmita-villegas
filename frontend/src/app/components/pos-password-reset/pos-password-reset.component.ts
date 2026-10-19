import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-pos-password-reset',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, MatButtonModule, MatIconModule],
  template: `
    <main class="reset-page">
      <section class="reset-card">
        <span class="eyebrow">Seguridad del POS</span>
        <h1>Crea una nueva contraseña</h1>
        <p>El enlace solo puede utilizarse una vez y vence en pocos minutos.</p>
        <form (ngSubmit)="submit()">
          <label>Nueva contraseña<input type="password" [(ngModel)]="password" name="password" minlength="10" required autocomplete="new-password"></label>
          <label>Confirmar contraseña<input type="password" [(ngModel)]="confirmation" name="confirmation" minlength="10" required autocomplete="new-password"></label>
          <button mat-flat-button type="submit" [disabled]="saving"><mat-icon>lock_reset</mat-icon>{{ saving ? 'Guardando...' : 'Guardar contraseña' }}</button>
        </form>
        @if (message) { <p class="feedback" [class.error]="error">{{ message }}</p> }
        <a routerLink="/login">Volver al inicio de sesión</a>
      </section>
    </main>`,
  styles: [`
    :host{display:block;min-height:100vh;background:#f7f0ed}.reset-page{min-height:100vh;display:grid;place-items:center;padding:24px}.reset-card{width:min(460px,100%);background:#fff;padding:38px;border-radius:24px;box-shadow:0 24px 70px rgba(75,30,58,.16)}.eyebrow{color:#8b3152;font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.12em}h1{font-family:Georgia,serif;color:#4b1e3a;font-size:2.2rem;margin:10px 0}p{color:#735e67;line-height:1.55}form{display:grid;gap:16px;margin:26px 0}label{display:grid;gap:7px;font-weight:700;color:#4b1e3a}input{min-height:48px;border:1px solid #dfcfd5;border-radius:12px;padding:0 14px;font:inherit}button{min-height:48px}.feedback{padding:12px;border-radius:10px;background:#e8f6ee;color:#17663b}.feedback.error{background:#fdebec;color:#9b2335}a{color:#7a1839;font-weight:700}`]
})
export class PosPasswordResetComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);

  token = this.route.snapshot.queryParamMap.get('token') || '';
  password = '';
  confirmation = '';
  saving = false;
  message = '';
  error = false;

  submit() {
    if (!this.token || this.password.length < 10 || this.password !== this.confirmation) {
      this.error = true; this.message = 'Revisa el enlace y confirma una contraseña de al menos 10 caracteres.'; return;
    }
    this.saving = true;
    this.auth.completePasswordReset({ token: this.token, new_password: this.password, confirmation: this.confirmation }).subscribe({
      next: ({ message }) => { this.saving = false; this.error = false; this.message = message; setTimeout(() => this.router.navigateByUrl('/login'), 1200); },
      error: (response) => { this.saving = false; this.error = true; this.message = response.error?.error || 'No se pudo restablecer la contraseña.'; }
    });
  }
}
