import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { EmployeeService } from '../../../services/employee.service';

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
    if (this.form.invalid) return;

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

  eliminar(): void {
    if (confirm('¿Estás seguro de eliminar a esta profesional?')) {
      this.employeeService.deleteEmployee(this.data.employee.id).subscribe(() => {
        this.dialogRef.close(true);
      });
    }
  }
}
