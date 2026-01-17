import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http'; // 👈 1. Necesitamos HTTP
import { Item } from '../interfaces/interfaces';
import { Client } from './clients.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment'; // 👈 2. La URL de la API

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
  // Inyecciones
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  items = signal<CartItem[]>([]);
  cliente = signal<Client | null>(null);

  // ✅ CÁLCULO VIVO DEL IVA (Tu lógica maestra)
  taxRate = computed(() => {
    const user = this.auth.currentUser();
    return Number(user?.tax_rate) || 0; 
  });

  total = computed(() => {
    return this.items().reduce((acc, current) => acc + current.subtotal, 0);
  });

  baseImponible = computed(() => {
    const total = this.total();
    const tasa = this.taxRate();
    if (tasa === 0) return total;
    return total / (1 + tasa);
  });

  iva = computed(() => {
    return this.total() - this.baseImponible();
  });

  contadorItems = computed(() => {
    return this.items().reduce((acc, current) => acc + current.cantidad, 0);
  });

  // 🔥 AQUÍ ESTÁ LA MAGIA QUE FALTABA 🔥
  // Esta función empaqueta todo y se lo manda al backend
  confirmSale(metodoPago: string = 'EFECTIVO') {
    const payload = {
      items: this.items(),
      total: this.total(),
      metodo_pago: metodoPago,
      client_id: this.cliente()?.id || null,
      
      // 👇 ¡ESTA ES LA LÍNEA DE ORO! 👇
      // Enviamos explícitamente la tasa que usó este carrito (0, 0.12 o 0.15)
      tax_rate: this.taxRate() 
    };

    return this.http.post(this.apiUrl, payload);
  }

  setCliente(c: Client | null) {
    this.cliente.set(c);
  }

  agregar(producto: Item, precioFinal: number) {
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
  }

  limpiarCarrito() {
    this.items.set([]);
    this.cliente.set(null);
  }
}