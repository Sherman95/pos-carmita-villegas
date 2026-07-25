import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CartFooterComponent } from './cart-footer';

describe('CartFooter', () => {
  let component: CartFooterComponent;
  let fixture: ComponentFixture<CartFooterComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CartFooterComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CartFooterComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
