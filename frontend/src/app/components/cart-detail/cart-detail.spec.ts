import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { MatDialogRef } from '@angular/material/dialog';

import { CartDetailComponent } from './cart-detail';

describe('CartDetailComponent', () => {
  let component: CartDetailComponent;
  let fixture: ComponentFixture<CartDetailComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CartDetailComponent],
      providers: [
        provideHttpClient(),
        { provide: MatDialogRef, useValue: { close: () => undefined } }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CartDetailComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
