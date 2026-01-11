import { Injectable, signal, computed } from '@angular/core';
import { Item } from '../interfaces/interfaces';

// Definimos qué es un renglón del ticket
export interface CartItem {
  item: Item;
  precioVenta: number; // El precio final (puede ser diferente al de lista)
  cantidad: number;
  subtotal: number;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  // 1. La lista de compras (empieza vacía)
  items = signal<CartItem[]>([]);

  // Cliente asociado a la venta (null = consumidor final)
  clienteId = signal<string | null>(null);

  // 2. El TOTAL ($) calculado automáticamente
  total = computed(() => {
    return this.items().reduce((acc, current) => acc + current.subtotal, 0);
  });

  // 3. El contador de items (para el globito rojo)
  contadorItems = computed(() => {
    return this.items().reduce((acc, current) => acc + current.cantidad, 0);
  });

  setCliente(id: string | null) {
    this.clienteId.set(id);
  }

  agregar(producto: Item, precioFinal: number) {
    const itemsActuales = this.items();
    
    // Buscamos si ya existe ese producto CON ESE MISMO PRECIO en el carrito
    const existe = itemsActuales.find(i => i.item.id === producto.id && i.precioVenta === precioFinal);

    if (existe) {
      // Si ya existe, solo sumamos 1 a la cantidad
      existe.cantidad++;
      existe.subtotal = existe.cantidad * existe.precioVenta;
      // Actualizamos la señal (truco para que Angular detecte el cambio profundo)
      this.items.set([...itemsActuales]); 
    } else {
      // Si no existe, agregamos un renglón nuevo
      const nuevoItem: CartItem = {
        item: producto,
        precioVenta: precioFinal,
        cantidad: 1,
        subtotal: precioFinal
      };
      this.items.set([...itemsActuales, nuevoItem]);
    }
    
    console.log('🛒 Carrito actual:', this.items());
  }

  limpiarCarrito() {
    this.items.set([]);
    this.clienteId.set(null);
  }
}