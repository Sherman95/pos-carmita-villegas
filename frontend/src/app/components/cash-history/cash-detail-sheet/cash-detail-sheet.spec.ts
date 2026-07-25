import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';

import { CashDetailSheetComponent } from './cash-detail-sheet';

describe('CashDetailSheet', () => {
  let component: CashDetailSheetComponent;
  let fixture: ComponentFixture<CashDetailSheetComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CashDetailSheetComponent],
      providers: [
        { provide: MatBottomSheetRef, useValue: { dismiss: () => undefined } },
        { provide: MAT_BOTTOM_SHEET_DATA, useValue: {} }
      ]
    })
    .compileComponents();

    fixture = TestBed.createComponent(CashDetailSheetComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
