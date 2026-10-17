import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import {
  ManagedPosUser,
  PosUserRole,
  UpdateUserAccessPayload,
  UserManagementService
} from '../../services/user-management.service';

@Component({
  selector: 'app-user-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  templateUrl: './user-management.html',
  styleUrls: ['./user-management.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UserManagementComponent implements OnInit {
  users: ManagedPosUser[] = [];
  drafts: Record<string, UpdateUserAccessPayload> = {};
  savingIds = new Set<string>();
  query = '';
  loading = true;
  loadError = '';
  actionMessage = '';
  actionError = '';

  constructor(
    private userManagement: UserManagementService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  get filteredUsers(): ManagedPosUser[] {
    const term = this.query.trim().toLocaleLowerCase('es');
    if (!term) return this.users;

    return this.users.filter((user) =>
      user.username.toLocaleLowerCase('es').includes(term) ||
      (user.employee_name || '').toLocaleLowerCase('es').includes(term)
    );
  }

  get activeUsers(): number {
    return this.users.filter((user) => user.active).length;
  }

  get adminUsers(): number {
    return this.users.filter((user) => user.active && user.role === 'admin').length;
  }

  loadUsers(): void {
    this.loading = true;
    this.loadError = '';

    this.userManagement.getUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.drafts = Object.fromEntries(
          users.map((user) => [user.id, { role: user.role, active: user.active }])
        );
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.loadError = 'No pudimos cargar las cuentas del POS.';
        this.cdr.markForCheck();
      }
    });
  }

  draftFor(user: ManagedPosUser): UpdateUserAccessPayload {
    return this.drafts[user.id] || { role: user.role, active: user.active };
  }

  setRole(user: ManagedPosUser, role: PosUserRole): void {
    this.drafts = {
      ...this.drafts,
      [user.id]: { ...this.draftFor(user), role }
    };
  }

  setActive(user: ManagedPosUser, value: string): void {
    this.drafts = {
      ...this.drafts,
      [user.id]: { ...this.draftFor(user), active: value === 'active' }
    };
  }

  hasChanges(user: ManagedPosUser): boolean {
    const draft = this.draftFor(user);
    return draft.role !== user.role || draft.active !== user.active;
  }

  isPrimaryAdmin(user: ManagedPosUser): boolean {
    return user.username.trim() === 'admin';
  }

  isCurrentUser(user: ManagedPosUser): boolean {
    return this.auth.currentUser()?.id === user.id;
  }

  isProtected(user: ManagedPosUser): boolean {
    return this.isPrimaryAdmin(user) || this.isCurrentUser(user);
  }

  isSaving(user: ManagedPosUser): boolean {
    return this.savingIds.has(user.id);
  }

  reset(user: ManagedPosUser): void {
    this.drafts = {
      ...this.drafts,
      [user.id]: { role: user.role, active: user.active }
    };
  }

  save(user: ManagedPosUser): void {
    if (!this.hasChanges(user) || this.isProtected(user) || this.isSaving(user)) return;

    this.actionError = '';
    this.actionMessage = '';
    this.savingIds.add(user.id);

    this.userManagement.updateAccess(user.id, this.draftFor(user)).subscribe({
      next: ({ user: updated }) => {
        this.users = this.users.map((item) => item.id === updated.id ? updated : item);
        this.drafts = {
          ...this.drafts,
          [updated.id]: { role: updated.role, active: updated.active }
        };
        this.savingIds.delete(user.id);
        this.actionMessage = `Permisos de ${updated.username} actualizados. La cuenta debe volver a iniciar sesión para refrescar su menú.`;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.savingIds.delete(user.id);
        this.actionError = error.error?.error || 'No se pudieron guardar los permisos.';
        this.reset(user);
        this.cdr.markForCheck();
      }
    });
  }

  initials(user: ManagedPosUser): string {
    return (user.employee_name || user.username)
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('')
      .toUpperCase() || 'US';
  }
}
