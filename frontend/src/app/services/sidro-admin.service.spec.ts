import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { SidroAdminService } from './sidro-admin.service';

describe('SidroAdminService', () => {
  let service: SidroAdminService;
  let httpTesting: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(SidroAdminService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpTesting.verify());

  it('sends an explicit force flag when an administrator confirms reassignment', () => {
    service.linkAccount('sidro-account-1', 'client-2', true).subscribe();

    const request = httpTesting.expectOne((req) => req.url.endsWith('/api/admin/sidro/link'));
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      sidro_account_id: 'sidro-account-1',
      client_id: 'client-2',
      force: true
    });
    request.flush({ message: 'ok' });
  });

  it('loads the SIDRO account detail for the linking dialog', () => {
    let result: any;
    service.getAccountDetail('account-9').subscribe((response) => (result = response));

    const request = httpTesting.expectOne((req) =>
      req.url.endsWith('/api/admin/sidro/accounts/account-9/detail')
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      account: {
        id: 'account-9',
        nombre_completo: 'Ana Torres',
        telefono: '+593991234567',
        email: 'ana@example.com',
        documento: '1710034065',
        direccion: 'Av. Amazonas 123',
        is_active: true,
        linked_client_id: null,
        linked_client_name: null
      }
    });

    expect(result.account.documento).toBe('1710034065');
    expect(result.account.direccion).toBe('Av. Amazonas 123');
  });

  it('loads possible client matches with reasons for an account', () => {
    let result: any;
    service.getAccountMatches('account-9').subscribe((response) => (result = response));

    const request = httpTesting.expectOne((req) =>
      req.url.endsWith('/api/admin/sidro/accounts/account-9/matches')
    );
    expect(request.request.method).toBe('GET');
    request.flush({
      matches: [
        {
          id: 'client-3',
          nombre: 'Ana Torres',
          cedula: '1710034065',
          telefono: '0991234567',
          email: null,
          direccion: null,
          match_reasons: ['documento', 'telefono'],
          linked_to_other: false
        }
      ],
      linked_client_id: null
    });

    expect(result.matches.length).toBe(1);
    expect(result.matches[0].match_reasons).toEqual(['documento', 'telefono']);
  });

  it('creates a POS client and links it to the SIDRO account in a single request', () => {
    let result: any;
    service
      .createClientAndLink({
        sidro_account_id: 'account-9',
        nombre: 'Ana Torres',
        cedula: '1710034065',
        telefono: '+593991234567',
        email: 'ana@example.com',
        direccion: 'Av. Amazonas 123'
      })
      .subscribe((response) => (result = response));

    const request = httpTesting.expectOne((req) =>
      req.url.endsWith('/api/admin/sidro/link/create-client')
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body.sidro_account_id).toBe('account-9');
    expect(request.request.body.cedula).toBe('1710034065');
    request.flush({
      message: 'Cliente creado y vinculado.',
      client: { id: 'client-10', nombre: 'Ana Torres', cedula: '1710034065', telefono: null, email: null, direccion: null },
      link_id: 'link-1',
      confirmed_requests: [],
      conflicts: []
    });

    expect(result.client.id).toBe('client-10');
  });
});
