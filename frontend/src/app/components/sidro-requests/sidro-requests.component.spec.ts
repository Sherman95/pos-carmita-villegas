import { signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import Swal from 'sweetalert2';
import { AuthService } from '../../services/auth.service';
import { SidroAdminService, SidroRequest } from '../../services/sidro-admin.service';
import { SidroRequestsComponent } from './sidro-requests.component';

describe('SidroRequestsComponent', () => {
  let component: SidroRequestsComponent;
  let fixture: ComponentFixture<SidroRequestsComponent>;
  const currentUser = signal({ id: 'admin-1', username: 'admin', role: 'admin' });

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
    proposeAlternative: vi.fn(() => of({ message: 'Propuesta enviada' }))
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    currentUser.set({ id: 'admin-1', username: 'admin', role: 'admin' });
    await TestBed.configureTestingModule({
      imports: [SidroRequestsComponent],
      providers: [
        provideRouter([]),
        { provide: SidroAdminService, useValue: sidroServiceMock },
        {
          provide: AuthService,
          useValue: { currentUser }
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
});
