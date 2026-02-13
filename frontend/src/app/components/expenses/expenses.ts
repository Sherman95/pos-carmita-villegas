import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import Swal from 'sweetalert2';

import { ExpensesService } from '../../services/expenses';
import { Expense, ExpensesResponse } from '../../models/expense.model';
import { AddExpenseDialogComponent } from './add-expense-dialog/add-expense-dialog';
import { CashService } from '../../services/cash';

// 1. Interfaz estricta para el grupo
interface ExpenseGroup {
  date: string; // Usaremos string ISO para que el HTML pipe funcione feliz
  total: number;
  items: Expense[];
}

// 2. Interfaz para la configuración visual
interface CategoryConfig {
  icon: string;
  color: string;
  type: 'LOCAL' | 'PERSONAL';
}

@Component({
  selector: 'app-expenses',
  standalone: true,
  imports: [
    CommonModule, FormsModule, 
    MatButtonModule, MatIconModule, MatCardModule, 
    MatFormFieldModule, MatSelectModule, MatInputModule,
    MatDialogModule, MatTabsModule
  ],
  templateUrl: './expenses.html',
  styleUrls: ['./expenses.scss']
})
export class ExpensesComponent implements OnInit {
  
  // Datos
  allExpenses: Expense[] = []; 
  groupedExpenses: ExpenseGroup[] = []; 
  totalAmount = 0;
  loading = false;
  
  // Filtros
  searchTerm: string = '';
  currentTab: 'ALL' | 'LOCAL' | 'PERSONAL' = 'ALL';

  // Inyecciones
  private cashService = inject(CashService);
  private router = inject(Router);
  private expensesService = inject(ExpensesService); // Inyección moderna
  private dialog = inject(MatDialog);
  private cd = inject(ChangeDetectorRef);

  // Configuración Visual Centralizada
  // Si añades una categoría nueva en BD, asegúrate de ponerla aquí o saldrá por defecto
  categoryConfig: Record<string, CategoryConfig> = {
    'SERVICIOS_BASICOS': { icon: 'lightbulb', color: 'orange', type: 'LOCAL' },
    'INSUMOS_LOCAL':     { icon: 'store', color: 'blue', type: 'LOCAL' },
    'MANTENIMIENTO':     { icon: 'build', color: 'grey', type: 'LOCAL' },
    'GASTOS_PERSONALES': { icon: 'person', color: 'purple', type: 'PERSONAL' },
    'ALIMENTACION':      { icon: 'restaurant', color: 'green', type: 'PERSONAL' },
    'SALUD':             { icon: 'medical_services', color: 'red', type: 'PERSONAL' },
    'OTROS':             { icon: 'help', color: 'grey', type: 'PERSONAL' }
  };

  ngOnInit() {
    this.loadExpenses();
  }

  loadExpenses() {
    this.loading = true;
    this.expensesService.getExpenses(undefined, undefined, undefined)
      .subscribe({
        next: (res: ExpensesResponse) => {
          this.allExpenses = res.expenses || []; // Protección contra arrays nulos
          this.applyFilters(); 
          this.loading = false;
        },
        error: (err: any) => {
          console.error('Error cargando gastos:', err);
          this.loading = false;
        }
      });
  }

  // 🔥 EL CORAZÓN DE LA LÓGICA PRO
  applyFilters() {
    let filtered = [...this.allExpenses]; // Trabajamos sobre una copia

    // 1. Filtro por Pestaña (Local vs Personal)
    if (this.currentTab !== 'ALL') {
      filtered = filtered.filter(e => {
        // Si la categoría no existe en el config, asumimos que es PERSONAL por seguridad
        const config = this.categoryConfig[e.categoria];
        const type = config ? config.type : 'PERSONAL';
        return type === this.currentTab;
      });
    }

    // 2. Filtro por Buscador
    if (this.searchTerm.trim()) {
      const term = this.searchTerm.toLowerCase();
      filtered = filtered.filter(e => 
        (e.descripcion || '').toLowerCase().includes(term) ||
        (e.categoria || '').toLowerCase().includes(term)
      );
    }

    // 3. Agrupación por Fecha (Solución a los errores de TS)
    const groups: { [key: string]: ExpenseGroup } = {};

    filtered.forEach(item => {
      // A. Protección de Fecha: Si es null/undefined, usa HOY
      const rawDate = item.fecha ? new Date(item.fecha) : new Date();
      
      // B. Clave de agrupación (Ej: "Fri Feb 12 2026")
      const dateKey = rawDate.toDateString(); 
      
      if (!groups[dateKey]) {
        groups[dateKey] = { 
          date: rawDate.toISOString(), // Guardamos string ISO para el HTML
          total: 0, 
          items: [] 
        };
      }
      
      // C. Protección de Monto: Asegurar que sea número
      const montoNum = Number(item.monto || 0);

      groups[dateKey].items.push(item);
      groups[dateKey].total += montoNum;
    });

    // 4. Ordenar Grupos (Del más reciente al más antiguo)
    this.groupedExpenses = Object.values(groups).sort((a, b) => 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    // 5. Calcular Total General Visible
    this.totalAmount = filtered.reduce((sum, item) => sum + Number(item.monto || 0), 0);
    
    // Forzar actualización de vista
    this.cd.detectChanges();
  }

  // Cambio de pestañas
  onTabChange(index: number) {
    switch (index) {
      case 0: this.currentTab = 'ALL'; break;
      case 1: this.currentTab = 'LOCAL'; break;
      case 2: this.currentTab = 'PERSONAL'; break;
    }
    this.applyFilters();
  }

  // Abrir diálogo (Verifica caja primero)
  openAddDialog() {
    this.cashService.getStatus().subscribe(status => {
      if (!status.isOpen) {
        Swal.fire({
          title: '⛔ Caja Cerrada',
          text: 'Debes abrir turno para registrar salidas de dinero.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Ir a Abrir Caja',
          cancelButtonText: 'Cancelar'
        }).then((res) => {
          if(res.isConfirmed) this.router.navigate(['/cash-control']);
        });
        return;
      }

      const dialogRef = this.dialog.open(AddExpenseDialogComponent, { 
        width: '400px', 
        disableClose: true 
      });
      
      dialogRef.afterClosed().subscribe(result => { 
        if (result) this.loadExpenses(); 
      });
    });
  }

  // Borrar gasto
  deleteExpense(id: string | undefined) {
    if (!id) return;
    
    Swal.fire({
      title: '¿Borrar gasto?',
      text: 'Esta acción no se puede deshacer',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      confirmButtonText: 'Sí, borrar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.expensesService.deleteExpense(id).subscribe({
          next: () => {
            this.loadExpenses();
            // Opcional: Mostrar toast de éxito
          },
          error: () => Swal.fire('Error', 'No se pudo borrar el gasto', 'error')
        });
      }
    });
  }

  // Helpers Visuales (Con valores por defecto)
  getIcon(cat: string): string {
    return this.categoryConfig[cat]?.icon || 'paid';
  }

  getColor(cat: string): string {
    return this.categoryConfig[cat]?.color || 'grey';
  }
}