import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { Router, RouterLink } from '@angular/router';
import { MobileNavComponent } from '../mobile-nav/mobile-nav.component';
import { VisualAssetsService } from '../../services/visual-assets.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, MobileNavComponent, ReactiveFormsModule],
  templateUrl: './profile.component.html',
  styleUrls: ['./profile.component.scss', './profile.luxury-extension.scss']
})
export class ProfileComponent implements OnInit {
  profile: any = null;
  isLoading = true;
  errorMessage = '';
  emailSuccessMessage = '';
  emailErrorMessage = '';
  isSavingEmail = false;
  whatsappMessage = '';
  whatsappError = '';
  passwordMessage = '';
  passwordError = '';
  isSavingWhatsapp = false;
  isSavingPassword = false;

  private authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  readonly visuals = inject(VisualAssetsService).assets;
  readonly recoveryEmailForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    current_password: ['', Validators.required]
  });
  readonly whatsappForm = this.fb.group({
    whatsapp: ['', [Validators.required, Validators.pattern('^(?:\\+?[0-9][0-9 .()-]{7,18})$')]],
    current_password: ['']
  });
  readonly passwordForm = this.fb.group({
    current_password: ['', Validators.required],
    new_password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(128)]],
    confirmation: ['', Validators.required]
  });

  get profileInitials(): string {
    const names = this.profile?.nombre_completo?.trim().split(/\s+/).filter(Boolean) || [];
    return names.slice(0, 2).map((name: string) => name[0]).join('').toUpperCase() || 'S';
  }

  ngOnInit() {
    this.authService.getProfile().subscribe({
      next: (data) => {
        this.profile = data;
        this.recoveryEmailForm.controls.email.setValue(data.email || '');
        this.whatsappForm.controls.whatsapp.setValue(data.telefono || '');
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage = 'No se pudo cargar la información.';
        this.isLoading = false;
      }
    });
  }

  saveRecoveryEmail(): void {
    if (this.recoveryEmailForm.invalid) {
      this.recoveryEmailForm.markAllAsTouched();
      return;
    }

    this.isSavingEmail = true;
    this.emailSuccessMessage = '';
    this.emailErrorMessage = '';
    const email = this.recoveryEmailForm.controls.email.value || '';
    const password = this.recoveryEmailForm.controls.current_password.value || '';
    this.authService.updateRecoveryEmail(email, password).subscribe({
      next: (response) => {
        this.isSavingEmail = false;
        this.profile = { ...this.profile, pending_email: response.pending_email };
        this.recoveryEmailForm.controls.current_password.reset();
        this.emailSuccessMessage = response.message;
      },
      error: (error) => {
        this.isSavingEmail = false;
        this.emailErrorMessage = error.error?.error || 'No se pudo guardar el correo.';
      }
    });
  }

  saveWhatsapp(): void {
    if (this.whatsappForm.invalid) { this.whatsappForm.markAllAsTouched(); return; }
    this.isSavingWhatsapp = true;
    this.whatsappMessage = '';
    this.whatsappError = '';
    this.authService.updateWhatsapp(this.whatsappForm.controls.whatsapp.value || '', this.whatsappForm.controls.current_password.value || '').subscribe({
      next: (response) => {
        this.isSavingWhatsapp = false;
        this.profile = { ...this.profile, telefono: response.whatsapp };
        this.whatsappForm.controls.whatsapp.setValue(response.whatsapp);
        this.whatsappForm.controls.current_password.reset();
        this.whatsappMessage = response.message;
      },
      error: (error) => { this.isSavingWhatsapp = false; this.whatsappError = error.error?.error || 'No se pudo actualizar el WhatsApp.'; }
    });
  }

  savePassword(): void {
    if (this.passwordForm.invalid) { this.passwordForm.markAllAsTouched(); return; }
    if (this.passwordForm.controls.new_password.value !== this.passwordForm.controls.confirmation.value) {
      this.passwordError = 'Las contraseñas nuevas no coinciden.';
      return;
    }
    this.isSavingPassword = true;
    this.passwordError = '';
    this.passwordMessage = '';
    this.authService.changePassword(this.passwordForm.controls.current_password.value || '', this.passwordForm.controls.new_password.value || '').subscribe({
      next: (response) => {
        this.isSavingPassword = false;
        this.passwordMessage = response.message;
        this.passwordForm.reset();
        this.authService.logout();
        setTimeout(() => this.router.navigate(['/login']), 1200);
      },
      error: (error) => { this.isSavingPassword = false; this.passwordError = error.error?.error || 'No se pudo cambiar la contraseña.'; }
    });
  }

  logout() {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
