import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { firstValueFrom } from 'rxjs';
import { ReportsService } from '../../services/reports.service';
import { ClientsService, Client } from '../../services/clients.service';
import { ItemsService } from '../../services/items.service';
import { SalesService } from '../../services/sales.service';
import { Item } from '../../interfaces/interfaces';

type Period = 'week' | 'month' | 'year' | 'custom';

interface SaleRow {
  id: string;
  total: number;
  metodo_pago?: string;
  client_id?: string;
  client_nombre?: string | null;
  client_cedula?: string | null;
  created_at: string;
}

interface DetailRow {
  id: string;
  nombre_producto: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
}

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule],
  templateUrl: './reports.html',
  styleUrl: './reports.scss'
})
export class ReportsComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private clientsService = inject(ClientsService);
  private itemsService = inject(ItemsService);
  private salesService = inject(SalesService);

  clients = signal<Client[]>([]);
  servicios = signal<Item[]>([]);

  periodGeneral = signal<Period>('week');
  fromGeneral = signal<string>('');
  toGeneral = signal<string>('');
  salesGeneral = signal<SaleRow[]>([]);
  summaryGeneral = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingGeneral = signal<boolean>(false);

  periodClient = signal<Period>('week');
  fromClient = signal<string>('');
  toClient = signal<string>('');
  selectedClientId = signal<string>('');
  salesClient = signal<SaleRow[]>([]);
  summaryClient = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingClient = signal<boolean>(false);

  periodService = signal<Period>('week');
  fromService = signal<string>('');
  toService = signal<string>('');
  selectedServiceId = signal<string>('');
  salesServiceList = signal<SaleRow[]>([]);
  summaryService = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingService = signal<boolean>(false);

  selectedSaleId = signal<string | null>(null);
  saleDetails = signal<Record<string, DetailRow[]>>({});
  loadingDetail = signal<boolean>(false);

  ngOnInit(): void {
    this.loadClients();
    this.loadServicios();
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    this.fromGeneral.set(iso(today));
    this.toGeneral.set(iso(today));
    this.fromClient.set(iso(today));
    this.toClient.set(iso(today));
    this.fromService.set(iso(today));
    this.toService.set(iso(today));
    this.loadGeneral();
  }

  loadClients() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
    });
  }

  loadServicios() {
    this.itemsService.getItems().subscribe({
      next: (data) => this.servicios.set((data || []).filter((i) => i.tipo === 'SERVICIO')),
      error: (err) => console.error('Error cargando servicios', err)
    });
  }

  private periodRange(period: Period, from: string, to: string) {
    if (period === 'custom') return { from, to };
    const now = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (period === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: iso(start), to: iso(now) };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(start), to: iso(now) };
    }
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: iso(start), to: iso(now) };
  }

  private apiPeriod(period: Period): 'week' | 'month' | 'year' | undefined {
    return period === 'custom' ? undefined : period;
  }

  private async ensureDetails(rows: SaleRow[]) {
    const pending = rows.filter((r) => !this.saleDetails()[r.id]);
    for (const sale of pending) {
      try {
        const resp = await firstValueFrom(this.salesService.getSaleDetails(sale.id));
        this.saleDetails.set({ ...this.saleDetails(), [sale.id]: resp.details || [] });
      } catch (err) {
        console.error('Error cargando detalle', err);
        this.saleDetails.set({ ...this.saleDetails(), [sale.id]: [] });
      }
    }
  }

  async exportPDF() {
    const doc = new jsPDF();
    const generatedAt = new Date();
    let cursorY = 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    doc.setFontSize(16);
    doc.text('Reporte de ventas', 14, cursorY);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt.toLocaleString()}`, 14, cursorY + 6);

    const addSection = async (title: string, subtitle: string, rows: SaleRow[]) => {
      await this.ensureDetails(rows);

      cursorY += 16;
      doc.setFontSize(13);
      doc.text(title, 14, cursorY);
      doc.setFontSize(9);
      doc.text(subtitle, 14, cursorY + 5);

      if (!rows || rows.length === 0) {
        doc.text('Sin datos.', 14, cursorY + 12);
        cursorY += 22;
        return;
      }

      const sectionTotal = rows.reduce((acc, r) => acc + (Number(r.total) || 0), 0);

      const body = [] as any[];
      for (const sale of rows) {
        const totalNum = Number(sale.total) || 0;
        body.push({
          type: 'sale',
          fecha: this.formatearHora(sale.created_at),
          cliente: `${sale.client_nombre || 'Consumidor final'}${sale.client_cedula ? ' · ' + sale.client_cedula : ''}`,
          metodo: sale.metodo_pago || 'N/D',
          total: `$${totalNum.toFixed(2)}`
        });

        const details = this.saleDetails()[sale.id] || [];
        for (const d of details) {
          const precio = Number(d.precio_unitario) || 0;
          const subtotal = Number(d.subtotal) || 0;
          body.push({
            type: 'detail',
            fecha: '',
            cliente: `   ${d.nombre_producto}`,
            metodo: `x${d.cantidad} · $${precio.toFixed(2)}`,
            total: `$${subtotal.toFixed(2)}`
          });
        }
      }

      autoTable(doc, {
        startY: cursorY + 8,
        head: [['Fecha', 'Cliente', 'Método', 'Total']],
        body,
        columns: [
          { header: 'Fecha', dataKey: 'fecha' },
          { header: 'Cliente', dataKey: 'cliente' },
          { header: 'Método', dataKey: 'metodo' },
          { header: 'Total', dataKey: 'total' }
        ],
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [33, 37, 41], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        theme: 'striped',
        columnStyles: {
          fecha: { cellWidth: 48 },
          cliente: { cellWidth: 84 },
          metodo: { halign: 'center', cellWidth: 32 },
          total: { halign: 'right', cellWidth: 28 }
        },
        didParseCell: (data) => {
          const raw = data.row.raw as any;
          if (raw?.type === 'sale') {
            data.cell.styles.fontStyle = 'bold';
            data.cell.styles.fillColor = [255, 255, 255];
          }
          if (raw?.type === 'detail') {
            data.cell.styles.fontStyle = 'normal';
            data.cell.styles.textColor = [60, 60, 60];
            data.cell.styles.fillColor = [245, 245, 245];
          }
          // Divider line between sales: thin top border on sale rows
          if (raw?.type === 'sale') {
            const rowStyles = (data.row as any).styles || {};
            rowStyles.lineWidth = 0.2;
            rowStyles.lineColor = [220, 220, 220];
            (data.row as any).styles = rowStyles;
          }
        }
      });

      const finalY = (doc as any).lastAutoTable?.finalY ?? cursorY + 8;
      cursorY = finalY + 6;

      doc.setFontSize(9);
      doc.text(`Resumen sección: ${rows.length} venta(s) · Total $${sectionTotal.toFixed(2)}`, 14, cursorY);
      cursorY += 8;
    };

    const generalSubtitle = this.rangeLabel('General', this.periodGeneral(), this.fromGeneral(), this.toGeneral());
    await addSection('Ventas generales', generalSubtitle, this.salesGeneral());

    if (this.selectedClientId()) {
      const client = this.clients().find((c) => c.id === this.selectedClientId());
      const clienteLabel = client ? `${client.nombre}${client.cedula ? ' · ' + client.cedula : ''}` : 'Cliente seleccionado';
      const subtitle = this.rangeLabel(`Cliente: ${clienteLabel}`, this.periodClient(), this.fromClient(), this.toClient());
      await addSection('Por cliente', subtitle, this.salesClient());
    }

    if (this.selectedServiceId()) {
      const service = this.servicios().find((s) => s.id === this.selectedServiceId());
      const subtitle = this.rangeLabel(`Servicio: ${service?.nombre || 'Servicio seleccionado'}`, this.periodService(), this.fromService(), this.toService());
      await addSection('Por servicio', subtitle, this.salesServiceList());
    }

    // Resumen global simple
    const totalGeneral = (this.salesGeneral() || []).reduce((acc, r) => acc + (Number(r.total) || 0), 0);
    const totalCliente = this.selectedClientId() ? this.salesClient().reduce((a, r) => a + (Number(r.total) || 0), 0) : 0;
    const totalServicio = this.selectedServiceId() ? this.salesServiceList().reduce((a, r) => a + (Number(r.total) || 0), 0) : 0;
    const totalGlobal = totalGeneral + totalCliente + totalServicio;

    doc.setFontSize(11);
    doc.text(`Total global (secciones exportadas): $${totalGlobal.toFixed(2)}`, 14, cursorY + 6);

    doc.save(`reporte-ventas-${generatedAt.toISOString().slice(0, 10)}.pdf`);
  }

  rangeLabel(prefix: string, period: Period, from: string, to: string) {
    const range = this.periodRange(period, from, to);
    const label =
      period === 'custom'
        ? 'Rango personalizado'
        : period === 'week'
          ? 'Ultimos 7 dias'
          : period === 'month'
            ? 'Mes en curso'
            : 'Anio en curso';
    return `${prefix} · ${label} (${range.from} al ${range.to})`;
  }

  loadGeneral() {
    const { from, to } = this.periodRange(this.periodGeneral(), this.fromGeneral(), this.toGeneral());
    this.loadingGeneral.set(true);
    const apiPeriod = this.apiPeriod(this.periodGeneral());
    this.reportsService.getSummary({ from, to, period: apiPeriod }).subscribe({
      next: (data) => this.summaryGeneral.set(data || { count: 0, total: 0 }),
      error: (err) => console.error('Error resumen general', err)
    });
    this.reportsService.getByRange(from, to).subscribe({
      next: (rows) => {
        this.salesGeneral.set(rows || []);
        this.loadingGeneral.set(false);
      },
      error: (err) => {
        console.error('Error ventas generales', err);
        this.loadingGeneral.set(false);
      }
    });
  }

  loadByClient() {
    if (!this.selectedClientId()) return;
    const { from, to } = this.periodRange(this.periodClient(), this.fromClient(), this.toClient());
    this.loadingClient.set(true);
    const apiPeriod = this.apiPeriod(this.periodClient());
    const opts = apiPeriod ? { period: apiPeriod } : { from, to };
    this.reportsService.getByClient(this.selectedClientId(), opts).subscribe({
      next: (data) => {
        this.salesClient.set(data.sales || []);
        this.summaryClient.set(data.summary || { count: 0, total: 0 });
        this.loadingClient.set(false);
      },
      error: (err) => {
        console.error('Error ventas por cliente', err);
        this.loadingClient.set(false);
      }
    });
  }

  loadByService() {
    if (!this.selectedServiceId()) return;
    const { from, to } = this.periodRange(this.periodService(), this.fromService(), this.toService());
    this.loadingService.set(true);
    const apiPeriod = this.apiPeriod(this.periodService());
    const opts = apiPeriod ? { period: apiPeriod } : { from, to };
    this.reportsService.getByItem(this.selectedServiceId(), opts).subscribe({
      next: (data) => {
        this.salesServiceList.set(data.sales || []);
        this.summaryService.set(data.summary || { count: 0, total: 0 });
        this.loadingService.set(false);
      },
      error: (err) => {
        console.error('Error ventas por servicio', err);
        this.loadingService.set(false);
      }
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
      next: (resp) => {
        this.saleDetails.set({ ...this.saleDetails(), [id]: resp.details || [] });
        this.loadingDetail.set(false);
      },
      error: (err) => {
        console.error('Error cargando detalle', err);
        this.loadingDetail.set(false);
      }
    });
  }

  formatearHora(fechaIso: string): string {
    const d = new Date(fechaIso);
    return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }
}
