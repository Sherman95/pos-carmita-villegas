import { Component, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { ExpensesService } from '../../../services/expenses';
import { Expense, ExpenseCategoryItem } from '../../../models/expense.model';
import { ExpenseCategoriesDialogComponent } from '../expense-categories-dialog/expense-categories-dialog';

@Component({
  selector: 'app-add-expense-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatButtonToggleModule
  ],
  templateUrl: './add-expense-dialog.html',
  styleUrls: ['./add-expense-dialog.scss']
})
export class AddExpenseDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<AddExpenseDialogComponent>);
  private expenseService = inject(ExpensesService);
  private dialog = inject(MatDialog);
  private cd = inject(ChangeDetectorRef);

  data: Expense = {
    monto: 0,
    categoria: 'INSUMOS_LOCAL',
    descripcion: '',
    metodo_pago: 'EFECTIVO'
  };

  loading = false;
  categories: ExpenseCategoryItem[] = [];

  ngOnInit() {
    this.loadCategories();
  }

  loadCategories(selectCode?: string) {
    this.expenseService.getCategories().subscribe({
      next: (cats) => {
        this.categories = cats || [];
        if (selectCode) {
          this.data.categoria = selectCode;
        } else if (!this.data.categoria && this.categories.length > 0) {
          this.data.categoria = this.categories[0].codigo;
        }
        this.cd.markForCheck();
      },
      error: (err) => console.error('Error cargando categorías en diálogo:', err)
    });
  }

  openManageCategories() {
    const dialogRef = this.dialog.open(ExpenseCategoriesDialogComponent, {
      width: '650px',
      maxWidth: '95vw',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe((hasChanges) => {
      if (hasChanges) {
        this.loadCategories();
      }
    });
  }

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

  cancelar() {
    this.dialogRef.close(false);
  }

  getIcon(catValue: string): string {
    return this.categories.find(c => c.codigo === catValue)?.icono || 'help';
  }

  getLabel(catValue: string): string {
    return this.categories.find(c => c.codigo === catValue)?.nombre || catValue;
  }
}
