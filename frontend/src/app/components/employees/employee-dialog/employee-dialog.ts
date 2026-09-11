import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EmployeeService } from '../../../services/employee.service';
import Swal from 'sweetalert2';

@Component({
  selector: 'app-employee-dialog',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule
  ],
  templateUrl: './employee-dialog.html',
  styleUrls: ['./employee-dialog.scss']
})
export class EmployeeDialogComponent {
  form: FormGroup;
  isEdit = false;

  constructor(
    private fb: FormBuilder,
    public dialogRef: MatDialogRef<EmployeeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any,
    private employeeService: EmployeeService
  ) {
    this.isEdit = !!data.employee;

    this.form = this.fb.group({
      nombre: [this.isEdit ? data.employee.nombre : '', Validators.required],
      telefono: [this.isEdit ? data.employee.telefono : '']
    });
  }

  cancelar(): void {
    this.dialogRef.close();
  }

  guardar(): void {
    const injectTopLayer = () => {
      const swalContainer = Swal.getContainer();
      if (swalContainer && !swalContainer.hasAttribute('popover')) {
        swalContainer.setAttribute('popover', 'manual');
        try { swalContainer.showPopover(); } catch (e) {}
      }
    };

    if (this.form.invalid) {
      Swal.fire({
        icon: 'warning',
        title: 'Datos Incompletos',
        text: 'Por favor, ingresa al menos el nombre de la profesional.',
        confirmButtonColor: 'var(--brand-base)',
        didOpen: injectTopLayer
      });
      return;
    }

    if (this.isEdit) {
      this.employeeService.updateEmployee(this.data.employee.id, this.form.value).subscribe(() => {
        this.dialogRef.close(true);
      });
    } else {
      this.employeeService.createEmployee(this.form.value).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }

  async eliminar() {
    const result = await Swal.fire({
      icon: 'warning',
      title: '¿Eliminar profesional?',
      text: 'Esta acción no se puede deshacer.',
      showCancelButton: true,
      confirmButtonText: 'Sí, eliminar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d33',
      didOpen: () => {
        const swalContainer = Swal.getContainer();
        if (swalContainer && !swalContainer.hasAttribute('popover')) {
          swalContainer.setAttribute('popover', 'manual');
          try { swalContainer.showPopover(); } catch (e) {}
        }
      }
    });
    if (result.isConfirmed) {
      this.employeeService.deleteEmployee(this.data.employee.id).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }
}
