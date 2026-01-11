import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog } from '@angular/material/dialog'; // <--- Importamos Dialog
import { CartService } from '../../services/cart.service';
import { CartDetailComponent } from '../cart-detail/cart-detail'; // <--- Importamos el detalle

@Component({
  selector: 'app-cart-footer',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './cart-footer.html',
  styleUrl: './cart-footer.scss'
})
export class CartFooterComponent {
  public cartService = inject(CartService);
  private dialog = inject(MatDialog); // <--- Inyectamos

  verTicket() {
    // ABRIMOS LA VENTANA DEL CARRITO
    this.dialog.open(CartDetailComponent, {
      width: '95vw', // Que ocupe casi todo el ancho del celular
      maxWidth: '400px',
      maxHeight: '90vh' // Que sea alto
    });
  }
}