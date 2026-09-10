import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTableModule } from '@angular/material/table';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { EmployeeService, Employee } from '../../services/employee.service';
import { EmployeeDialogComponent } from './employee-dialog/employee-dialog';

@Component({
  selector: 'app-employees',
  standalone: true,
  imports: [CommonModule, MatTableModule, MatButtonModule, MatIconModule, MatDialogModule],
  templateUrl: './employees.html',
  styleUrls: ['./employees.scss']
})
export class EmployeesComponent implements OnInit {
  displayedColumns: string[] = ['nombre', 'telefono', 'acciones'];
  dataSource: Employee[] = [];

  constructor(private employeeService: EmployeeService, private dialog: MatDialog) {}

  ngOnInit(): void {
    this.loadEmployees();
  }

  loadEmployees() {
    this.employeeService.getEmployees().subscribe(data => {
      setTimeout(() => {
        this.dataSource = data;
      }, 0);
    });
  }

  openDialog(employee?: Employee) {
    const dialogRef = this.dialog.open(EmployeeDialogComponent, {
      width: '400px',
      data: { employee: employee || null }
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result) {
        this.loadEmployees();
      }
    });
  }
}
