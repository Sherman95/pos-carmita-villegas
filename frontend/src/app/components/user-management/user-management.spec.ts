import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { ManagedPosUser, UserManagementService } from '../../services/user-management.service';
import { UserManagementComponent } from './user-management';

const makeUser = (overrides: Partial<ManagedPosUser>): ManagedPosUser => ({
  id: 'u-1',
  username: 'usuario',
  role: 'reception',
  active: true,
  employee_id: null,
  employee_name: null,
  email: null,
  email_verified_at: null,
  must_change_password: false,
  last_login_at: null,
  password_changed_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...overrides
});

const users: ManagedPosUser[] = [
  makeUser({ id: 'owner-1', username: 'propietaria', role: 'owner' }),
  makeUser({ id: 'owner-2', username: 'propietaria.dos', role: 'owner' }),
  makeUser({ id: 'admin-1', username: 'administracion', role: 'admin' }),
  makeUser({ id: 'reception-1', username: 'recepcion', role: 'reception', email: 'reception@example.com', email_verified_at: '2026-02-01T00:00:00.000Z' }),
  makeUser({ id: 'professional-1', username: 'profesional', role: 'professional', active: false, employee_id: '7', employee_name: 'Ana Pérez' })
];

describe('UserManagementComponent', () => {
  let fixture: ComponentFixture<UserManagementComponent>;
  let component: UserManagementComponent;
  const currentUser = signal<{ id: string; role: string }>({ id: 'owner-1', role: 'owner' });
  const serviceMock = {
    getUsers: vi.fn(() => of(users)),
    getEmployees: vi.fn(() => of([{ id: 7, nombre: 'Ana Pérez', active: true }])),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetPassword: vi.fn(),
    revokeSessions: vi.fn(),
    getAudit: vi.fn(() => of([]))
  };
  const authMock = { currentUser };

  beforeEach(async () => {
    currentUser.set({ id: 'owner-1', role: 'owner' });
    vi.clearAllMocks();
    serviceMock.getUsers.mockReturnValue(of(users));

    await TestBed.configureTestingModule({
      imports: [UserManagementComponent],
      providers: [
        { provide: UserManagementService, useValue: serviceMock },
        { provide: AuthService, useValue: authMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(UserManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('el propietario puede asignar los cuatro roles', () => {
    expect(component.assignableRoles()).toEqual(['owner', 'admin', 'reception', 'professional']);
  });

  it('el administrador solo gestiona recepción y profesionales', () => {
    currentUser.set({ id: 'admin-1', role: 'admin' });

    expect(component.assignableRoles()).toEqual(['reception', 'professional']);
    expect(component.canManage(users[0])).toBe(false);
    expect(component.canManage(users[2])).toBe(false);
    expect(component.canManage(users[3])).toBe(true);
    expect(component.canManage(users[4])).toBe(true);
  });

  it('la propia cuenta queda protegida en administración', () => {
    expect(component.canManage(users[0])).toBe(false);
    expect(component.canManage(users[1])).toBe(true);
  });

  it('crear una cuenta profesional exige empleado vinculado', () => {
    component.createForm = { username: 'nueva.profesional', email: '', role: 'professional', employee_id: '' };
    component.createUser();

    expect(serviceMock.createUser).not.toHaveBeenCalled();
    expect(component.actionError).toMatch(/vincularse a un empleado/i);
  });

  it('la creación exitosa muestra la contraseña temporal una sola vez', () => {
    const created = makeUser({ id: 'new-1', username: 'nueva.recepcion', role: 'reception', must_change_password: true });
    serviceMock.createUser.mockReturnValue(of({
      message: 'Cuenta creada. La contraseña temporal se muestra una sola vez.',
      user: created,
      temporary_password: 'Tmp-1234567890'
    }));

    component.createForm = { username: 'nueva.recepcion', email: '', role: 'reception', employee_id: '' };
    component.createUser();

    expect(serviceMock.createUser).toHaveBeenCalledWith({
      username: 'nueva.recepcion',
      email: null,
      role: 'reception',
      employee_id: null
    });
    expect(component.oneTimeCredential?.password).toBe('Tmp-1234567890');
    expect(component.showCreate).toBe(false);
  });

  it('el reset por correo solo se habilita con correo verificado', () => {
    expect(component.canResetByEmail(users[3])).toBe(true);
    expect(component.canResetByEmail(users[4])).toBe(false);
  });

  it('los filtros de texto, rol y estado reducen la lista', () => {
    component.query = 'recepc';
    expect(component.filteredUsers.map((user) => user.id)).toEqual(['reception-1']);

    component.query = '';
    component.statusFilter = 'inactive';
    expect(component.filteredUsers.map((user) => user.id)).toEqual(['professional-1']);

    component.statusFilter = 'all';
    component.roleFilter = 'owner';
    expect(component.filteredUsers).toHaveLength(2);
  });
});
