import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

interface TicketItem {
  nombre: string;
  cantidad: number;
  precio: number;
  subtotal: number;
}

export interface TicketData {
  fecha: Date;
  cliente: string;
  identificacion?: string;
  items: TicketItem[];
  total: number;
  businessName?: string;
  businessRuc?: string;
  businessAddress?: string;
  businessPhone?: string;
  taxRate?: number; // Puede ser 0, 0.12, 0.15 o undefined
}

@Component({
  selector: 'app-ticket-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule],
  templateUrl: './ticket-dialog.html',
  styleUrl: './ticket-dialog.scss'
})
export class TicketDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<TicketDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: TicketData
  ) {}

  imprimir() {
    window.print();
  }

  cerrar() {
    this.dialogRef.close();
  }

  // ✅ CORRECCIÓN EN EL CÁLCULO
  get subtotal(): number {
    // Si taxRate viene (incluso si es 0), lo usamos.
    // Solo si es null/undefined usamos 0.15 (para compatibilidad con ventas viejas)
    const rate = this.data.taxRate ?? 0.15; 
    
    const divisor = 1 + rate;
    return this.redondear(this.data.total / divisor);
  }

  get iva(): number {
    return this.redondear(this.data.total - this.subtotal);
  }

  private redondear(valor: number): number {
    return Math.round((Number(valor) || 0) * 100) / 100;
  }
}