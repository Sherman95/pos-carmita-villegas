import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule, MAT_DATE_LOCALE } from '@angular/material/core';
import { MatBottomSheet, MatBottomSheetModule } from '@angular/material/bottom-sheet'; // 👈 IMPORTANTE

import { CashService } from '../../services/cash'; 
import { CashDetailSheetComponent } from './cash-detail-sheet/cash-detail-sheet'; // 👈 IMPORTA TU COMPONENTE

@Component({
  selector: 'app-cash-history',
  standalone: true,
  providers: [{ provide: MAT_DATE_LOCALE, useValue: 'es-ES' }],
  imports: [
    CommonModule, FormsModule,
    MatTableModule, MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatDatepickerModule, MatNativeDateModule,
    MatBottomSheetModule // 👈 AGREGAR AQUÍ
  ],
  templateUrl: './cash-history.html',
  styleUrls: ['./cash-history.scss']
})
export class CashHistoryComponent implements OnInit {
  private cashService = inject(CashService);
  private bottomSheet = inject(MatBottomSheet); // 👈 INYECCIÓN DEL SERVICIO
  
  // DATOS
  history = signal<any[]>([]);
  
  // FILTROS
  filtroRapido = 'MES';
  fechaInicio: Date | null = null;
  fechaFin: Date | null = null;

  displayedColumns: string[] = ['fecha', 'inicio', 'final', 'diferencia', 'usuario'];

  // TOTALES
  totalMovido = computed(() => this.history().reduce((acc, curr) => acc + Number(curr.monto_final), 0));
  totalDiferencia = computed(() => this.history().reduce((acc, curr) => acc + Number(curr.diferencia), 0));

  ngOnInit() {
    this.aplicarFiltroRapido('MES');
  }

  aplicarFiltroRapido(tipo: string) {
    const hoy = new Date();
    this.filtroRapido = tipo;

    if (tipo === 'HOY') {
        this.fechaInicio = hoy;
        this.fechaFin = hoy;
    } 
    else if (tipo === 'AYER') {
        const ayer = new Date();
        ayer.setDate(hoy.getDate() - 1);
        this.fechaInicio = ayer;
        this.fechaFin = ayer;
    } 
    else if (tipo === 'SEMANA') {
        const primerDia = new Date(hoy.setDate(hoy.getDate() - hoy.getDay() + 1));
        this.fechaInicio = primerDia;
        this.fechaFin = new Date();
    } 
    else if (tipo === 'MES') {
        this.fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        this.fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    }

    if (tipo !== 'CUSTOM') {
        this.buscar();
    }
  }

  buscar() {
    if (!this.fechaInicio || !this.fechaFin) return;

    const fromStr = this.formatDate(this.fechaInicio);
    const toStr = this.formatDate(this.fechaFin);

    this.cashService.getHistory(fromStr, toStr).subscribe({
      next: (data) => this.history.set(data),
      error: (err) => console.error(err)
    });
  }

  private formatDate(date: Date): string {
    const offset = date.getTimezoneOffset();
    date = new Date(date.getTime() - (offset * 60 * 1000));
    return date.toISOString().split('T')[0];
  }

  // 👇 EST// 👇 ASÍ DEBE QUEDAR LA FUNCIÓN
  verDetalle(cierre: any) {
    // 1. Primero pedimos los datos completos al Backend
    this.cashService.getReport(cierre.id).subscribe({
      next: (fullData) => {
        // 2. ¡AHORA SÍ! Abrimos el panel con la data llena (fullData)
        this.bottomSheet.open(CashDetailSheetComponent, {
          data: fullData, // Pasamos lo que llegó del servidor, no lo de la tabla
          panelClass: 'custom-bottom-sheet'
        });
      },
      error: (err) => {
        console.error('Error cargando reporte', err);
        alert('No se pudieron cargar los detalles de este cierre.');
      }
    });
  }
}