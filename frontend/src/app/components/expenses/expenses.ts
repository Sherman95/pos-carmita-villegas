import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { Router } from '@angular/router'; // 👈 Nuevo
import Swal from 'sweetalert2'; // 👈 Nuevo

import { ExpensesService } from '../../services/expenses';
import { Expense, ExpensesResponse } from '../../models/expense.model';
import { AddExpenseDialogComponent } from './add-expense-dialog/add-expense-dialog';
import { CashService } from '../../services/cash'; // 👈 Nuevo

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [
    CommonModule, FormsModule, 
    MatButtonModule, MatIconModule, MatCardModule, 
    MatListModule, MatFormFieldModule, MatSelectModule,
    MatDialogModule, MatChipsModule
  ],
  templateUrl: './expenses.html',
  styleUrls: ['./expenses.scss']
})
export class ExpensesComponent implements OnInit {
  
  expenses: Expense[] = [];
  totalAmount = 0;
  loading = false;
  selectedCategory = 'TODAS';
  
  // 👇 INYECCIONES DE SERVICIOS ADICIONALES
  private cashService = inject(CashService);
  private router = inject(Router);
  
  categoryIcons: any = {
    'SERVICIOS_BASICOS': 'lightbulb',
    'INSUMOS_LOCAL': 'content_cut',
    'MANTENIMIENTO': 'cleaning_services',
    'GASTOS_PERSONALES': 'person',
    'ALIMENTACION': 'restaurant',
    'SALUD': 'local_pharmacy',
    'OTROS': 'help_outline'
  };

  constructor(
    private expensesService: ExpensesService,
    private dialog: MatDialog,
    private cd: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadExpenses();
  }

  loadExpenses() {
    this.loading = true;
    this.cd.detectChanges(); 

    this.expensesService.getExpenses(undefined, undefined, this.selectedCategory)
      .subscribe({
        next: (res: ExpensesResponse) => {
          this.expenses = res.expenses;
          this.totalAmount = res.total; 
          this.loading = false;
          this.cd.detectChanges();
        },
        error: (err: any) => {
          console.error(err);
          this.loading = false;
          this.cd.detectChanges();
        }
      });
  }

  openAddDialog() {
    // 👇 1. SEGURIDAD: VERIFICAR CAJA ANTES DE ABRIR EL DIÁLOGO
    this.cashService.getStatus().subscribe(status => {
      
      if (!status.isOpen) {
        // ⛔ SI ESTÁ CERRADA: ALERTA Y REDIRECCIÓN
        Swal.fire({
          title: '⛔ Caja Cerrada',
          text: 'Debes abrir turno para poder registrar salidas de dinero.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Ir a Abrir Caja',
          confirmButtonColor: '#d32f2f',
          cancelButtonText: 'Cancelar'
        }).then((res) => {
          if (res.isConfirmed) {
            this.router.navigate(['/cash-control']);
          }
        });
        return; // 🛑 DETENEMOS AQUÍ
      }

      // ✅ SI ESTÁ ABIERTA: CONTINUAMOS NORMAL
      const dialogRef = this.dialog.open(AddExpenseDialogComponent, {
        width: '400px',
        disableClose: true
      });

      dialogRef.afterClosed().subscribe((result: any) => {
        if (result === true) {
          this.loadExpenses();
        }
      });

    });
  }

  deleteExpense(id: string | undefined) {
    if (!id) return;
    if (confirm('¿Borrar este gasto?')) {
      this.expensesService.deleteExpense(id).subscribe(() => {
        this.loadExpenses();
      });
    }
  }

  getIcon(cat: string) {
    return this.categoryIcons[cat] || 'paid';
  }
}