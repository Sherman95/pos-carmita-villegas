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

// 👇 AQUÍ ESTÁ LA SOLUCIÓN: Agregamos tipoPago y abono
export interface TicketData {
  fecha: Date;
  cliente: string;
  identificacion?: string;
  items: TicketItem[];
  total: number;
  
  // ✅ ESTOS SON LOS CAMPOS QUE FALTABAN
  tipoPago?: string;  
  abono?: number;     

  businessName?: string;
  businessRuc?: string;
  businessAddress?: string;
  businessPhone?: string;
  taxRate?: number; 
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

  get subtotal(): number {
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