import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

import { DashboardComponent } from './dashboard/dashboard'; 
import { SalesListComponent } from './sales-list/sales-list'; // <--- OJO AQUI

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [
    CommonModule, MatTabsModule, MatIconModule,
    DashboardComponent,
    SalesListComponent // <--- Y AQUI
  ],
  templateUrl: './reports.html',
  styleUrl: './reports.scss'
})
export class ReportsComponent {
  activeTabIndex = 0; 
}