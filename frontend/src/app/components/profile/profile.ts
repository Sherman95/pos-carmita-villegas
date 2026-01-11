import { Component, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, FormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss'
})
export class ProfileComponent {
  user = signal<{ id: string; username: string; role: string } | null>(null);
  username = signal('');
  role = signal('');
  message = signal('');

  constructor(private auth: AuthService, private router: Router) {
    effect(() => {
      const current = this.auth.currentUser();
      this.user.set(current);
      this.username.set(current?.username ?? '');
      this.role.set(current?.role ?? '');
    });
  }

  save() {
    const current = this.user();
    const nextUsername = this.username().trim();
    if (!current || !nextUsername) {
      this.message.set('Completa el usuario');
      return;
    }
    // Solo persiste en localStorage para este cliente
    this.auth.setUserLocal({ ...current, username: nextUsername });
    this.message.set('Guardado localmente');
  }

  logout() {
    this.auth.logout();
    this.router.navigateByUrl('/login');
  }
}
