import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PaymentDialog } from './payment-dialog';

describe('PaymentDialog', () => {
  let component: PaymentDialog;
  let fixture: ComponentFixture<PaymentDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PaymentDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
