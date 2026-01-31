import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field'; // Nuevo
import { MatInputModule } from '@angular/material/input';         // Nuevo
import { MatButtonModule } from '@angular/material/button';       // Nuevo
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartData, Chart, registerables } from 'chart.js';
import { ReportsService } from '../../../services/reports.service';

Chart.register(...registerables);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatCardModule, 
    MatButtonToggleModule, 
    MatIconModule, 
    BaseChartDirective,
    MatFormFieldModule, // Necesario para inputs de fecha
    MatInputModule,
    MatButtonModule
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class DashboardComponent implements OnInit {
  private reportsService = inject(ReportsService);

  // 1. AHORA SOPORTAMOS MÁS PERIODOS
  periodo = signal<'today' | 'month' | 'year' | 'custom'>('today'); // 'today' por defecto

  // 2. VARIABLES PARA RANGO PERSONALIZADO
  customFrom = signal<string>('');
  customTo = signal<string>('');

  // DATOS FINANCIEROS
  totalVentas = signal(0);
  totalGastos = signal(0);
  
  utilidadNeta = computed(() => this.totalVentas() - this.totalGastos());
  margenRentabilidad = computed(() => {
    return this.totalVentas() > 0 ? ((this.utilidadNeta() / this.totalVentas()) * 100) : 0;
  });

  pieChartData: ChartData<'doughnut'> = { labels: [], datasets: [] };
  pieChartOptions: ChartConfiguration['options'] = { 
    responsive: true, 
    maintainAspectRatio: false, 
    plugins: { 
      legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } } 
    } 
  };

  ngOnInit() {
    // Inicializar fechas personalizadas con HOY por si acaso
    const today = new Date().toLocaleDateString('en-CA');
    this.customFrom.set(today);
    this.customTo.set(today);

    this.cargarDatos();
  }

  cargarDatos() {
    const now = new Date();
    let startStr = '', endStr = '';

    // --- LÓGICA DE FECHAS MEJORADA ---
    if (this.periodo() === 'today') {
        // Hoy (00:00 a 23:59)
        startStr = now.toLocaleDateString('en-CA');
        endStr = now.toLocaleDateString('en-CA');

    } else if (this.periodo() === 'month') {
        // Mes Actual (1 al 30/31)
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        startStr = start.toLocaleDateString('en-CA');
        endStr = end.toLocaleDateString('en-CA');

    } else if (this.periodo() === 'year') {
        // Año Actual
        startStr = `${now.getFullYear()}-01-01`;
        endStr = `${now.getFullYear()}-12-31`;

    } else if (this.periodo() === 'custom') {
        // Rango Personalizado (lo que diga el input)
        startStr = this.customFrom();
        endStr = this.customTo();
    }

    // 1. Traer Ventas
    this.reportsService.getByRange(startStr, endStr).subscribe({
        next: (ventas) => {
            const total = (ventas || []).reduce((acc: number, curr: any) => acc + Number(curr.total), 0);
            this.totalVentas.set(total);
        },
        error: (err) => console.error(err)
    });

    // 2. Traer Gastos y pintar Gráfico
    this.reportsService.getExpenses(startStr, endStr).subscribe({
        next: (gastos) => {
            const total = (gastos || []).reduce((acc: number, curr: any) => acc + Number(curr.monto), 0);
            this.totalGastos.set(total);
            this.actualizarGrafico(gastos || []);
        },
        error: (err) => console.error(err)
    });
  }

  actualizarGrafico(gastos: any[]) {
    const categorias: Record<string, number> = {};
    
    if (gastos.length === 0) {
        this.pieChartData = { labels: [], datasets: [] };
        return;
    }

    gastos.forEach(g => {
        let cat = g.categoria || 'OTROS';
        cat = cat.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (l:string)=>l.toUpperCase());
        categorias[cat] = (categorias[cat] || 0) + Number(g.monto);
    });

    this.pieChartData = {
        labels: Object.keys(categorias),
        datasets: [{
            data: Object.values(categorias),
            backgroundColor: ['#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#00bcd4'],
            hoverOffset: 10,
            borderWidth: 0
        }]
    };
  }
}