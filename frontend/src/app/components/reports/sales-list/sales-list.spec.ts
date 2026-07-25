import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SalesListComponent } from './sales-list';

describe('SalesList', () => {
  let component: SalesListComponent;
  let fixture: ComponentFixture<SalesListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SalesListComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SalesListComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
