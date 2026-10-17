import { Component, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { ExpensesService } from '../../../services/expenses';
import { ExpenseCategoryItem } from '../../../models/expense.model';

@Component({
  selector: 'app-expense-categories-dialog',
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
    MatButtonToggleModule,
    MatTooltipModule
  ],
  templateUrl: './expense-categories-dialog.html',
  styleUrls: ['./expense-categories-dialog.scss']
})
export class ExpenseCategoriesDialogComponent implements OnInit {
  private dialogRef = inject(MatDialogRef<ExpenseCategoriesDialogComponent>);
  private expensesService = inject(ExpensesService);
  private cd = inject(ChangeDetectorRef);

  categories: ExpenseCategoryItem[] = [];
  loading = false;
  saving = false;

  // Form state
  editingId: number | null = null;
  formModel: Partial<ExpenseCategoryItem> = {
    nombre: '',
    tipo: 'LOCAL',
    icono: 'category',
    color: 'blue',
    descripcion: ''
  };

  availableIcons = [
    { name: 'store', label: 'Local / Tienda' },
    { name: 'lightbulb', label: 'Servicios Luz' },
    { name: 'build', label: 'Mantenimiento' },
    { name: 'person', label: 'Personal' },
    { name: 'restaurant', label: 'Alimentación' },
    { name: 'medical_services', label: 'Salud' },
    { name: 'campaign', label: 'Publicidad' },
    { name: 'local_shipping', label: 'Transporte' },
    { name: 'receipt_long', label: 'Facturas / Trámites' },
    { name: 'shopping_bag', label: 'Compras' },
    { name: 'payments', label: 'Pagos' },
    { name: 'cleaning_services', label: 'Limpieza' },
    { name: 'school', label: 'Capacitación' },
    { name: 'computer', label: 'Tecnología' },
    { name: 'wifi', label: 'Internet' },
    { name: 'security', label: 'Seguridad' },
    { name: 'content_cut', label: 'Belleza / Insumos' },
    { name: 'help', label: 'Otros' }
  ];

  availableColors = [
    { key: 'blue', label: 'Azul', hex: '#1976d2' },
    { key: 'orange', label: 'Naranja', hex: '#f57c00' },
    { key: 'purple', label: 'Morado', hex: '#7b1fa2' },
    { key: 'green', label: 'Verde', hex: '#388e3c' },
    { key: 'red', label: 'Rojo', hex: '#d32f2f' },
    { key: 'teal', label: 'Turquesa', hex: '#00897b' },
    { key: 'pink', label: 'Rosa', hex: '#d81b60' },
    { key: 'indigo', label: 'Índigo', hex: '#3949ab' },
    { key: 'amber', label: 'Ámbar', hex: '#ffb300' },
    { key: 'grey', label: 'Gris', hex: '#757575' }
  ];

  hasChanges = false;

  ngOnInit() {
    this.loadCategories();
  }

  loadCategories() {
    this.loading = true;
    this.expensesService.getCategories().subscribe({
      next: (data) => {
        this.categories = data;
        this.loading = false;
        this.cd.markForCheck();
      },
      error: (err) => {
        console.error('Error cargando categorías:', err);
        this.loading = false;
        this.cd.markForCheck();
      }
    });
  }

  saveCategory() {
    if (!this.formModel.nombre || !this.formModel.nombre.trim()) {
      Swal.fire('Atención', 'El nombre de la categoría es obligatorio', 'warning');
      return;
    }

    this.saving = true;

    if (this.editingId) {
      // Update
      this.expensesService.updateCategory(this.editingId, this.formModel).subscribe({
        next: (updated) => {
          this.saving = false;
          this.hasChanges = true;
          Swal.fire({
            title: '¡Actualizada!',
            text: `La categoría "${updated.nombre}" fue actualizada con éxito.`,
            icon: 'success',
            timer: 1600,
            showConfirmButton: false
          });
          this.resetForm();
          this.loadCategories();
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.error || 'No se pudo actualizar la categoría';
          Swal.fire('Error', msg, 'error');
        }
      });
    } else {
      // Create
      this.expensesService.createCategory(this.formModel).subscribe({
        next: (created) => {
          this.saving = false;
          this.hasChanges = true;
          Swal.fire({
            title: '¡Creada!',
            text: `La categoría "${created.nombre}" se creó correctamente.`,
            icon: 'success',
            timer: 1600,
            showConfirmButton: false
          });
          this.resetForm();
          this.loadCategories();
        },
        error: (err) => {
          this.saving = false;
          const msg = err.error?.error || 'No se pudo crear la categoría';
          Swal.fire('Error', msg, 'error');
        }
      });
    }
  }

  editCategory(cat: ExpenseCategoryItem) {
    this.editingId = cat.id || null;
    this.formModel = {
      nombre: cat.nombre,
      tipo: cat.tipo,
      icono: cat.icono,
      color: cat.color,
      descripcion: cat.descripcion || ''
    };
  }

  cancelEdit() {
    this.resetForm();
  }

  resetForm() {
    this.editingId = null;
    this.formModel = {
      nombre: '',
      tipo: 'LOCAL',
      icono: 'category',
      color: 'blue',
      descripcion: ''
    };
  }

  deleteCategory(cat: ExpenseCategoryItem) {
    if (!cat.id) return;

    Swal.fire({
      title: `¿Eliminar "${cat.nombre}"?`,
      text: 'Solo se podrá eliminar si no tiene gastos asociados.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#64748b',
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar'
    }).then((result) => {
      if (result.isConfirmed) {
        this.expensesService.deleteCategory(cat.id!).subscribe({
          next: () => {
            this.hasChanges = true;
            Swal.fire({
              title: 'Eliminada',
              text: 'La categoría ha sido eliminada.',
              icon: 'success',
              timer: 1600,
              showConfirmButton: false
            });
            if (this.editingId === cat.id) {
              this.resetForm();
            }
            this.loadCategories();
          },
          error: (err) => {
            const msg = err.error?.error || 'No se pudo eliminar la categoría.';
            Swal.fire('No se puede eliminar', msg, 'error');
          }
        });
      }
    });
  }

  close() {
    this.dialogRef.close(this.hasChanges);
  }
}
