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
});
