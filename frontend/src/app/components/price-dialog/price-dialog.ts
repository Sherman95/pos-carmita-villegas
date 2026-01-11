import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-price-dialog',
  standalone: true,
  imports: [
    CommonModule, 
    MatDialogModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatButtonModule, 
    FormsModule
  ],
  templateUrl: './price-dialog.html', // Coincide con tu foto
  styleUrl: './price-dialog.scss'     // Coincide con tu foto
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
    this.dialogRef.close(); // Cierra sin hacer nada
  }

  confirmar(): void {
    // Cierra y envía el precio nuevo al carrito
    const valor = Number(this.precioFinal);
    this.dialogRef.close(Number.isFinite(valor) ? valor : this.data.precioBase);
  }
}