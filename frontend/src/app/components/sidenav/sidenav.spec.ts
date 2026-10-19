import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { of } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { SidenavComponent } from './sidenav';

describe('Sidenav', () => {
  let component: SidenavComponent;
  let fixture: ComponentFixture<SidenavComponent>;
  const currentUser = signal({ id: 'admin-1', username: 'admin', role: 'owner', permissions: ['sidro_services.configure', 'users.read'] });
  const authMock = {
    currentUser,
    isAdmin: () => {
      const role = currentUser().role.trim().toLowerCase();
      return role === 'owner' || role === 'admin';
    },
    hasPermission: (permission: string) => currentUser().permissions.includes(permission),
    getToken: () => null,
    logout: vi.fn()
  };

  beforeEach(async () => {
    currentUser.set({ id: 'admin-1', username: 'admin', role: 'owner', permissions: ['sidro_services.configure', 'users.read'] });
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SidenavComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        { provide: SwPush, useValue: { isEnabled: false, subscription: of(null) } },
        { provide: AuthService, useValue: authMock }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SidenavComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('muestra Configurar SIDRO a la jerarquía administrativa', () => {
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('a[href="/sidro/settings"]')).toBeTruthy();
  });

  it('oculta Configurar SIDRO a una cuenta colaboradora', () => {
    currentUser.set({ id: 'user-1', username: 'profesional', role: 'professional', permissions: ['appointments.read_own'] });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('a[href="/sidro/settings"]')).toBeFalsy();
  });
});
