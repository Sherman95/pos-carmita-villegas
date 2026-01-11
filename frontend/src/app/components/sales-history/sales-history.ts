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
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, FormsModule, MatFormFieldModule, MatSelectModule, MatInputModule],
  templateUrl: './sales-history.html',
  styleUrl: './sales-history.scss'
})
export class SalesHistoryComponent implements OnInit {
  private salesService = inject(SalesService);
  private clientsService = inject(ClientsService);

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
  downloadingSaleId = signal<string | null>(null);

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
      error: (err) => console.error('Error cargando ventas', err)
    });
  }

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
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
      error: (err) => {
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
  // CORRECCIÓN: Eliminamos la referencia a pdfBase64
  // =========================================================
  descargarRecibo(saleId: string) {
    this.downloadingSaleId.set(saleId);
    
    // El servicio ahora retorna un Blob (archivo binario), no un objeto JSON
    this.salesService.getReceipt(saleId).subscribe({
      next: (blob: Blob) => {
        // Creamos la URL directamente del blob
        const url = window.URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `recibo-${saleId}.pdf`;
        a.target = '_blank';
        
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        this.downloadingSaleId.set(null);
      },
      error: (err) => {
        console.error('No se pudo obtener el recibo', err);
        this.downloadingSaleId.set(null);
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
      error: (err) => {
        console.error('Error obteniendo recibos por cliente', err);
        this.loadingReceipts.set(false);
      }
    });
  }

  descargarReciboCliente(receipt: any) {
    if (!receipt.sale_id) return;
    this.descargarRecibo(receipt.sale_id);
  }
}
