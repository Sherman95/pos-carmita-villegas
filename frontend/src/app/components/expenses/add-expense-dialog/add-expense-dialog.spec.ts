import { ComponentFixture, TestBed } from '@angular/core/testing';
// 👇 AQUÍ ESTABA EL ERROR: Ahora importamos el nombre correcto
import { AddExpenseDialogComponent } from './add-expense-dialog';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ExpensesService } from '../../../services/expenses';

describe('AddExpenseDialogComponent', () => {
  let component: AddExpenseDialogComponent;
  let fixture: ComponentFixture<AddExpenseDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      // Importamos el componente porque es standalone
      imports: [AddExpenseDialogComponent, HttpClientTestingModule],
      providers: [
        // Simulamos las dependencias del diálogo
        { provide: MatDialogRef, useValue: {} },
        { provide: MAT_DIALOG_DATA, useValue: {} },
        ExpensesService
      ]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(AddExpenseDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});