import { Component , ChangeDetectionStrategy } from '@angular/core';

import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';

import { DashboardComponent } from './dashboard/dashboard'; 
import { SalesListComponent } from './sales-list/sales-list'; // <--- OJO AQUI
import { TopAnalyticsComponent } from './top-analytics/top-analytics';

@Component({
  selector: 'app-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatTabsModule,
    MatIconModule,
    DashboardComponent,
    SalesListComponent,
    TopAnalyticsComponent
],
  templateUrl: './reports.html',
  styleUrl: './reports.scss'
})
export class ReportsComponent {
  activeTabIndex = 0; 
}