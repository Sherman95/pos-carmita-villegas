import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./components/login/login').then((m) => m.LoginComponent) },
  { path: '', loadComponent: () => import('./components/home/home').then((m) => m.HomeComponent), canActivate: [authGuard] },
  { path: 'catalog', loadComponent: () => import('./components/catalog/catalog').then((m) => m.CatalogComponent), canActivate: [authGuard] },
  { path: 'history', loadComponent: () => import('./components/sales-history/sales-history').then((m) => m.SalesHistoryComponent), canActivate: [authGuard] },
  { path: 'reports', loadComponent: () => import('./components/reports/reports').then((m) => m.ReportsComponent), canActivate: [authGuard] },
  { path: 'clients', loadComponent: () => import('./components/clients/clients').then((m) => m.ClientsComponent), canActivate: [authGuard] },
  { path: 'fiados', loadComponent: () => import('./components/fiados/fiados').then((m) => m.FiadosComponent), canActivate: [authGuard] },
  { path: 'profile', loadComponent: () => import('./components/profile/profile').then((m) => m.ProfileComponent), canActivate: [authGuard] },
  { path: 'expenses', loadComponent: () => import('./components/expenses/expenses').then((m) => m.ExpensesComponent), canActivate: [authGuard] },
  { path: 'cash-control', loadComponent: () => import('./components/cash-control/cash-control').then((m) => m.CashControlComponent), canActivate: [authGuard] },
  { path: 'cash-history', loadComponent: () => import('./components/cash-history/cash-history').then((m) => m.CashHistoryComponent), canActivate: [authGuard] },
  { path: 'citas', loadComponent: () => import('./components/appointments/appointments').then((m) => m.AppointmentsComponent), canActivate: [authGuard] },
  { path: 'profesionales', loadComponent: () => import('./components/employees/employees').then((m) => m.EmployeesComponent), canActivate: [authGuard] },
  { path: 'settings', loadComponent: () => import('./components/settings/settings').then((m) => m.SettingsComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
