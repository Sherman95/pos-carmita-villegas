import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Item } from '../interfaces/interfaces';
import { Client } from './clients.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

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
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  items = signal<CartItem[]>([]);

  // ⚡ TRUCO MAESTRO:
  // Copiamos el ID que nos dio tu consulta SQL. 
  // Así el sistema arranca con el cliente LISTO, sin esperar a internet.
  private defaultClient: Client = {
    id: '1cb8e91a-3620-4bc5-bda9-6c670ac563b2', // ID DE PRODUCCIÓN
    nombre: 'Consumidor Final',
    cedula: '9999999999', // 👈 ¡ACTUALIZADO A 10 DÍGITOS!
    direccion: 'S/D',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Inicializamos la señal DIRECTAMENTE con el cliente real
  cliente = signal<Client | null>(this.defaultClient);

  constructor() {
    // Ya no necesitamos llamar a cargarConsumidorFinal() aquí obligatoriamente
    // porque ya lo tenemos "quemado" y listo para usar.
    console.log('🚀 Carrito listo con Consumidor Final (ID Fijo)');
  }

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

 confirmSale(metodoPago: string = 'EFECTIVO') {
    let clienteIdFinal = this.cliente()?.id;

    if (!clienteIdFinal || clienteIdFinal === 'temp-id') {
      clienteIdFinal = '51ba64a6-8b6a-4a4b-a70e-1f4042c1f32d';
    }

    const payload = {
      items: this.items(),
      total: this.total(),
      metodo_pago: metodoPago,
      client_id: clienteIdFinal,
      tax_rate: this.taxRate() 
    };

    // 🕵️‍♂️ ¡EL CHIVATO! Míralo en la consola del navegador (F12)
    console.log('📦 PAYLOAD QUE SALE:', payload); 

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
    // Al limpiar, volvemos INMEDIATAMENTE al ID real fijo
    this.cliente.set(this.defaultClient);
  }
}