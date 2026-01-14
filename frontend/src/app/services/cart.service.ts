import { Injectable, signal, computed } from '@angular/core';
import { Item } from '../interfaces/interfaces';
import { Client } from './clients.service'; // <--- 1. IMPORTANTE: Importar interfaz Client

export interface CartItem {
  item: Item;
  precioVenta: number;
  cantidad: number;
  subtotal: number;
}

@Injectable({
  providedIn: 'root'
})
export class CartService {
  items = signal<CartItem[]>([]);

  // 2. CAMBIO CLAVE: Ya no guardamos string, guardamos el Objeto Cliente o null
  cliente = signal<Client | null>(null); 

  total = computed(() => {
    return this.items().reduce((acc, current) => acc + current.subtotal, 0);
  });

  contadorItems = computed(() => {
    return this.items().reduce((acc, current) => acc + current.cantidad, 0);
  });

  // 3. CAMBIO CLAVE: Recibimos el objeto completo
  setCliente(c: Client | null) {
    this.cliente.set(c);
  }

  agregar(producto: Item, precioFinal: number) {
    // ... (Tu código de agregar se queda igualito, está perfecto) ...
    const precioVenta = Number(precioFinal);
    const precioProducto = Number(producto.precio);
    const precioValido = Number.isFinite(precioVenta) ? precioVenta : (Number.isFinite(precioProducto) ? precioProducto : 0);

    const itemsActuales = this.items();
    const existe = itemsActuales.find(i => i.item.id === producto.id && i.precioVenta === precioValido);

    if (existe) {
      existe.cantidad++;
      existe.subtotal = existe.cantidad * existe.precioVenta;
      this.items.set([...itemsActuales]); 
    } else {
      const nuevoItem: CartItem = {
        item: producto,
        precioVenta: precioValido,
        cantidad: 1,
        subtotal: precioValido
      };
      this.items.set([...itemsActuales, nuevoItem]);
    }
    console.log('🛒 Carrito:', this.items());
  }

  limpiarCarrito() {
    this.items.set([]);
    this.cliente.set(null); // Limpiamos el objeto
  }
}