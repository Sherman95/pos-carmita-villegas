import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal , ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { BaseChartDirective } from 'ng2-charts';
import { Chart, ChartConfiguration, ChartData, registerables } from 'chart.js';
import { firstValueFrom } from 'rxjs';
import { ReportsService } from '../../../services/reports.service';

Chart.register(...registerables);

type DashboardPeriod = 'today' | 'month' | 'year' | 'custom';

@Component({
  selector: 'app-dashboard',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonToggleModule, MatIconModule, MatButtonModule, BaseChartDirective],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private requestId = 0;

  periodo = signal<DashboardPeriod>('today');
  customFrom = signal('');
  customTo = signal('');
  totalVentas = signal(0);
  totalGastos = signal(0);
  cantidadVentas = signal(0);
  cantidadGastos = signal(0);
  loading = signal(false);
  errorMessage = signal<string | null>(null);
  rangeLabel = signal('Hoy');
  expenseBreakdown = signal<Array<{ name: string; amount: number; percent: number; color: string }>>([]);

  utilidadNeta = computed(() => this.totalVentas() - this.totalGastos());
  margenRentabilidad = computed(() => this.totalVentas() > 0 ? this.utilidadNeta() / this.totalVentas() * 100 : 0);
  ticketPromedio = computed(() => this.cantidadVentas() > 0 ? this.totalVentas() / this.cantidadVentas() : 0);

  pieChartData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  pieChartOptions: ChartConfiguration<'doughnut'>['options'] = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '62%',
    plugins: { legend: { display: false } }
  };

  ngOnInit(): void {
    const today = this.toDateOnly(new Date());
    this.customFrom.set(today);
    this.customTo.set(today);
    void this.cargarDatos();
  }

  async cargarDatos(): Promise<void> {
    const requestId = ++this.requestId;
    const range = this.getRange();
    if (!range) return;

    this.loading.set(true);
    this.errorMessage.set(null);
    this.rangeLabel.set(this.buildRangeLabel(range.from, range.to));

    try {
      const [ventas, gastos] = await Promise.all([
        firstValueFrom(this.reportsService.getByRange(range.from, range.to)),
        firstValueFrom(this.reportsService.getExpenses(range.from, range.to))
      ]);
      if (requestId !== this.requestId) return;

      this.cantidadVentas.set((ventas || []).length);
      this.cantidadGastos.set((gastos || []).length);
      this.totalVentas.set((ventas || []).reduce((sum: number, sale: any) => sum + Number(sale.total || 0), 0));
      this.totalGastos.set((gastos || []).reduce((sum: number, expense: any) => sum + Number(expense.monto || 0), 0));
      this.actualizarGrafico(gastos || []);
    } catch (error: any) {
      if (requestId === this.requestId) {
        this.errorMessage.set(error?.error?.error || 'No se pudieron cargar los indicadores. Intenta nuevamente.');
      }
    } finally {
      if (requestId === this.requestId) this.loading.set(false);
    }
  }

  private getRange(): { from: string; to: string } | null {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let end = new Date(start);

    if (this.periodo() === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (this.periodo() === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
    } else if (this.periodo() === 'custom') {
      if (!this.customFrom() || !this.customTo()) {
        this.errorMessage.set('Selecciona las fechas Desde y Hasta.');
        return null;
      }
      let from = this.customFrom();
      let to = this.customTo();
      if (to < from) [from, to] = [to, from];
      return { from, to };
    }
    return { from: this.toDateOnly(start), to: this.toDateOnly(end) };
  }

  private actualizarGrafico(gastos: any[]): void {
    const categories: Record<string, number> = {};
    for (const expense of gastos) {
      const name = String(expense.categoria || 'OTROS').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());
      categories[name] = (categories[name] || 0) + Number(expense.monto || 0);
    }

    const labels = Object.keys(categories);
    const values = Object.values(categories);
    const colors = ['#be185d', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#64748b'];
    const total = values.reduce((sum, value) => sum + value, 0);

    this.expenseBreakdown.set(labels.map((name, index) => ({
      name,
      amount: values[index],
      percent: total > 0 ? values[index] / total * 100 : 0,
      color: colors[index % colors.length]
    })).sort((a, b) => b.amount - a.amount));

    this.pieChartData = labels.length ? {
      labels,
      datasets: [{ data: values, backgroundColor: labels.map((_, index) => colors[index % colors.length]), borderWidth: 0, hoverOffset: 7 }]
    } : { labels: [], datasets: [] };
  }

  private toDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private buildRangeLabel(from: string, to: string): string {
    if (from === to) return new Date(`${from}T12:00:00`).toLocaleDateString('es-EC', { dateStyle: 'long' });
    const start = new Date(`${from}T12:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short' });
    const end = new Date(`${to}T12:00:00`).toLocaleDateString('es-EC', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${start} – ${end}`;
  }
}
