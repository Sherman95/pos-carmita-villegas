/* src/app/components/price-dialog/price-dialog.ts */
import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon'; // <--- 1. IMPORTANTE: Agregado

@Component({
  selector: 'app-price-dialog',
  standalone: true,
  imports: [
    CommonModule, 
    MatDialogModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatButtonModule, 
    FormsModule,
    MatIconModule // <--- 2. IMPORTANTE: Agregado a la lista de imports
  ],
  templateUrl: './price-dialog.html',
  styleUrl: './price-dialog.scss'
})
export class PriceDialogComponent {
  precioFinal: number;

  constructor(
    public dialogRef: MatDialogRef<PriceDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: { nombre: string, precioBase: number }
  ) {
    // Al abrir la ventana, mostramos el precio original sugerido
    this.precioFinal = data.precioBase;
  }

  cancelar(): void {
    this.dialogRef.close();
  }

  confirmar(): void {
    const valor = Number(this.precioFinal);
    this.dialogRef.close(Number.isFinite(valor) ? valor : this.data.precioBase);
  }
}