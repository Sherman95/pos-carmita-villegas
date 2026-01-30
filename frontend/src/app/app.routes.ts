import { Routes } from '@angular/router';
import { CatalogComponent } from './components/catalog/catalog';
import { SalesHistoryComponent } from './components/sales-history/sales-history';
import { ReportsComponent } from './components/reports/reports';
import { ClientsComponent } from './components/clients/clients';
import { HomeComponent } from './components/home/home';
import { LoginComponent } from './components/login/login';
import { ProfileComponent } from './components/profile/profile';
import { authGuard } from './services/auth.guard';
import { FiadosComponent } from './components/fiados/fiados';
import { ExpensesComponent } from './components/expenses/expenses';
import { CashControlComponent } from './components/cash-control/cash-control';
import { CashHistoryComponent } from './components/cash-history/cash-history';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  { path: 'catalog', component: CatalogComponent, canActivate: [authGuard] },
  { path: 'history', component: SalesHistoryComponent, canActivate: [authGuard] },
  { path: 'reports', component: ReportsComponent, canActivate: [authGuard] },
  { path: 'clients', component: ClientsComponent, canActivate: [authGuard] },
  { path: 'fiados', component: FiadosComponent, canActivate: [authGuard] },
  { path: 'profile', component: ProfileComponent, canActivate: [authGuard] },
  { path: 'expenses', component: ExpensesComponent, canActivate: [authGuard] },
  { path: 'cash-control', component: CashControlComponent, canActivate: [authGuard] },
  { path: 'cash-history', component: CashHistoryComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];