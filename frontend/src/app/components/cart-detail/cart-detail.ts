import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogRef, MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatDividerModule } from '@angular/material/divider';
import { ClientsService, Client } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';
import { SalesService } from '../../services/sales.service';
import { TicketDialogComponent, TicketData } from '../ticket-dialog/ticket-dialog';

@Component({
  selector: 'app-cart-detail',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDividerModule
  ],
  templateUrl: './cart-detail.html',
  styleUrl: './cart-detail.scss'
})
export class CartDetailComponent implements OnInit { // <--- AQUÍ ESTÁ LA CLAVE
  public cartService = inject(CartService);
  private clientsService = inject(ClientsService);
  private salesService = inject(SalesService);
  private dialog = inject(MatDialog);

  clients = signal<Client[]>([]);
  selectedClientId = signal<string>('anon');
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
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
    });
  }

  onClienteChange(id: string) {
    this.selectedClientId.set(id);
    this.cartService.setCliente(id === 'anon' ? null : id);
  }

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

    const client = this.clients().find((c) => c.id === this.cartService.clienteId());

    const itemsSnapshot = [...this.cartService.items()];
    const totalSnapshot = this.cartService.total();

    const venta = {
      total: totalSnapshot,
      metodo_pago: 'EFECTIVO',
      client_id: this.cartService.clienteId(),
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
          total: Number(totalSnapshot) || 0
        };

        this.dialog.open(TicketDialogComponent, { data: ticketData, maxWidth: '380px' });

        this.cartService.limpiarCarrito();
        this.cerrar();
      },
      error: (err: any) => {
        console.error('Error al guardar:', err);
        alert('❌ Ocurrió un error al guardar la venta.');
      }
    });
  }
}