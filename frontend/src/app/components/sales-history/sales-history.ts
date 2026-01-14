import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { SalesService } from '../../services/sales.service';
import { ClientsService, Client } from '../../services/clients.service';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { SettingsService } from '../../services/settings.service'; // <--- Importante para datos del perfil

// Importamos el diálogo del ticket (sin .component)
import { MatDialog } from '@angular/material/dialog';
import { TicketDialogComponent, TicketData } from '../ticket-dialog/ticket-dialog';

interface Sale {
  id: string;
  total: number;
  metodo_pago?: string;
  client_id?: string | null;
  client_nombre?: string | null;
  client_cedula?: string | null;
  created_at: string;
}

interface SaleDetail {
  id: string;
  nombre_producto: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

@Component({
  selector: 'app-sales-history',
  standalone: true,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, FormsModule, MatFormFieldModule, MatSelectModule, MatInputModule, MatProgressSpinnerModule,MatTooltipModule],
  templateUrl: './sales-history.html', // <--- ESTO ES LO CORRECTO (No cart-detail.html)
  styleUrl: './sales-history.scss'
})
export class SalesHistoryComponent implements OnInit {
  private salesService = inject(SalesService);
  private clientsService = inject(ClientsService);
  private dialog = inject(MatDialog);
  private settingsService = inject(SettingsService);

  sales = signal<Sale[]>([]);
  selectedSaleId = signal<string | null>(null);
  saleDetails = signal<Record<string, SaleDetail[]>>({});
  loadingDetail = signal<boolean>(false);

  clients = signal<Client[]>([]);
  filterClientId = signal<string>('');
  filterFrom = signal<string>('');
  filterTo = signal<string>('');
  clientReceipts = signal<any[]>([]);
  loadingReceipts = signal<boolean>(false);
  
  openingTicketId = signal<string | null>(null);

  totalHoy = computed(() => {
    const hoy = new Date();
    return this.sales()
      .filter((sale) => {
        const fecha = new Date(sale.created_at);
        return (
          fecha.getFullYear() === hoy.getFullYear() &&
          fecha.getMonth() === hoy.getMonth() &&
          fecha.getDate() === hoy.getDate()
        );
      })
      .reduce((acc, sale) => acc + Number(sale.total || 0), 0);
  });

  ngOnInit(): void {
    this.cargarVentas();
    this.cargarClientes();
  }

  cargarVentas() {
    this.salesService.getSales().subscribe({
      next: (data) => this.sales.set(data),
      error: (err: any) => console.error('Error cargando ventas', err)
    });
  }

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err: any) => console.error('Error cargando clientes', err)
    });
  }

  toggleDetalles(id: string) {
    if (this.selectedSaleId() === id) {
      this.selectedSaleId.set(null);
      return;
    }
    this.selectedSaleId.set(id);
    if (this.saleDetails()[id]) return;
    this.loadingDetail.set(true);
    
    this.salesService.getSaleDetails(id).subscribe({
      next: (data) => {
        this.saleDetails.set({ ...this.saleDetails(), [id]: data.details || [] });
        this.loadingDetail.set(false);
      },
      error: (err: any) => {
        console.error('Error cargando detalle de venta', err);
        this.loadingDetail.set(false);
      }
    });
  }

  formatearHora(fechaIso: string): string {
    const d = new Date(fechaIso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // =========================================================
  // FUNCIÓN MAESTRA: VER RECIBO (Con datos dinámicos)
  // =========================================================
  verRecibo(saleId: string) {
    this.openingTicketId.set(saleId);
    
    // 1. OBTENEMOS LOS DATOS DEL PERFIL DEL NEGOCIO
    const business = this.settingsService.settings(); 

    this.salesService.getSaleDetails(saleId).subscribe({
      next: (resp: any) => {
        
        // 2. MATEMÁTICA DEL IVA (Blindaje)
        let tasaSegura = Number(resp.sale.tax_rate);
        if (isNaN(tasaSegura) || resp.sale.tax_rate === null || resp.sale.tax_rate === undefined) {
            tasaSegura = 0.15; 
        }

        const dataParaTicket: TicketData = {
          fecha: new Date(resp.sale.created_at),
          cliente: resp.sale.client_nombre,
          identificacion: resp.sale.client_cedula,
          total: Number(resp.sale.total),
          taxRate: tasaSegura,

          // 3. DATOS DEL NEGOCIO (Igual que en el carrito)
          businessName: business.name || 'Carmita Villegas',
          businessRuc: business.ruc || '9999999999001',
          businessAddress: business.address || 'Dirección no registrada',
          businessPhone: business.phone || '099 999 9999',

          items: resp.details.map((d: any) => ({
             nombre: d.nombre_producto,
             cantidad: d.cantidad,
             precio: Number(d.precio_unitario),
             subtotal: Number(d.subtotal)
          }))
        };

        this.openingTicketId.set(null);

        // 4. ABRIMOS EL DIÁLOGO
        this.dialog.open(TicketDialogComponent, {
          data: dataParaTicket,
          width: '400px',
          disableClose: false
        });
      },
      error: (err: any) => {
        console.error('Error al abrir recibo', err);
        this.openingTicketId.set(null);
        alert('No se pudo cargar el recibo.');
      }
    });
  }

  buscarRecibosPorCliente() {
    const cid = this.filterClientId();
    if (!cid) {
      this.clientReceipts.set([]);
      return;
    }
    this.loadingReceipts.set(true);
    this.salesService.getReceiptsByClient(cid, { from: this.filterFrom() || undefined, to: this.filterTo() || undefined }).subscribe({
      next: (data) => {
        this.clientReceipts.set(data || []);
        this.loadingReceipts.set(false);
      },
      error: (err: any) => {
        console.error('Error obteniendo recibos por cliente', err);
        this.loadingReceipts.set(false);
      }
    });
  }

  verReciboCliente(receipt: any) {
    if (!receipt.sale_id) return;
    this.verRecibo(receipt.sale_id);
  }
}