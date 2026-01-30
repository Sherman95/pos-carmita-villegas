import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable } from '@angular/core/rxjs-interop'; // Opcional si usas observables en HTML
import { Item } from '../interfaces/interfaces';
import { Client } from './clients.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { of } from 'rxjs'; // Para compatibilidad con async pipe

// 1. DEFINIMOS LOS TIPOS DE PAGO PERMITIDOS
export type TipoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'CREDITO';

export interface CartItem {
  item: Item;
  precioVenta: number;
  cantidad: number;
  subtotal: number;
}

const ID_CONSUMIDOR_FINAL = '51ba64a6-8b6a-4a4b-a70e-1f4042c1f32d';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  items = signal<CartItem[]>([]);

  private defaultClient: Client = {
    id: ID_CONSUMIDOR_FINAL,
    nombre: 'Consumidor Final',
    cedula: '9999999999',
    direccion: 'S/D',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  cliente = signal<Client | null>(this.defaultClient);

  constructor() {
    console.log('🚀 Carrito listo con Consumidor Final:', ID_CONSUMIDOR_FINAL);
  }

  // --- CÁLCULOS (COMPUTED) ---
  taxRate = computed(() => {
    const user = this.auth.currentUser();
    return Number(user?.tax_rate) || 0; 
  });

  total = computed(() => {
    return this.items().reduce((acc, current) => acc + current.subtotal, 0);
  });

  // 👇 GETTER DE COMPATIBILIDAD 1: Para validar en el .ts (if totalValue <= 0)
  get totalValue() {
    return this.total();
  }

  // 👇 GETTER DE COMPATIBILIDAD 2: Para el HTML (async pipe)
  get total$() {
    return of(this.total());
  }

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

  // --- LÓGICA DE VENTA (Renombrada a 'checkout' para coincidir con el componente) ---
  
  checkout(
    clientId: string, 
    tipoPago: string, 
    taxRate: number, 
    abonoInicial: number = 0
  ) {
    
    // ⛔ REGLA DE ORO: BLOQUEO DE CRÉDITO ANÓNIMO
    if (tipoPago === 'CREDITO' && clientId === ID_CONSUMIDOR_FINAL) {
      throw new Error('NO_CREDIT_CF'); 
    }

    const payload = {
      items: this.items(),
      total: this.total(),
      client_id: clientId,
      tax_rate: taxRate,
      
      // 👇 CAMPOS IMPORTANTES QUE AHORA EL BACKEND ESPERA
      tipo_pago: tipoPago,      
      abono_inicial: abonoInicial 
    };

    console.log('📦 ENVIANDO VENTA:', payload); 

    return this.http.post(this.apiUrl, payload);
  }

  // --- MÉTODOS AUXILIARES ---

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
    this.cliente.set(this.defaultClient);
  }
  
  // Alias para mantener compatibilidad si algún otro archivo llama a clearCart
  clearCart() {
    this.limpiarCarrito();
  }
}