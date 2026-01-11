import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { CartService } from '../../services/cart.service';
import { SalesService } from '../../services/sales.service';
import { TicketDialogComponent, TicketData } from '../ticket-dialog/ticket-dialog';

@Component({
  selector: 'app-cart-detail',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, MatListModule],
  templateUrl: './cart-detail.html',
  styleUrl: './cart-detail.scss'
})
export class CartDetailComponent { // <--- AQUÍ ESTÁ LA CLAVE
  public cartService = inject(CartService);
  private salesService = inject(SalesService);
  private dialog = inject(MatDialog);
  
  constructor(public dialogRef: MatDialogRef<CartDetailComponent>) {}

  cerrar() {
    this.dialogRef.close();
  }

  eliminar(index: number) {
    const items = this.cartService.items();
    items.splice(index, 1);
    this.cartService.items.set([...items]);
    
    if (items.length === 0) {
      this.cerrar();
    }
  }

  cobrar() {
    if (this.cartService.items().length === 0) return;

    const itemsSnapshot = [...this.cartService.items()];
    const totalSnapshot = this.cartService.total();

    const venta = {
      total: totalSnapshot,
      metodo_pago: 'EFECTIVO',
      client_id: this.cartService.clienteId(),
      items: this.cartService.items()
    };

    this.salesService.saveSale(venta).subscribe({
      next: (res: any) => {
        alert('✅ ¡Venta registrada correctamente!');

        const ticketData: TicketData = {
          fecha: new Date(),
          cliente: 'Consumidor Final',
          identificacion: '9999999999999',
          items: itemsSnapshot.map((i) => ({
            nombre: i.item.nombre,
            cantidad: i.cantidad,
            precio: i.precioVenta,
            subtotal: i.subtotal
          })),
          total: Number(totalSnapshot) || 0
        };

        this.dialog.open(TicketDialogComponent, { data: ticketData, maxWidth: '380px' });

        this.cartService.limpiarCarrito();
        this.cerrar();
      },
      error: (err: any) => {
        console.error('Error al guardar:', err);
        alert('❌ Ocurrió un error al guardar la venta.');
      }
    });
  }
}