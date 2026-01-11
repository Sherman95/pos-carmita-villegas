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
import { ClientsService, Client } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';
import { SalesService } from '../../services/sales.service';
import { SettingsService } from '../../services/settings.service';
import { TicketDialogComponent, TicketData } from '../ticket-dialog/ticket-dialog';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

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
  private salesService = inject(SalesService);
  private settingsService = inject(SettingsService); // Inyectamos el servicio de configuración
  private dialog = inject(MatDialog);

  // SEÑALES DE ESTADO
  clients = signal<Client[]>([]);
  searchText = signal(''); 
  selectedClientId = signal<string>('anon');

  // ==========================================
  // CÁLCULOS FINANCIEROS (REACTIVOS)
  // ==========================================

  // 1. Subtotal: Suma de los items en el carrito (Base imponible)
  subtotal = computed(() => this.cartService.total());

  // 2. Tasa de Impuesto: Viene del SettingsService (ej: 0.15 para 15%)
  taxRate = computed(() => this.settingsService.settings().taxRate ?? 0);

  // 3. Monto del Impuesto: Subtotal * Tasa
  taxAmount = computed(() => this.subtotal() * this.taxRate());

  // 4. Total Final: Subtotal + Impuestos
  grandTotal = computed(() => this.subtotal() + this.taxAmount());


  // ==========================================
  // LÓGICA DE CLIENTES Y BUSCADOR
  // ==========================================

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
    if (!id || id === 'anon') return 'Consumidor final';
    const client = this.clients().find((c) => c.id === id);
    if (!client) return 'Cliente seleccionado';
    return `${client.nombre}${client.cedula ? ' · ' + client.cedula : ''}`;
  });

  constructor(public dialogRef: MatDialogRef<CartDetailComponent>) {}

  ngOnInit(): void {
    const cid = this.cartService.clienteId();
    this.selectedClientId.set(cid ?? 'anon');
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
    if (currentId && currentId !== 'anon') {
      const client = this.clients().find(c => c.id === currentId);
      if (client) {
        this.searchText.set(client.nombre);
      }
    } else {
        this.searchText.set('Consumidor Final');
    }
  }

  onOptionSelected(event: any) {
    const selectedValue = event.option.value;

    if (selectedValue === 'anon') {
      this.selectedClientId.set('anon');
      this.cartService.setCliente(null);
      this.searchText.set('Consumidor Final');
    } else {
      this.selectedClientId.set(selectedValue.id);
      this.cartService.setCliente(selectedValue.id);
      this.searchText.set(selectedValue.nombre);
    }
  }

  limpiarBusqueda(event: Event) {
      // Opcional: this.searchText.set('');
  }

  // ==========================================
  // ACCIONES DEL CARRITO
  // ==========================================

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

    const client = this.clients().find((c) => c.id === this.selectedClientId());
    const itemsSnapshot = [...this.cartService.items()];
    
    // Obtenemos los valores calculados de las señales
    const finalTotal = this.grandTotal(); 
    const currentTaxRate = this.taxRate();
    const business = this.settingsService.settings();

    const venta = {
      total: finalTotal, // Usamos el total con IVA calculado
      metodo_pago: 'EFECTIVO',
      client_id: this.selectedClientId() === 'anon' ? null : this.selectedClientId(),
      items: this.cartService.items()
    };

    this.salesService.saveSale(venta).subscribe({
      next: (res: any) => {
        alert('✅ ¡Venta registrada correctamente!');

        const ticketData: TicketData = {
          fecha: new Date(),
          cliente: client?.nombre || 'Consumidor Final',
          identificacion: client?.cedula || '9999999999999',
          items: itemsSnapshot.map((i) => ({
            nombre: i.item.nombre,
            cantidad: i.cantidad,
            precio: i.precioVenta,
            subtotal: i.subtotal
          })),
          total: Number(finalTotal) || 0,
          businessName: business.name,
          businessRuc: business.ruc,
          businessAddress: business.address,
          businessPhone: business.phone,
          taxRate: currentTaxRate // Enviamos la tasa de impuesto al ticket
        };

        const dialogRef = this.dialog.open(TicketDialogComponent, {
          data: ticketData,
          maxWidth: '380px',
          panelClass: 'ticket-dialog-capture'
        });

        this.capturarYEnviarTicket(dialogRef, res?.saleId);

        this.cartService.limpiarCarrito();
        this.cerrar();
      },
      error: (err: any) => {
        console.error('Error al guardar:', err);
        alert('❌ Ocurrió un error al guardar la venta.');
      }
    });
  }

  private async capturarYEnviarTicket(dialogRef: any, saleId: string, docType: string = 'receipt') {
    try {
      await dialogRef?.afterOpened().toPromise();
      await new Promise((resolve) => setTimeout(resolve, 60));

      const el = document.querySelector('.ticket-dialog-capture .ticket-paper') as HTMLElement | null;
      if (!el) {
        console.warn('No se encontró el elemento del ticket para capturar.');
        return;
      }

      const canvas = await html2canvas(el, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');
      const mmWidth = canvas.width * 0.264583;
      const mmHeight = canvas.height * 0.264583;
      const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [mmWidth, mmHeight] });
      pdf.addImage(imgData, 'PNG', 0, 0, mmWidth, mmHeight, undefined, 'FAST');

      const dataUri = pdf.output('datauristring');
      const base64 = dataUri.split(',')[1];

      console.log('[capturarYEnviarTicket] saleId:', saleId, 'docType:', docType, 'base64 length:', base64?.length);

      if (saleId && base64) {
        this.salesService.uploadReceipt(saleId, base64, docType).subscribe({
          next: (resp) => console.log('[uploadReceipt] éxito', resp),
          error: (err) => console.error('[uploadReceipt] error', err)
        });
      } else {
        console.warn('[capturarYEnviarTicket] saleId o base64 faltante', { saleId, base64 });
      }
    } catch (err) {
      console.error('Error generando/enviando PDF', err);
    }
  }
}