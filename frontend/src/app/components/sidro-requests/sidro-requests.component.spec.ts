import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import Swal from 'sweetalert2';
import { AuthService } from '../../services/auth.service';
import { ClientsService } from '../../services/clients.service';
import { SidroAdminService, SidroRequest } from '../../services/sidro-admin.service';
import { SidroRequestsComponent } from './sidro-requests.component';

describe('SidroRequestsComponent', () => {
  let component: SidroRequestsComponent;
  let fixture: ComponentFixture<SidroRequestsComponent>;
  const currentUser = signal({ id: 'admin-1', username: 'admin', role: 'admin' });
  const hasPermission = vi.fn((_permission: string) => true);
  const authServiceMock = { currentUser, hasPermission };

  const requests: SidroRequest[] = [
    {
      id: 1,
      request_date: '2026-10-20T00:00:00.000Z',
      start_time: '09:00:00',
      end_time: '10:00:00',
      status: 'PENDIENTE',
      client_name: 'Ana Pérez',
      service_name: 'Coloración',
      employee_name: 'Carmita',
      client_notes: 'Quiero un tono chocolate y conservar el largo.',
      sidro_account_id: 'account-1',
      linked_client_id: null
    },
    {
      id: 2,
      request_date: '2026-10-21T00:00:00.000Z',
      start_time: '11:00:00',
      end_time: '12:00:00',
      proposed_date: '2026-10-22T00:00:00.000Z',
      proposed_start_time: '14:00:00',
      proposed_end_time: '15:00:00',
      status: 'PROPUESTA',
      client_name: 'Beatriz Ruiz',
      service_name: 'Corte',
      employee_name: 'María',
      sidro_account_id: 'account-2',
      linked_client_id: null
    },
    {
      id: 3,
      request_date: '2026-10-23T00:00:00.000Z',
      start_time: '15:00:00',
      end_time: '16:00:00',
      status: 'CONFIRMADA',
      client_name: 'Carla Vera',
      service_name: 'Manicure',
      employee_name: 'Carmita',
      sidro_account_id: 'account-3',
      linked_client_id: 'client-3',
      official_appointment_id: 'appointment-3'
    }
  ];

  const sidroServiceMock = {
    getRequests: vi.fn(() => of(requests)),
    acceptRequest: vi.fn(() =>
      of({ message: 'Solicitud aprobada y convertida en cita oficial', status: 'CONFIRMADA' })
    ),
    rejectRequest: vi.fn(() => of({ message: 'Solicitud rechazada' })),
    proposeAlternative: vi.fn(() => of({ message: 'Propuesta enviada' })),
    getAccountDetail: vi.fn(() =>
      of({
        account: {
          id: 'account-1',
          nombre_completo: 'Ana Pérez',
          telefono: '+593991234567',
          email: 'ana@example.com',
          documento: '1710034065',
          direccion: 'Av. Amazonas 123',
          is_active: true,
          linked_client_id: null,
          linked_client_name: null
        }
      })
    ),
    getAccountMatches: vi.fn(() =>
      of({
        matches: [
          {
            id: 'client-5',
            nombre: 'Ana Pérez',
            cedula: '1710034065',
            telefono: '0991234567',
            email: 'ana@example.com',
            direccion: null,
            match_reasons: ['documento', 'correo'],
            linked_to_other: false
          }
        ],
        linked_client_id: null
      })
    ),
    linkAccount: vi.fn(() =>
      of({
        message: 'Vinculación completada.',
        confirmed_requests: [{ request_id: 1, date: '2026-10-25', time: '15:00', appointment_id: 77 }],
        conflicts: []
      })
    ),
    createClientAndLink: vi.fn(() =>
      of({
        message: 'Cliente creado y vinculado.',
        client: {
          id: 'client-10',
          nombre: 'Ana Pérez',
          cedula: '1710034065',
          telefono: '+593991234567',
          email: 'ana@example.com',
          direccion: 'Av. Amazonas 123'
        },
        link_id: 'link-10',
        confirmed_requests: [],
        conflicts: []
      })
    )
  };

  const clientsServiceMock = {
    getClients: vi.fn(() =>
      of([
        {
          id: 'client-5',
          nombre: 'Ana Pérez',
          cedula: '1710034065',
          telefono: '0991234567',
          email: 'ana@example.com',
          direccion: null
        },
        {
          id: 'client-6',
          nombre: 'Zoe Vega',
          cedula: null,
          telefono: null,
          email: null,
          direccion: null
        }
      ])
    )
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    hasPermission.mockImplementation(() => true);
    currentUser.set({ id: 'admin-1', username: 'admin', role: 'admin' });
    await TestBed.configureTestingModule({
      imports: [SidroRequestsComponent],
      providers: [
        provideRouter([]),
        { provide: SidroAdminService, useValue: sidroServiceMock },
        { provide: ClientsService, useValue: clientsServiceMock },
        {
          provide: AuthService,
          useValue: authServiceMock
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SidroRequestsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('carga solicitudes ficticias y filtra por estado, profesional y texto', () => {
    expect(component.requests).toHaveLength(3);

    component.statusFilter = 'PROPUESTA';
    expect(component.filteredRequests.map((request) => request.id)).toEqual([2]);

    component.statusFilter = 'ALL';
    component.professionalFilter = 'Carmita';
    component.searchTerm = 'manicure';
    expect(component.filteredRequests.map((request) => request.id)).toEqual([3]);

    component.professionalFilter = 'ALL';
    component.searchTerm = 'tono chocolate';
    expect(component.filteredRequests.map((request) => request.id)).toEqual([1]);
  });

  it('habilita acciones únicamente para solicitudes pendientes', () => {
    expect(component.canManage(requests[0])).toBe(true);
    expect(component.canManage(requests[1])).toBe(false);
    expect(component.canManage(requests[2])).toBe(false);
  });

  it('muestra la vinculación solo a administradores y conserva vistas de escritorio y móvil', () => {
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.desktop-table')).toBeTruthy();
    expect(element.querySelector('.mobile-list')).toBeTruthy();
    expect(element.querySelector('a[href="/sidro/settings"]')).toBeTruthy();
    expect(element.textContent).toContain('Quiero un tono chocolate');

    currentUser.set({ id: 'user-1', username: 'profesional', role: 'user' });
    fixture.detectChanges();

    expect(element.querySelector('a[href="/sidro/settings"]')).toBeFalsy();
  });

  it('notifica a la agenda después de aprobar una solicitud', async () => {
    const alertSpy = vi.spyOn(Swal, 'fire').mockResolvedValue({ isConfirmed: true } as never);
    const changedSpy = vi.fn();
    component.appointmentsChanged.subscribe(changedSpy);

    await component.accept(requests[0]);

    expect(sidroServiceMock.acceptRequest).toHaveBeenCalledWith(1);
    expect(changedSpy).toHaveBeenCalledOnce();
    alertSpy.mockRestore();
  });

  it('presenta HTTP 409 como conflicto de horario', async () => {
    sidroServiceMock.acceptRequest.mockReturnValueOnce(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: 'Ya existe una cita en ese horario.' }
          })
      )
    );
    const alertSpy = vi.spyOn(Swal, 'fire').mockResolvedValue({ isConfirmed: true } as never);

    await component.accept(requests[0]);

    expect(alertSpy).toHaveBeenLastCalledWith(
      'Conflicto de horario',
      'Ya existe una cita en ese horario.',
      'warning'
    );
    alertSpy.mockRestore();
  });

  describe('vinculación desde solicitudes', () => {
    it('exige el permiso sidro_accounts.link y una solicitud sin vínculo', () => {
      expect(component.canLinkRequest(requests[0])).toBe(true);
      expect(component.canLinkRequest(requests[1])).toBe(false);
      expect(component.canLinkRequest(requests[2])).toBe(false);

      hasPermission.mockImplementation(() => false);
      expect(component.canLinkRequest(requests[0])).toBe(false);
    });

    it('vincula con un cliente existente elegido en el diálogo de coincidencias', async () => {
      const alertSpy = vi
        .spyOn(Swal, 'fire')
        .mockResolvedValue({ isConfirmed: true, value: 'client-5' } as never);
      const changedSpy = vi.fn();
      component.appointmentsChanged.subscribe(changedSpy);

      await component.linkExisting(requests[0]);

      expect(sidroServiceMock.getAccountMatches).toHaveBeenCalledWith('account-1');
      expect(clientsServiceMock.getClients).toHaveBeenCalled();
      expect(sidroServiceMock.linkAccount).toHaveBeenCalledWith('account-1', 'client-5', false);
      expect(changedSpy).toHaveBeenCalledOnce();
      const successAlert = alertSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'object' && (call[0] as any).title === 'Cuenta vinculada'
      );
      expect(successAlert).toBeTruthy();
      alertSpy.mockRestore();
    });

    it('crea un cliente POS validado y lo vincula a la cuenta SIDRO', async () => {
      const payload = {
        nombre: 'Ana Pérez',
        cedula: '1710034065',
        telefono: '+593991234567',
        email: 'ana@example.com',
        direccion: 'Av. Amazonas 123'
      };
      const alertSpy = vi
        .spyOn(Swal, 'fire')
        .mockResolvedValue({ isConfirmed: true, value: payload } as never);

      await component.createClientAndLink(requests[0]);

      expect(sidroServiceMock.getAccountDetail).toHaveBeenCalledWith('account-1');
      expect(sidroServiceMock.createClientAndLink).toHaveBeenCalledWith({
        sidro_account_id: 'account-1',
        ...payload
      });
      const successAlert = alertSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'object' && (call[0] as any).title === 'Cliente creado y vinculado'
      );
      expect(successAlert).toBeTruthy();
      alertSpy.mockRestore();
    });

    it('muestra las coincidencias cuando el backend rechaza la creación con 409', async () => {
      sidroServiceMock.createClientAndLink.mockReturnValueOnce(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: {
                error: 'Ya existe un cliente en el POS con la misma cédula o correo.',
                matches: [
                  {
                    id: 'client-5',
                    nombre: 'Ana Pérez',
                    cedula: '1710034065',
                    telefono: '0991234567',
                    email: 'ana@example.com',
                    direccion: null,
                    match_reasons: ['documento'],
                    linked_to_other: false
                  }
                ]
              }
            })
        )
      );
      const alertSpy = vi
        .spyOn(Swal, 'fire')
        .mockResolvedValue({ isConfirmed: true, value: { nombre: 'Ana Pérez', cedula: '1710034065', telefono: '0991234567', email: 'ana@example.com', direccion: 'Av. Amazonas 123' } } as never);

      await component.createClientAndLink(requests[0]);

      await new Promise((resolve) => setTimeout(resolve));
      const conflictAlert = alertSpy.mock.calls.find(
        (call) =>
          typeof call[0] === 'object' &&
          (call[0] as any).title === 'Ya existe un cliente parecido'
      );
      expect(conflictAlert).toBeTruthy();
      expect(String((conflictAlert?.[0] as any).html)).toContain('Ana Pérez');
      alertSpy.mockRestore();
    });
  });

  describe('deep link ?open=', () => {
    it('resalta la solicitud indicada en la URL', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [SidroRequestsComponent],
        providers: [
          provideRouter([]),
          { provide: SidroAdminService, useValue: sidroServiceMock },
          { provide: ClientsService, useValue: clientsServiceMock },
          {
            provide: AuthService,
            useValue: authServiceMock
          },
          {
            provide: ActivatedRoute,
            useValue: { snapshot: { queryParamMap: convertToParamMap({ open: '2' }) } }
          }
        ]
      }).compileComponents();

      const deepFixture = TestBed.createComponent(SidroRequestsComponent);
      deepFixture.detectChanges();
      await deepFixture.whenStable();

      expect(deepFixture.componentInstance.highlightedRequestId).toBe(2);
      const element = deepFixture.nativeElement as HTMLElement;
      expect(element.querySelector('#sidro-request-2')?.classList.contains('highlighted-row')).toBe(
        true
      );
    });
  });
});
