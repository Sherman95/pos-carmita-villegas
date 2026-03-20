import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatTabsModule } from '@angular/material/tabs';

import { ReportsService } from '../../../services/reports.service';
import { SalesService } from '../../../services/sales.service';

type Period = 'today' | 'yesterday' | 'last7' | 'last15' | 'last30' | 'month' | 'prevMonth' | 'year' | 'prevYear' | 'custom';
type SortMode = 'amount' | 'count';

interface SaleRow {
  id: string;
  total: number;
  client_id?: string | null;
  client_nombre?: string | null;
  created_at: string;
}

interface DetailRow {
  id?: string;
  item_id?: string;
  nombre_producto: string;
  cantidad: number;
  subtotal: number;
}

interface TopClientRow {
  clientId: string;
  clientName: string;
  totalAmount: number;
  salesCount: number;
  serviceLines: number;
  serviceQuantity: number;
  avgTicket: number;
}

interface TopServiceRow {
  serviceId: string;
  serviceName: string;
  totalAmount: number;
  ordersCount: number;
  quantityTotal: number;
  uniqueClients: number;
  avgUnitValue: number;
}

@Component({
  selector: 'app-top-analytics',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatTabsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatButtonToggleModule
  ],
  templateUrl: './top-analytics.html',
  styleUrl: './top-analytics.scss'
})
export class TopAnalyticsComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private salesService = inject(SalesService);

  period = signal<Period>('month');
  from = signal<Date | null>(null);
  to = signal<Date | null>(null);
  limit = signal<number>(10);

  sortClientsBy = signal<SortMode>('amount');
  sortServicesBy = signal<SortMode>('amount');

  loading = signal<boolean>(false);
  selectedTab = signal<number>(0);

  salesRows = signal<SaleRow[]>([]);
  topClientsRaw = signal<TopClientRow[]>([]);
  topServicesRaw = signal<TopServiceRow[]>([]);

  totals = computed(() => {
    const sales = this.salesRows();
    const totalSalesAmount = sales.reduce((sum, row) => sum + Number(row.total || 0), 0);
    return {
      salesCount: sales.length,
      totalSalesAmount,
      uniqueClients: this.topClientsRaw().length,
      uniqueServices: this.topServicesRaw().length
    };
  });

  topClients = computed(() => {
    const mode = this.sortClientsBy();
    const maxRows = this.limit();
    const rows = [...this.topClientsRaw()];
    rows.sort((a, b) => mode === 'amount' ? b.totalAmount - a.totalAmount : b.salesCount - a.salesCount);
    return rows.slice(0, maxRows);
  });

  topServices = computed(() => {
    const mode = this.sortServicesBy();
    const maxRows = this.limit();
    const rows = [...this.topServicesRaw()];
    rows.sort((a, b) => mode === 'amount' ? b.totalAmount - a.totalAmount : b.ordersCount - a.ordersCount);
    return rows.slice(0, maxRows);
  });

  ngOnInit(): void {
    const today = new Date();
    this.from.set(today);
    this.to.set(today);
    this.loadAnalytics();
  }

  async loadAnalytics() {
    this.loading.set(true);

    try {
      const { from, to } = this.getRangeParams(this.period(), this.from(), this.to());
      const sales = (await firstValueFrom(this.reportsService.getByRange(from, to))) || [];
      const normalizedSales = sales.map((s: any) => ({ ...s, id: s.id || s.sale_id })) as SaleRow[];
      this.salesRows.set(normalizedSales);

      if (!normalizedSales.length) {
        this.topClientsRaw.set([]);
        this.topServicesRaw.set([]);
        this.loading.set(false);
        return;
      }

      const detailsBySale = new Map<string, DetailRow[]>();
      const detailRequests = normalizedSales.map(async (sale) => {
        try {
          const resp = await firstValueFrom(this.salesService.getSaleDetails(sale.id));
          detailsBySale.set(sale.id, (resp.details || []) as DetailRow[]);
        } catch {
          detailsBySale.set(sale.id, []);
        }
      });
      await Promise.all(detailRequests);

      this.topClientsRaw.set(this.buildTopClients(normalizedSales, detailsBySale));
      this.topServicesRaw.set(this.buildTopServices(normalizedSales, detailsBySale));
    } finally {
      this.loading.set(false);
    }
  }

  private buildTopClients(sales: SaleRow[], detailsBySale: Map<string, DetailRow[]>): TopClientRow[] {
    const map = new Map<string, TopClientRow>();

    for (const sale of sales) {
      const clientId = sale.client_id || 'CF';
      const clientName = sale.client_nombre || 'Consumidor Final';
      const amount = Number(sale.total || 0);
      const details = detailsBySale.get(sale.id) || [];

      if (!map.has(clientId)) {
        map.set(clientId, {
          clientId,
          clientName,
          totalAmount: 0,
          salesCount: 0,
          serviceLines: 0,
          serviceQuantity: 0,
          avgTicket: 0
        });
      }

      const row = map.get(clientId)!;
      row.totalAmount += amount;
      row.salesCount += 1;
      row.serviceLines += details.length;
      row.serviceQuantity += details.reduce((sum, d) => sum + Number(d.cantidad || 0), 0);
      row.avgTicket = row.salesCount > 0 ? row.totalAmount / row.salesCount : 0;
    }

    return Array.from(map.values());
  }

  private buildTopServices(sales: SaleRow[], detailsBySale: Map<string, DetailRow[]>): TopServiceRow[] {
    const map = new Map<string, TopServiceRow>();
    const uniqueClientsByService = new Map<string, Set<string>>();

    for (const sale of sales) {
      const details = detailsBySale.get(sale.id) || [];
      const saleClientKey = sale.client_id || sale.client_nombre || `sale-${sale.id}`;

      for (const detail of details) {
        const serviceId = detail.item_id || detail.id || detail.nombre_producto;
        if (!map.has(serviceId)) {
          map.set(serviceId, {
            serviceId,
            serviceName: detail.nombre_producto,
            totalAmount: 0,
            ordersCount: 0,
            quantityTotal: 0,
            uniqueClients: 0,
            avgUnitValue: 0
          });
          uniqueClientsByService.set(serviceId, new Set<string>());
        }

        const row = map.get(serviceId)!;
        const amount = Number(detail.subtotal || 0);
        const qty = Number(detail.cantidad || 0);

        row.totalAmount += amount;
        row.ordersCount += 1;
        row.quantityTotal += qty;

        uniqueClientsByService.get(serviceId)?.add(String(saleClientKey));
      }
    }

    return Array.from(map.values()).map((row) => {
      const uniqueClients = uniqueClientsByService.get(row.serviceId)?.size || 0;
      return {
        ...row,
        uniqueClients,
        avgUnitValue: row.quantityTotal > 0 ? row.totalAmount / row.quantityTotal : 0
      };
    });
  }

  private getRangeParams(period: Period, customFrom: Date | null, customTo: Date | null) {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === 'yesterday') {
      start.setDate(start.getDate() - 1);
      end.setDate(end.getDate() - 1);
    } else if (period === 'last7') {
      start.setDate(start.getDate() - 6);
    } else if (period === 'last15') {
      start.setDate(start.getDate() - 14);
    } else if (period === 'last30') {
      start.setDate(start.getDate() - 29);
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else if (period === 'prevMonth') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    } else if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end = new Date(now.getFullYear(), 11, 31);
    } else if (period === 'prevYear') {
      start = new Date(now.getFullYear() - 1, 0, 1);
      end = new Date(now.getFullYear() - 1, 11, 31);
    } else if (period === 'custom' && customFrom && customTo) {
      start = this.normalizeDate(customFrom);
      end = this.normalizeDate(customTo);
    }

    if (end < start) {
      const temp = start;
      start = end;
      end = temp;
    }

    return { from: this.toDateOnly(start), to: this.toDateOnly(end) };
  }

  private normalizeDate(value: Date): Date {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  private toDateOnly(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
