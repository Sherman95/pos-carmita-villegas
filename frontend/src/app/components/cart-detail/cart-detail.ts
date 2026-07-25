import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDividerModule } from '@angular/material/divider';

// SERVICIOS
import { ClientsService, Client } from '../../services/clients.service';
import { CartService, TipoPago } from '../../services/cart.service'; 
import { SettingsService } from '../../services/settings.service';

// COMPONENTES Y LIBRERÍAS
import { TicketDialogComponent, TicketData } from '../ticket-dialog/ticket-dialog';
import Swal from 'sweetalert2'; 

// ID FIJO DE CONSUMIDOR FINAL (Mismo de la BD)
const ID_CONSUMIDOR_FINAL = '51ba64a6-8b6a-4a4b-a70e-1f4042c1f32d';

@Component({
  selector: 'app-cart-detail',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatInputModule,
    MatAutocompleteModule,
    MatFormFieldModule,
    MatDividerModule
  ],
  templateUrl: './cart-detail.html',
  styleUrl: './cart-detail.scss'
})
export class CartDetailComponent implements OnInit {
  public cartService = inject(CartService);
  private clientsService = inject(ClientsService);
  private settingsService = inject(SettingsService);
  private dialog = inject(MatDialog);

  // SEÑALES
  clients = signal<Client[]>([]);
  searchText = signal('');
  selectedClientId = signal<string>('anon');

  // 💰 VARIABLES DE PAGO
  selectedPayment: TipoPago = 'EFECTIVO'; 
  abonoAmount: number = 0; 

  // COMPUTADAS
  subtotal = computed(() => this.cartService.total());
  taxRate = computed(() => this.settingsService.settings().taxRate ?? 0);
  taxAmount = computed(() => this.subtotal() * this.taxRate());
  grandTotal = computed(() => this.subtotal() + this.taxAmount());

  // FILTRO CLIENTES
  filteredClients = computed(() => {
    const term = this.searchText().toLowerCase().trim();
    if (!term) return this.clients();
    return this.clients().filter((c) =>
      (c.nombre || '').toLowerCase().includes(term) ||
      (c.cedula || '').toLowerCase().includes(term)
    );
  });

  clienteLabel = computed(() => {
    const id = this.selectedClientId();
    if (!id || id === 'anon' || id === ID_CONSUMIDOR_FINAL) return 'Consumidor Final';
    const client = this.clients().find((c) => c.id === id);
    return client ? client.nombre : 'Cliente seleccionado';
  });

  constructor(public dialogRef: MatDialogRef<CartDetailComponent>) {}

  ngOnInit(): void {
    const clienteActual = this.cartService.cliente();
    const cid = clienteActual ? clienteActual.id : null;
    
    // Si es null o temp-id, asumimos Consumidor Final
    if (!cid || cid === 'temp-id') {
        this.selectedClientId.set(ID_CONSUMIDOR_FINAL);
    } else {
        this.selectedClientId.set(cid);
    }
    
    this.cargarClientes();
  }

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => {
        this.clients.set(data || []);
        this.inicializarTextoBuscador();
      },
      error: (err) => console.error('Error cargando clientes', err)
    });
  }

  inicializarTextoBuscador() {
    const currentId = this.selectedClientId();
    if (currentId === ID_CONSUMIDOR_FINAL || currentId === 'anon') {
      this.searchText.set('Consumidor Final');
    } else {
      const client = this.clients().find(c => c.id === currentId);
      if (client) this.searchText.set(client.nombre);
    }
  }

  onOptionSelected(event: any) {
    const selectedValue = event.option.value; 
    
    if (selectedValue === 'anon' || selectedValue.id === ID_CONSUMIDOR_FINAL) {
      this.selectedClientId.set(ID_CONSUMIDOR_FINAL);
      this.cartService.setCliente(null);
      this.searchText.set('Consumidor Final');
      
      // ⚠️ Si cambiamos a Consumidor Final y estaba en CRÉDITO, lo pasamos a EFECTIVO
      if (this.selectedPayment === 'CREDITO') {
        this.selectedPayment = 'EFECTIVO';
      }

    } else {
      this.selectedClientId.set(selectedValue.id);
      this.cartService.setCliente(selectedValue);
      this.searchText.set(selectedValue.nombre);
    }
  }

  limpiarBusqueda(event: Event) {
     this.searchText.set('');
  }

  // ==========================================
  // ⚡ LÓGICA DE COBRO ACTUALIZADA (CORREGIDA)
  // ==========================================

  setMetodo(metodo: TipoPago) {
    this.selectedPayment = metodo;
    if (metodo !== 'CREDITO') {
        this.abonoAmount = 0;
    }
  }

  cobrar() {
    // 0. Validar carrito vacío
    if (this.cartService.totalValue <= 0) { // Usamos el getter de compatibilidad
        Swal.fire('Error', 'El carrito está vacío', 'warning');
        return;
    }

    // 1. VALIDACIÓN VISUAL EXTRA
    if (this.selectedPayment === 'CREDITO' && this.selectedClientId() === ID_CONSUMIDOR_FINAL) {
        Swal.fire('Acción Bloqueada', 'No puedes fiar a Consumidor Final. Selecciona un cliente real.', 'warning');
        return;
    }

    // 2. VALIDACIÓN DEL ABONO (Nueva)
    if (this.selectedPayment === 'CREDITO') {
        if (this.abonoAmount < 0) {
            Swal.fire('Error', 'El abono no puede ser negativo', 'warning');
            return;
        }
        if (this.abonoAmount > this.grandTotal()) {
            Swal.fire('Error', 'El abono no puede ser mayor al total', 'warning');
            return;
        }
    }

    // 3. USAMOS LA NUEVA FUNCIÓN 'checkout' DEL SERVICIO
    // Pasamos los 4 argumentos: ID, Tipo, Tasa, Abono
    this.cartService.checkout(
        this.selectedClientId(), 
        this.selectedPayment, 
        this.taxRate(),
        this.abonoAmount
    ).subscribe({
      next: () => {
        
        // ÉXITO
        Swal.fire({
            title: '¡Venta Exitosa!',
            text: this.selectedPayment === 'CREDITO' ? 'Crédito registrado correctamente.' : 'Venta cobrada.',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });

        // 4. GENERAR TICKET
        this.generarTicket();
      },
      error: (err: any) => {
        console.error('Error al cobrar:', err);
        if (err.message === 'NO_CREDIT_CF') {
            Swal.fire('Error', 'No se permite Crédito a Consumidor Final.', 'error');
        } else {
            Swal.fire('Error', 'No se pudo registrar la venta.', 'error');
        }
      }
    });
  }

  generarTicket() {
    const client = this.clients().find((c) => c.id === this.selectedClientId());
    const itemsSnapshot = [...this.cartService.items()];
    const finalTotal = this.grandTotal();
    const business = this.settingsService.settings();

    const ticketData: TicketData = {
      fecha: new Date(),
      cliente: client?.nombre || 'Consumidor Final',
      identificacion: client?.cedula || '9999999999',
      items: itemsSnapshot.map((i) => ({
        nombre: i.item.nombre,
        cantidad: i.cantidad,
        precio: i.precioVenta,
        subtotal: i.subtotal
      })),
      total: Number(finalTotal) || 0,
      
      // 👇 CAMPOS NUEVOS (Cruciales para el recibo de crédito)
      tipoPago: this.selectedPayment,
      abono: this.abonoAmount,

      businessName: business.name,
      businessRuc: business.ruc,
      businessAddress: business.address,
      businessPhone: business.phone,
      taxRate: this.taxRate()
    };

    this.dialog.open(TicketDialogComponent, {
      data: ticketData,
      maxWidth: '380px',
      panelClass: 'ticket-dialog'
    });

    this.cartService.limpiarCarrito();
    this.cerrar();
  }

  cerrar() { this.dialogRef.close(); }
  
  eliminar(index: number) {
    const items = this.cartService.items();
    items.splice(index, 1);
    this.cartService.items.set([...items]);
    if (items.length === 0) this.cerrar();
  }
}
