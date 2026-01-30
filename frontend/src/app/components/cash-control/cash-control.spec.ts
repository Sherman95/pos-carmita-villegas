import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CashControl } from './cash-control';

describe('CashControl', () => {
  let component: CashControl;
  let fixture: ComponentFixture<CashControl>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashControl]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CashControl);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
