import { Routes } from '@angular/router';
import { authGuard } from './services/auth.guard';
import { permissionGuard } from './services/permission.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./components/login/login').then((m) => m.LoginComponent) },
  { path: '', loadComponent: () => import('./components/home/home').then((m) => m.HomeComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['sales.create'] } },
  { path: 'catalog', loadComponent: () => import('./components/catalog/catalog').then((m) => m.CatalogComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['catalog.read'] } },
  { path: 'history', loadComponent: () => import('./components/sales-history/sales-history').then((m) => m.SalesHistoryComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['sales.read'] } },
  { path: 'reports', loadComponent: () => import('./components/reports/reports').then((m) => m.ReportsComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['reports.read'] } },
  { path: 'clients', loadComponent: () => import('./components/clients/clients').then((m) => m.ClientsComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['clients.read'] } },
  { path: 'fiados', loadComponent: () => import('./components/fiados/fiados').then((m) => m.FiadosComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['sales.read'] } },
  { path: 'profile', loadComponent: () => import('./components/profile/profile').then((m) => m.ProfileComponent), canActivate: [authGuard] },
  { path: 'expenses', loadComponent: () => import('./components/expenses/expenses').then((m) => m.ExpensesComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['expenses.manage'] } },
  { path: 'cash-control', loadComponent: () => import('./components/cash-control/cash-control').then((m) => m.CashControlComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['cash.operate'] } },
  { path: 'cash-history', loadComponent: () => import('./components/cash-history/cash-history').then((m) => m.CashHistoryComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['cash.history'] } },
  { path: 'citas', loadComponent: () => import('./components/appointments/appointments').then((m) => m.AppointmentsComponent), canActivate: [authGuard, permissionGuard], data: { view: 'agenda', permissions: ['appointments.read', 'appointments.read_own'] } },
  { path: 'citas/solicitudes', loadComponent: () => import('./components/appointments/appointments').then((m) => m.AppointmentsComponent), canActivate: [authGuard, permissionGuard], data: { view: 'requests', permissions: ['sidro_requests.manage', 'sidro_requests.manage_own'] } },
  { path: 'profesionales', loadComponent: () => import('./components/employees/employees').then((m) => m.EmployeesComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['employees.read'] } },
  { path: 'settings', loadComponent: () => import('./components/settings/settings').then((m) => m.SettingsComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['integrations.manage'] } },
  { path: 'sidro/requests', redirectTo: 'citas/solicitudes', pathMatch: 'full' },
  { path: 'settings/users', loadComponent: () => import('./components/user-management/user-management').then((m) => m.UserManagementComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['users.read'] } },
  { path: 'sidro/settings', loadComponent: () => import('./components/sidro-settings/sidro-settings.component').then((m) => m.SidroSettingsComponent), canActivate: [authGuard, permissionGuard], data: { permissions: ['sidro_services.configure'] } },
  { path: 'reset-password', loadComponent: () => import('./components/pos-password-reset/pos-password-reset.component').then((m) => m.PosPasswordResetComponent) },
  { path: '**', redirectTo: '' }
];
