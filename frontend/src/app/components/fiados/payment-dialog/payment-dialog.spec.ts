import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import { PaymentDialogComponent } from './payment-dialog';

describe('PaymentDialog', () => {
  let component: PaymentDialogComponent;
  let fixture: ComponentFixture<PaymentDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentDialogComponent],
      providers: [
        { provide: MatDialogRef, useValue: { close: () => undefined } },
        { provide: MAT_DIALOG_DATA, useValue: { clienteNombre: 'Cliente', saldoPendiente: 100 } }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaymentDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
