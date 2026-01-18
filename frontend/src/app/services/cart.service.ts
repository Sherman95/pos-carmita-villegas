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
  private clientsUrl = `${environment.apiBaseUrl}/api/clients`; // ✅ URL para buscar clientes

  items = signal<CartItem[]>([]);
  cliente = signal<Client | null>(null);

  // Variable para guardar al Consumidor Final y no buscarlo a cada rato
  private consumidorFinalDefault: Client | null = null;

  constructor() {
    // 🚀 AL INICIAR: Buscamos automáticamente al Consumidor Final
    this.cargarConsumidorFinal();
  }

  // 👇 ESTA ES LA FUNCIÓN NUEVA
  cargarConsumidorFinal() {
    this.http.get<Client[]>(this.clientsUrl).subscribe({
      next: (clientes) => {
        // Buscamos al dueño del RUC 999...
        const cf = clientes.find(c => c.cedula === '9999999999999');
        if (cf) {
          this.consumidorFinalDefault = cf;
          this.cliente.set(cf); // ✅ ¡Asignado automáticamente al iniciar!
          console.log('✅ Carrito inicializado con:', cf.nombre);
        }
      },
      error: (err) => console.error('Error cargando cliente por defecto', err)
    });
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
    const payload = {
      items: this.items(),
      total: this.total(),
      metodo_pago: metodoPago,
      client_id: this.cliente()?.id || null, // Ahora esto llevará el ID real del 999...
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
    
    // 🧠 LOGICA INTELIGENTE:
    // Si tenemos guardado al consumidor final, lo volvemos a poner por defecto.
    // Si no, ponemos null.
    if (this.consumidorFinalDefault) {
      this.cliente.set(this.consumidorFinalDefault);
    } else {
      this.cliente.set(null);
    }
  }
}