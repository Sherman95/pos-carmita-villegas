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
import { SettingsService } from '../../services/settings.service';
import { firstValueFrom } from 'rxjs';
import { ReportsService } from '../../services/reports.service';
import { ClientsService, Client } from '../../services/clients.service';
import { ItemsService } from '../../services/items.service';
import { SalesService } from '../../services/sales.service';
import { Item } from '../../interfaces/interfaces';

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';

interface SaleRow {
  id: string;
  total: number;
  metodo_pago?: string;
  client_id?: string;
  client_nombre?: string | null;
  client_cedula?: string | null;
  created_at: string;
  tax_rate?: number;
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
  private settingsService = inject(SettingsService);
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
  taxRate = signal<number>(0);

  selectedSaleId = signal<string | null>(null);
  saleDetails = signal<Record<string, DetailRow[]>>({});
  loadingDetail = signal<boolean>(false);
  canExport = signal<boolean>(false);
  activeTab = signal<'general' | 'client' | 'service'>('general');

  ngOnInit(): void {
    const settings = this.settingsService.settings();
    this.taxRate.set(settings.taxRate || 0);
    this.loadClients();
    this.loadServicios();
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    this.periodGeneral.set('today');
    this.fromGeneral.set(iso(today));
    this.toGeneral.set(iso(today));
    this.periodClient.set('today');
    this.fromClient.set(iso(today));
    this.toClient.set(iso(today));
    this.periodService.set('today');
    this.fromService.set(iso(today));
    this.toService.set(iso(today));
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
    
    // CORRECCIÓN: Usar hora local en lugar de UTC
    const iso = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (period === 'today') {
      return { from: iso(now), to: iso(now) };
    }
    if (period === 'week') {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: iso(start), to: iso(now) };
    }
    if (period === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: iso(start), to: iso(now) };
    }
    // Año
    const start = new Date(now.getFullYear(), 0, 1);
    return { from: iso(start), to: iso(now) };
  }

  private apiPeriod(period: Period): 'week' | 'month' | 'year' | undefined {
    if (period === 'custom' || period === 'today') return undefined;
    return period;
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

  

  // =========================================================================
  // 2. EXPORTAR PDF (Corregido con lógica aditiva para items)
  //
  async exportPDF() {
    if (!this.canExport()) return;
    
    const doc = new jsPDF();
    const generatedAt = new Date();
    // Tasa por defecto (solo informativa en el header)
    const currentTaxRate = this.taxRate(); 
    let cursorY = 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setFontSize(16);
    doc.text('Reporte de ventas detallado', 14, cursorY);
    doc.setFontSize(10);
    doc.text(`Generado: ${generatedAt.toLocaleString()}`, 14, cursorY + 6);
    // Nota: El % mostrado aquí es el actual, aunque cada venta tenga el suyo
    doc.text(`IVA Actual Configurado: ${(currentTaxRate * 100).toFixed(0)}%`, 14, cursorY + 11);

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

      const body = [] as any[];
      let sectionSubtotal = 0;
      let sectionIVA = 0;
      let sectionTotal = 0;

      for (const sale of rows) {
        // DETECTAR TASA: Si la venta tiene tasa guardada, úsala. Si no, usa la actual.
        const tasaVenta = sale.tax_rate !== undefined ? Number(sale.tax_rate) : currentTaxRate;

        // A. VENTA (Inclusive): Usamos 'tasaVenta'
        const valsVenta = this.getValues(sale.total, 'inclusive', tasaVenta);
        
        sectionSubtotal += valsVenta.subtotal;
        sectionIVA += valsVenta.iva;
        sectionTotal += valsVenta.total;

        body.push({
          type: 'sale',
          fecha: this.formatearHora(sale.created_at),
          cliente: `${sale.client_nombre || 'Consumidor final'}${sale.client_cedula ? ' · ' + sale.client_cedula : ''}`,
          metodo: sale.metodo_pago || 'N/D',
          subtotal: `$${valsVenta.subtotal.toFixed(2)}`,
          iva: `$${valsVenta.iva.toFixed(2)}`,
          total: `$${valsVenta.total.toFixed(2)}`
        });

        const details = this.saleDetails()[sale.id] || [];
        for (const d of details) {
          const cantidad = Number(d.cantidad) || 0;
          const baseItem = Number(d.subtotal) || 0; 

          // B. ÍTEM (Additive): Usamos la MISMA 'tasaVenta' del padre
          const valsItem = this.getValues(baseItem, 'additive', tasaVenta); 

          body.push({
            type: 'detail',
            fecha: '',
            cliente: `   ${d.nombre_producto}`,
            metodo: `x${cantidad}`,
            subtotal: `$${valsItem.subtotal.toFixed(2)}`, 
            iva: `$${valsItem.iva.toFixed(2)}`,           
            total: `$${valsItem.total.toFixed(2)}`        
          });
        }
      }

      autoTable(doc, {
        startY: cursorY + 8,
        head: [['Fecha', 'Cliente/Ítem', 'Cant/Método', 'Subtotal', 'IVA', 'Total']],
        body,
        columns: [
          { header: 'Fecha', dataKey: 'fecha' },
          { header: 'Cliente/Ítem', dataKey: 'cliente' },
          { header: 'Cant/Método', dataKey: 'metodo' },
          { header: 'Subtotal', dataKey: 'subtotal' },
          { header: 'IVA', dataKey: 'iva' },
          { header: 'Total', dataKey: 'total' }
        ],
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [33, 37, 41], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 249, 250] },
        columnStyles: {
          fecha: { cellWidth: 35 },
          cliente: { cellWidth: 60 },
          metodo: { halign: 'center', cellWidth: 25 },
          subtotal: { halign: 'right', cellWidth: 22 },
          iva: { halign: 'right', cellWidth: 18 },
          total: { halign: 'right', cellWidth: 25 }
        },
        didParseCell: (data) => {
           const raw = data.row.raw as any;
           if (raw?.type === 'sale') {
             data.cell.styles.fontStyle = 'bold';
             data.cell.styles.fillColor = [255, 255, 255];
             const rowStyles = (data.row as any).styles || {};
             rowStyles.lineWidth = 0.1;
             rowStyles.lineColor = [200, 200, 200];
             (data.row as any).styles = rowStyles;
           }
           if (raw?.type === 'detail') {
             data.cell.styles.textColor = [80, 80, 80];
             data.cell.styles.fillColor = [250, 250, 250];
           }
        }
      });

      const finalY = (doc as any).lastAutoTable?.finalY ?? cursorY + 8;
      cursorY = finalY + 6;

      doc.setFontSize(9);
      doc.text(`Resumen sección: ${rows.length} registros`, 14, cursorY);
      doc.text(`Subtotal: $${sectionSubtotal.toFixed(2)}`, 80, cursorY);
      doc.text(`IVA: $${sectionIVA.toFixed(2)}`, 120, cursorY);
      
      doc.setFont('helvetica', 'bold');
      doc.text(`Total: $${sectionTotal.toFixed(2)}`, 160, cursorY);
      doc.setFont('helvetica', 'normal');
      
      cursorY += 10;
    };

    let totalGlobal = 0;

    if (this.activeTab() === 'general') {
        const generalSubtitle = this.rangeLabel('General', this.periodGeneral(), this.fromGeneral(), this.toGeneral());
        await addSection('Ventas generales', generalSubtitle, this.salesGeneral());
        // Sumamos considerando la tasa de cada venta
        totalGlobal = (this.salesGeneral() || []).reduce((acc, r) => {
             const tasa = r.tax_rate !== undefined ? Number(r.tax_rate) : currentTaxRate;
             return acc + this.getValues(r.total, 'inclusive', tasa).total;
        }, 0);
    } 
    else if (this.activeTab() === 'client' && this.selectedClientId()) {
         const client = this.clients().find((c) => c.id === this.selectedClientId());
         const nombreCliente = client?.nombre || 'Desconocido';
         
         const subtitle = this.rangeLabel(`Cliente: ${nombreCliente}`, this.periodClient(), this.fromClient(), this.toClient());
         await addSection('Por cliente', subtitle, this.salesClient());
         totalGlobal = (this.salesClient() || []).reduce((acc, r) => {
             const tasa = r.tax_rate !== undefined ? Number(r.tax_rate) : currentTaxRate;
             return acc + this.getValues(r.total, 'inclusive', tasa).total;
        }, 0);
    } 
    else if (this.activeTab() === 'service' && this.selectedServiceId()) {
         const service = this.servicios().find((s) => s.id === this.selectedServiceId());
         const nombreServicio = service?.nombre || 'Desconocido';

         const subtitle = this.rangeLabel(`Servicio: ${nombreServicio}`, this.periodService(), this.fromService(), this.toService());
         await addSection('Por servicio', subtitle, this.salesServiceList());
         totalGlobal = (this.salesServiceList() || []).reduce((acc, r) => {
             const tasa = r.tax_rate !== undefined ? Number(r.tax_rate) : currentTaxRate;
             return acc + this.getValues(r.total, 'inclusive', tasa).total;
        }, 0);
    }

    doc.setFontSize(11);
    doc.text(`Total Final Reporte: $${totalGlobal.toFixed(2)}`, 14, cursorY + 6);

    doc.save(`reporte-${this.activeTab()}-${generatedAt.toISOString().slice(0, 10)}.pdf`);
  }

  rangeLabel(prefix: string, period: Period, from: string, to: string) {
    const range = this.periodRange(period, from, to);
    const label =
      period === 'custom'
        ? 'Rango personalizado'
        : period === 'today'
          ? 'Hoy'
          : period === 'week'
            ? 'Ultimos 7 dias'
            : period === 'month'
              ? 'Mes en curso'
              : 'Anio en curso';
    return `${prefix} · ${label} (${range.from} al ${range.to})`;
  }

  loadGeneral() {
    const { from, to } = this.periodRange(this.periodGeneral(), this.fromGeneral(), this.toGeneral());
    this.fromGeneral.set(from);
    this.toGeneral.set(to);
    this.loadingGeneral.set(true);
    const apiPeriod = this.apiPeriod(this.periodGeneral());
    const summaryOpts = apiPeriod ? { period: apiPeriod, from, to } : { from, to };
    this.reportsService.getSummary(summaryOpts).subscribe({
      next: (data) => this.summaryGeneral.set(data || { count: 0, total: 0 }),
      error: (err) => console.error('Error resumen general', err)
    });
    this.reportsService.getByRange(from, to).subscribe({
      next: (rows) => {
        this.salesGeneral.set(rows || []);
        this.loadingGeneral.set(false);
        this.canExport.set(true);
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
    this.fromClient.set(from);
    this.toClient.set(to);
    this.loadingClient.set(true);
    const apiPeriod = this.apiPeriod(this.periodClient());
    const opts = apiPeriod ? { period: apiPeriod, from, to } : { from, to };
    this.reportsService.getByClient(this.selectedClientId(), opts).subscribe({
      next: (data) => {
        // CORRECCIÓN: Mapear los datos para asegurar que 'id' exista
        const fixedSales = (data.sales || []).map((s: any) => ({
            ...s,
            id: s.id || s.sale_id // <--- SI NO HAY ID, USA SALE_ID
        }));

        this.salesClient.set(fixedSales);
        this.summaryClient.set(data.summary || { count: 0, total: 0 });
        this.loadingClient.set(false);
        this.canExport.set(true);
      },
      error: (err) => { /* ... */ }
    });
  }

  loadByService() {
    if (!this.selectedServiceId()) return;
    const { from, to } = this.periodRange(this.periodService(), this.fromService(), this.toService());
    this.fromService.set(from);
    this.toService.set(to);
    this.loadingService.set(true);
    const apiPeriod = this.apiPeriod(this.periodService());
    const opts = apiPeriod ? { period: apiPeriod, from, to } : { from, to };
    this.reportsService.getByItem(this.selectedServiceId(), opts).subscribe({
      next: (data) => {
        // CORRECCIÓN: Mapear los datos aquí también
        const fixedSales = (data.sales || []).map((s: any) => ({
            ...s,
            id: s.id || s.sale_id // <--- ASEGURAMOS EL ID
        }));

        this.salesServiceList.set(fixedSales);
        this.summaryService.set(data.summary || { count: 0, total: 0 });
        this.loadingService.set(false);
        this.canExport.set(true);
      },
      error: (err) => { /* ... */ }
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

  getValues(monto: number | string | undefined, type: 'inclusive' | 'additive' = 'inclusive', customRate?: number) {
    const valor = Number(monto) || 0;
    
    // PRIORIDAD:
    // 1. Si la venta trae su tasa (customRate), ÚSALA. (Inmutabilidad)
    // 2. Si no trae nada (es null), usa la del perfil (this.taxRate()).
    const rate = (customRate !== undefined && customRate !== null) 
                 ? Number(customRate) 
                 : this.taxRate();

    let subtotal = 0;
    let iva = 0;
    let total = 0;

    if (type === 'inclusive') {
      total = valor;
      subtotal = total / (1 + rate);
      iva = total - subtotal;
    } else {
      subtotal = valor;
      iva = subtotal * rate;
      total = subtotal + iva;
    }

    return { subtotal, iva, total };
  }

}
