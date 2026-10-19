import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../services/auth.service';
import {
  AuditEntry,
  ManagedEmployee,
  ManagedPosUser,
  PosUserRole,
  UserManagementService
} from '../../services/user-management.service';

const ROLE_LABELS: Record<PosUserRole, string> = {
  owner: 'Propietaria',
  admin: 'Administrador',
  reception: 'Recepción / Caja',
  professional: 'Profesional'
};

const AUDIT_LABELS: Record<string, string> = {
  USER_CREATED: 'Cuenta creada',
  USER_UPDATED: 'Cuenta editada',
  USER_ACCESS_UPDATED: 'Rol o acceso actualizado',
  USER_SESSIONS_REVOKED: 'Sesiones revocadas',
  USER_PASSWORD_RESET_LINK_SENT: 'Enlace de restablecimiento enviado',
  USER_TEMPORARY_PASSWORD_ISSUED: 'Contraseña temporal emitida',
  USER_PASSWORD_RESET_COMPLETED: 'Restablecimiento completado',
  OWN_PASSWORD_CHANGED: 'Cambio de contraseña propia',
  USER_EMPLOYEE_LINK_UPDATED: 'Vinculación profesional actualizada',
  OWNER_BOOTSTRAP_LOCAL: 'Bootstrap local de propietario'
};

interface UserDraft {
  username: string;
  email: string;
  role: PosUserRole;
  employee_id: string;
  active: boolean;
}

interface OneTimeCredential {
  title: string;
  username: string;
  password: string;
}

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
  employees: ManagedEmployee[] = [];
  drafts: Record<string, UserDraft> = {};
  savingIds = new Set<string>();
  busyIds = new Set<string>();

  tab: 'accounts' | 'audit' = 'accounts';
  query = '';
  roleFilter = 'all';
  statusFilter = 'all';
  loading = true;
  loadError = '';
  actionMessage = '';
  actionError = '';

  showCreate = false;
  createSaving = false;
  createForm: { username: string; email: string; role: PosUserRole | ''; employee_id: string } = {
    username: '',
    email: '',
    role: '',
    employee_id: ''
  };
  oneTimeCredential: OneTimeCredential | null = null;
  copied = false;

  auditEntries: AuditEntry[] = [];
  auditLoading = false;
  auditError = '';

  constructor(
    private userManagement: UserManagementService,
    private auth: AuthService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadUsers();
    this.loadEmployees();
  }

  get currentUser(): ManagedPosUser | null {
    const id = this.auth.currentUser()?.id;
    return this.users.find((user) => user.id === id) || null;
  }

  get actorRole(): PosUserRole | null {
    const role = this.auth.currentUser()?.role;
    return role === 'owner' || role === 'admin' || role === 'reception' || role === 'professional' ? role : null;
  }

  get filteredUsers(): ManagedPosUser[] {
    const term = this.query.trim().toLocaleLowerCase('es');
    return this.users.filter((user) => {
      const matchesTerm = !term
        || user.username.toLocaleLowerCase('es').includes(term)
        || (user.employee_name || '').toLocaleLowerCase('es').includes(term)
        || (user.email || '').toLocaleLowerCase('es').includes(term);
      const matchesRole = this.roleFilter === 'all' || user.role === this.roleFilter;
      const matchesStatus = this.statusFilter === 'all'
        || (this.statusFilter === 'active' ? user.active : !user.active);
      return matchesTerm && matchesRole && matchesStatus;
    });
  }

  get activeUsers(): number {
    return this.users.filter((user) => user.active).length;
  }

  get ownerOrAdminUsers(): number {
    return this.users.filter((user) => user.active && (user.role === 'owner' || user.role === 'admin')).length;
  }

  get availableRoles(): PosUserRole[] {
    const roles = new Set(this.users.map((user) => user.role));
    return (['owner', 'admin', 'reception', 'professional'] as PosUserRole[]).filter((role) => roles.has(role));
  }

  assignableRoles(): PosUserRole[] {
    if (this.actorRole === 'owner') return ['owner', 'admin', 'reception', 'professional'];
    if (this.actorRole === 'admin') return ['reception', 'professional'];
    return [];
  }

  roleLabel(role: PosUserRole | string): string {
    return ROLE_LABELS[role as PosUserRole] || role;
  }

  statusLabel(active: boolean): string {
    return active ? 'Activa' : 'Inactiva';
  }

  canManage(user: ManagedPosUser): boolean {
    if (user.id === this.auth.currentUser()?.id) return false;
    if (this.actorRole === 'owner') return true;
    if (this.actorRole === 'admin') return user.role === 'reception' || user.role === 'professional';
    return false;
  }

  isCurrentUser(user: ManagedPosUser): boolean {
    return this.auth.currentUser()?.id === user.id;
  }

  isOwner(user: ManagedPosUser): boolean {
    return user.role === 'owner';
  }

  isSaving(user: ManagedPosUser): boolean {
    return this.savingIds.has(user.id);
  }

  isBusy(user: ManagedPosUser): boolean {
    return this.busyIds.has(user.id) || this.isSaving(user);
  }

  loadUsers(): void {
    this.loading = true;
    this.loadError = '';
    this.userManagement.getUsers().subscribe({
      next: (users) => {
        this.users = users;
        this.drafts = Object.fromEntries(users.map((user) => [user.id, this.draftFrom(user)]));
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

  loadEmployees(): void {
    this.userManagement.getEmployees().subscribe({
      next: (employees) => {
        this.employees = employees;
        this.cdr.markForCheck();
      },
      error: () => undefined
    });
  }

  draftFrom(user: ManagedPosUser): UserDraft {
    return {
      username: user.username,
      email: user.email || '',
      role: user.role,
      employee_id: user.employee_id === null || user.employee_id === undefined ? '' : String(user.employee_id),
      active: user.active
    };
  }

  draftFor(user: ManagedPosUser): UserDraft {
    return this.drafts[user.id] || this.draftFrom(user);
  }

  updateDraft(user: ManagedPosUser, change: Partial<UserDraft>): void {
    this.drafts = { ...this.drafts, [user.id]: { ...this.draftFor(user), ...change } };
  }

  hasChanges(user: ManagedPosUser): boolean {
    const draft = this.draftFor(user);
    const original = this.draftFrom(user);
    return draft.username !== original.username
      || draft.email !== original.email
      || draft.role !== original.role
      || draft.employee_id !== original.employee_id
      || draft.active !== original.active;
  }

  reset(user: ManagedPosUser): void {
    this.drafts = { ...this.drafts, [user.id]: this.draftFrom(user) };
  }

  employeeOptionsFor(user: ManagedPosUser): ManagedEmployee[] {
    const current = this.draftFor(user).employee_id;
    const options = [...this.employees];
    if (current && !options.some((employee) => String(employee.id) === current) && user.employee_name) {
      options.unshift({ id: current, nombre: `${user.employee_name} (inactivo)`, active: false });
    }
    return options;
  }

  canResetByEmail(user: ManagedPosUser): boolean {
    return Boolean(user.email && user.email_verified_at);
  }

  save(user: ManagedPosUser): void {
    if (!this.canManage(user) || !this.hasChanges(user) || this.isSaving(user)) return;
    const draft = this.draftFor(user);
    this.clearMessages();
    this.savingIds.add(user.id);
    this.userManagement.updateUser(user.id, {
      username: draft.username.trim(),
      email: draft.email.trim() ? draft.email.trim() : null,
      role: draft.role,
      employee_id: draft.employee_id ? draft.employee_id : null,
      active: draft.active
    }).subscribe({
      next: ({ user: updated }) => {
        this.savingIds.delete(user.id);
        this.replaceUser(updated);
        this.actionMessage = `Cuenta de ${updated.username} actualizada.`;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.savingIds.delete(user.id);
        this.actionError = error.error?.error || 'No se pudo actualizar la cuenta.';
        this.reset(user);
        this.cdr.markForCheck();
      }
    });
  }

  createUser(): void {
    if (this.createSaving) return;
    const username = this.createForm.username.trim();
    if (!username) {
      this.actionError = 'Escribe un nombre de usuario para la nueva cuenta.';
      return;
    }
    if (!this.createForm.role) {
      this.actionError = 'Selecciona el rol de la nueva cuenta.';
      return;
    }
    if (this.createForm.role === 'professional' && !this.createForm.employee_id) {
      this.actionError = 'Una cuenta profesional debe vincularse a un empleado.';
      return;
    }
    this.clearMessages();
    this.createSaving = true;
    this.userManagement.createUser({
      username,
      email: this.createForm.email.trim() ? this.createForm.email.trim() : null,
      role: this.createForm.role,
      employee_id: this.createForm.employee_id ? this.createForm.employee_id : null
    }).subscribe({
      next: ({ message, user, temporary_password }) => {
        this.createSaving = false;
        this.showCreate = false;
        this.createForm = { username: '', email: '', role: '', employee_id: '' };
        const isProfessional = user.role === 'professional';
        this.oneTimeCredential = {
          title: `${message}${isProfessional ? ' La cuenta debe iniciar sesión en el POS.' : ''}`,
          username: user.username,
          password: temporary_password
        };
        this.copied = false;
        this.actionMessage = message;
        this.loadUsers();
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.createSaving = false;
        this.actionError = error.error?.error || 'No se pudo crear la cuenta.';
        this.cdr.markForCheck();
      }
    });
  }

  resetPassword(user: ManagedPosUser, mode: 'temporary' | 'email'): void {
    if (!this.canManage(user) || this.isBusy(user)) return;
    this.clearMessages();
    this.busyIds.add(user.id);
    this.userManagement.resetPassword(user.id, mode).subscribe({
      next: ({ message, temporary_password }) => {
        this.busyIds.delete(user.id);
        if (temporary_password) {
          this.oneTimeCredential = { title: message, username: user.username, password: temporary_password };
          this.copied = false;
        }
        this.actionMessage = message;
        this.loadUsers();
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.busyIds.delete(user.id);
        this.actionError = error.error?.error || 'No se pudo restablecer el acceso.';
        this.cdr.markForCheck();
      }
    });
  }

  revokeSessions(user: ManagedPosUser): void {
    if (!this.canManage(user) || this.isBusy(user)) return;
    this.clearMessages();
    this.busyIds.add(user.id);
    this.userManagement.revokeSessions(user.id).subscribe({
      next: ({ message }) => {
        this.busyIds.delete(user.id);
        this.actionMessage = `${message}. ${user.username} deberá iniciar sesión nuevamente.`;
        this.cdr.markForCheck();
      },
      error: (error: HttpErrorResponse) => {
        this.busyIds.delete(user.id);
        this.actionError = error.error?.error || 'No se pudieron revocar las sesiones.';
        this.cdr.markForCheck();
      }
    });
  }

  copyCredential(): void {
    const credential = this.oneTimeCredential;
    if (!credential) return;
    const text = `Usuario: ${credential.username}\nContraseña temporal: ${credential.password}`;
    navigator.clipboard?.writeText(text).then(() => {
      this.copied = true;
      this.cdr.markForCheck();
    }).catch(() => undefined);
  }

  dismissCredential(): void {
    this.oneTimeCredential = null;
    this.copied = false;
  }

  selectTab(tab: 'accounts' | 'audit'): void {
    this.tab = tab;
    if (tab === 'audit') this.loadAudit();
    this.cdr.markForCheck();
  }

  loadAudit(): void {
    this.auditLoading = true;
    this.auditError = '';
    this.userManagement.getAudit().subscribe({
      next: (entries) => {
        this.auditEntries = entries;
        this.auditLoading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.auditLoading = false;
        this.auditError = 'No pudimos cargar el historial administrativo.';
        this.cdr.markForCheck();
      }
    });
  }

  auditLabel(action: string): string {
    return AUDIT_LABELS[action] || action;
  }

  auditDetail(entry: AuditEntry): string {
    const metadata = entry.metadata || {};
    const parts: string[] = [];
    if (metadata['previous_role'] || metadata['next_role']) {
      parts.push(`${this.roleLabel(String(metadata['previous_role'] || '—'))} → ${this.roleLabel(String(metadata['next_role'] || '—'))}`);
    }
    if (metadata['role_from'] || metadata['role_to']) {
      parts.push(`${this.roleLabel(String(metadata['role_from'] || '—'))} → ${this.roleLabel(String(metadata['role_to'] || '—'))}`);
    }
    if (metadata['active_from'] !== undefined && metadata['active_to'] !== undefined) {
      parts.push(`acceso: ${metadata['active_to'] ? 'permitido' : 'bloqueado'}`);
    }
    if (metadata['has_email'] !== undefined) {
      parts.push(metadata['has_email'] ? 'con correo' : 'sin correo');
    }
    if (metadata['email_changed']) parts.push('correo actualizado');
    return parts.join(' · ');
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

  private replaceUser(updated: ManagedPosUser): void {
    this.users = this.users.map((item) => item.id === updated.id ? updated : item);
    this.drafts = { ...this.drafts, [updated.id]: this.draftFrom(updated) };
  }

  private clearMessages(): void {
    this.actionError = '';
    this.actionMessage = '';
  }
}
