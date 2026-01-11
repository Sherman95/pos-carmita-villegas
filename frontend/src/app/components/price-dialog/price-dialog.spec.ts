import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PriceDialog } from './price-dialog';

describe('PriceDialog', () => {
  let component: PriceDialog;
  let fixture: ComponentFixture<PriceDialog>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PriceDialog]
    })
    .compileComponents();

    fixture = TestBed.createComponent(PriceDialog);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
