import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CashControlComponent } from './cash-control';

describe('CashControl', () => {
  let component: CashControlComponent;
  let fixture: ComponentFixture<CashControlComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashControlComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CashControlComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
