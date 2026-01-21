import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Item } from '../interfaces/interfaces';
import { Client } from './clients.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

// 1. DEFINIMOS LOS TIPOS DE PAGO PERMITIDOS
export type TipoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'CREDITO';

export interface CartItem {
  item: Item;
  precioVenta: number;
  cantidad: number;
  subtotal: number;
}

// 2. CONSTANTE DEL ID "CONSUMIDOR FINAL" (Para no equivocarnos nunca)
// Este ID debe coincidir con el que tienes en tu Base de Datos Supabase
const ID_CONSUMIDOR_FINAL = '51ba64a6-8b6a-4a4b-a70e-1f4042c1f32d';

@Injectable({
  providedIn: 'root'
})
export class CartService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  
  private apiUrl = `${environment.apiBaseUrl}/api/sales`;

  items = signal<CartItem[]>([]);

  // Configuración inicial del Cliente por Defecto
  private defaultClient: Client = {
    id: ID_CONSUMIDOR_FINAL, // 👈 Usamos la constante unificada
    nombre: 'Consumidor Final',
    cedula: '9999999999',
    direccion: 'S/D',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // Inicializamos la señal
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

  // --- LÓGICA DE VENTA ACTUALIZADA ---
  
  // Ahora aceptamos el tipo de pago y el abono inicial
  confirmSale(tipoPago: TipoPago = 'EFECTIVO', abonoInicial: number = 0) {
    let clienteActual = this.cliente();

    // Asegurarnos de tener un ID válido
    let clienteIdFinal = clienteActual?.id;
    if (!clienteIdFinal || clienteIdFinal === 'temp-id') {
      clienteIdFinal = ID_CONSUMIDOR_FINAL;
    }

    // ⛔ REGLA DE ORO: BLOQUEO DE CRÉDITO ANÓNIMO
    // Si intentan dar CREDITO a Consumidor Final, detenemos todo aquí.
    if (tipoPago === 'CREDITO' && clienteIdFinal === ID_CONSUMIDOR_FINAL) {
      // Lanzamos un error que capturará el componente (y mostrará SweetAlert)
      throw new Error('NO_CREDIT_CF'); 
    }

    // Construimos el paquete de datos para el Backend
    const payload = {
      items: this.items(),
      total: this.total(),
      client_id: clienteIdFinal,
      tax_rate: this.taxRate(),
      
      // 👇 CAMPOS NUEVOS PARA LA BD
      tipo_pago: tipoPago,      // 'EFECTIVO', 'TRANSFERENCIA' o 'CREDITO'
      abono_inicial: abonoInicial // Cuánto dinero entra a caja realmente
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
    // Al limpiar, volvemos al Consumidor Final por defecto
    this.cliente.set(this.defaultClient);
  }
}