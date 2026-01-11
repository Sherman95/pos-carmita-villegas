import { Routes } from '@angular/router';
import { CatalogComponent } from './components/catalog/catalog';
import { SalesHistoryComponent } from './components/sales-history/sales-history';
import { ReportsComponent } from './components/reports/reports';
import { ClientsComponent } from './components/clients/clients';
import { HomeComponent } from './components/home/home';
import { LoginComponent } from './components/login/login';
import { authGuard } from './services/auth.guard';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: '', component: HomeComponent, canActivate: [authGuard] },
  { path: 'catalog', component: CatalogComponent, canActivate: [authGuard] },
  { path: 'history', component: SalesHistoryComponent, canActivate: [authGuard] },
  { path: 'reports', component: ReportsComponent, canActivate: [authGuard] },
  { path: 'clients', component: ClientsComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];