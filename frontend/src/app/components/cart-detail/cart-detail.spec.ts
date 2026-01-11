import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CartDetail } from './cart-detail';

describe('CartDetail', () => {
  let component: CartDetail;
  let fixture: ComponentFixture<CartDetail>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CartDetail]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CartDetail);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
