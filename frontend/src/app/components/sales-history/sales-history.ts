import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { SalesService } from '../../services/sales.service';

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
  imports: [CommonModule, MatCardModule],
  templateUrl: './sales-history.html',
  styleUrl: './sales-history.scss'
})
export class SalesHistoryComponent implements OnInit {
  private salesService = inject(SalesService);

  sales = signal<Sale[]>([]);
  selectedSaleId = signal<string | null>(null);
  saleDetails = signal<Record<string, SaleDetail[]>>({});
  loadingDetail = signal<boolean>(false);

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
  }

  cargarVentas() {
    this.salesService.getSales().subscribe({
      next: (data) => this.sales.set(data),
      error: (err) => console.error('Error cargando ventas', err)
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
}
