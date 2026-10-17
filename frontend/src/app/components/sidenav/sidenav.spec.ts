import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { AuthService } from '../../services/auth.service';
import { SidenavComponent } from './sidenav';

describe('Sidenav', () => {
  let component: SidenavComponent;
  let fixture: ComponentFixture<SidenavComponent>;
  const currentUser = signal({ id: 'admin-1', username: 'admin', role: 'user' });
  const authMock = {
    currentUser,
    isAdmin: () => {
      const user = currentUser();
      return user.role.trim().toLowerCase() === 'admin' ||
        user.username.trim().toLowerCase() === 'admin';
    },
    logout: vi.fn()
  };

  beforeEach(async () => {
    currentUser.set({ id: 'admin-1', username: 'admin', role: 'user' });
    vi.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [SidenavComponent],
      providers: [
        provideRouter([]),
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

  it('muestra Configurar SIDRO al usuario admin aunque el rol local esté desactualizado', () => {
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('a[href="/sidro/settings"]')).toBeTruthy();
  });

  it('oculta Configurar SIDRO a una cuenta colaboradora', () => {
    currentUser.set({ id: 'user-1', username: 'profesional', role: 'user' });
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('a[href="/sidro/settings"]')).toBeFalsy();
  });
});
