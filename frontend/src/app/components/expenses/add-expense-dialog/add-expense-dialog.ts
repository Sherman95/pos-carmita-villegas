import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ExpensesService } from '../../../services/expenses'; 
import { Expense, ExpenseCategory } from '../../../models/expense.model';

@Component({
  selector: 'app-add-expense-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './add-expense-dialog.html', 
  styleUrls: ['./add-expense-dialog.scss']
})
export class AddExpenseDialogComponent {
  
  // ✅ CORRECCIÓN 1: Renombramos 'expenseData' a 'data' (como lo pide tu HTML)
  data: Expense = {
    monto: 0,
    categoria: 'INSUMOS_LOCAL',
    descripcion: '',
    metodo_pago: 'EFECTIVO' 
  };

  loading = false;

  categories: { value: ExpenseCategory; label: string; icon: string }[] = [
    { value: 'INSUMOS_LOCAL', label: 'Insumos del Local', icon: 'content_cut' },
    { value: 'SERVICIOS_BASICOS', label: 'Servicios (Luz/Agua)', icon: 'lightbulb' },
    { value: 'MANTENIMIENTO', label: 'Mantenimiento / Limpieza', icon: 'cleaning_services' },
    { value: 'GASTOS_PERSONALES', label: 'Gastos Personales (Retiro)', icon: 'person' },
    { value: 'ALIMENTACION', label: 'Alimentación', icon: 'restaurant' },
    { value: 'SALUD', label: 'Salud / Farmacia', icon: 'local_pharmacy' },
    { value: 'OTROS', label: 'Otros', icon: 'help_outline' }
  ];

  constructor(
    private dialogRef: MatDialogRef<AddExpenseDialogComponent>,
    private expenseService: ExpensesService
  ) {}

  // ✅ CORRECCIÓN 2: Renombramos 'save' a 'guardar'
  guardar() {
    if (this.data.monto <= 0) {
      alert('Por favor ingresa un monto válido');
      return;
    }

    this.loading = true;

    this.expenseService.createExpense(this.data).subscribe({
      next: (res: any) => {
        this.loading = false;
        this.dialogRef.close(true); 
      },
      error: (err: any) => {
        this.loading = false;
        console.error(err);
        alert('Error al guardar el gasto');
      }
    });
  }

  // ✅ CORRECCIÓN 3: Renombramos 'close' a 'cancelar'
  cancelar() {
    this.dialogRef.close(false);
  }

  getIcon(catValue: string): string {
    return this.categories.find(c => c.value === catValue)?.icon || 'help';
  }

  getLabel(catValue: string): string {
    return this.categories.find(c => c.value === catValue)?.label || catValue;
  }
}