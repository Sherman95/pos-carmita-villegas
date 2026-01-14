import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PriceDialogComponent } from './price-dialog';

describe('PriceDialogComponent', () => {
  let component: PriceDialogComponent;
  let fixture: ComponentFixture<PriceDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PriceDialogComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PriceDialogComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
