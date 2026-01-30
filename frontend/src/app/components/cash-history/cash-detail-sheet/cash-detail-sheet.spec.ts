import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CashDetailSheet } from './cash-detail-sheet';

describe('CashDetailSheet', () => {
  let component: CashDetailSheet;
  let fixture: ComponentFixture<CashDetailSheet>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashDetailSheet]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CashDetailSheet);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
