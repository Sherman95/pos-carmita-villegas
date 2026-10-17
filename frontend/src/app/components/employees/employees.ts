import { Component, OnInit, ChangeDetectorRef , ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { EmployeeService, Employee } from '../../services/employee.service';
import { EmployeeDialogComponent } from './employee-dialog/employee-dialog';

@Component({
  selector: 'app-employees',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [FormsModule, MatTableModule, MatButtonModule, MatIconModule, MatDialogModule],
  templateUrl: './employees.html',
  styleUrls: ['./employees.scss']
})
export class EmployeesComponent implements OnInit {
  displayedColumns: string[] = ['nombre', 'telefono', 'estado', 'acciones'];
  dataSource: Employee[] = [];
  searchTerm = '';
  loading = true;
  loadError = '';

  get filteredEmployees(): Employee[] {
    const query = this.searchTerm.trim().toLocaleLowerCase('es');
    if (!query) return this.dataSource;

    return this.dataSource.filter(employee =>
      employee.nombre.toLocaleLowerCase('es').includes(query) ||
      (employee.telefono || '').toLocaleLowerCase('es').includes(query)
    );
  }

  get activeEmployees(): number {
    return this.dataSource.filter(employee => employee.active !== false).length;
  }

  get employeesWithPhone(): number {
    return this.dataSource.filter(employee => employee.telefono?.trim()).length;
  }

  constructor(private employeeService: EmployeeService, private dialog: MatDialog, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees(): void {
    this.loading = true;
    this.loadError = '';

    this.employeeService.getEmployees().subscribe({
      next: data => {
        this.dataSource = data;
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.loading = false;
        this.loadError = 'No pudimos cargar el equipo. Intenta nuevamente.';
        this.cdr.detectChanges();
      }
    });
  }

  openDialog(employee?: Employee): void {
    const dialogRef = this.dialog.open(EmployeeDialogComponent, {
      width: '520px',
      maxWidth: 'calc(100vw - 24px)',
      panelClass: 'employee-dialog-panel',
      data: { employee: employee || null }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadEmployees();
      }
    });
  }

  employeeInitials(name: string): string {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(part => part.charAt(0))
      .join('')
      .toUpperCase() || 'PR';
  }
}
