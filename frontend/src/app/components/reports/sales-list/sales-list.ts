import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';

// Servicios
import { ReportsService } from '../../../services/reports.service';
import { ClientsService, Client } from '../../../services/clients.service';
import { ItemsService } from '../../../services/items.service';
import { SalesService } from '../../../services/sales.service';
import { SettingsService } from '../../../services/settings.service';
import { Item } from '../../../interfaces/interfaces';

// Librerías
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx'; // 🟢 NUEVO: Para Excel
import { firstValueFrom } from 'rxjs';

type Period = 'today' | 'week' | 'month' | 'year' | 'custom';

interface SaleRow {
  id: string; total: number; metodo_pago?: string; client_id?: string;
  client_nombre?: string | null; client_cedula?: string | null; created_at: string; tax_rate?: number;
}

interface DetailRow {
  id: string; nombre_producto: string; cantidad: number; precio_unitario: number; subtotal: number;
}

@Component({
  selector: 'app-sales-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatCardModule, MatButtonModule, 
    MatFormFieldModule, MatInputModule, MatSelectModule, MatIconModule, MatTabsModule
  ],
  templateUrl: './sales-list.html',
  styleUrls: ['./sales-list.scss']
})
export class SalesListComponent implements OnInit {
  private reportsService = inject(ReportsService);
  private clientsService = inject(ClientsService);
  private itemsService = inject(ItemsService);
  private settingsService = inject(SettingsService);
  private salesService = inject(SalesService);

  // DATOS
  clients = signal<Client[]>([]);
  servicios = signal<Item[]>([]);
  taxRate = signal<number>(0);

  // PESTAÑAS (0=General, 1=Cliente, 2=Servicio)
  innerTab = signal<number>(0);

  // 1. GENERAL
  periodGeneral = signal<Period>('today');
  fromGeneral = signal<string>(''); toGeneral = signal<string>('');
  salesGeneral = signal<SaleRow[]>([]);
  summaryGeneral = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingGeneral = signal<boolean>(false);

  // 2. CLIENTE
  periodClient = signal<Period>('month');
  fromClient = signal<string>(''); toClient = signal<string>('');
  selectedClientId = signal<string>('');
  salesClient = signal<SaleRow[]>([]);
  summaryClient = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingClient = signal<boolean>(false);

  // 3. SERVICIO
  periodService = signal<Period>('month');
  fromService = signal<string>(''); toService = signal<string>('');
  selectedServiceId = signal<string>('');
  salesServiceList = signal<SaleRow[]>([]);
  summaryService = signal<{ count: number; total: number }>({ count: 0, total: 0 });
  loadingService = signal<boolean>(false);

  // DETALLES
  selectedSaleId = signal<string | null>(null);
  saleDetails = signal<Record<string, DetailRow[]>>({});
  loadingDetail = signal<boolean>(false);
  canExport = signal<boolean>(false);

  ngOnInit(): void {
    const settings = this.settingsService.settings();
    this.taxRate.set(settings.taxRate || 0);
    this.loadClients();
    this.loadServicios();
    
    const today = new Date().toLocaleDateString('en-CA');
    this.fromGeneral.set(today); this.toGeneral.set(today);
    this.fromClient.set(today);  this.toClient.set(today);
    this.fromService.set(today); this.toService.set(today);

    this.loadGeneral();
  }

  loadClients() { this.clientsService.getClients().subscribe(d => this.clients.set(d || [])); }
  loadServicios() { this.itemsService.getItems().subscribe(d => this.servicios.set((d || []).filter(i => i.tipo === 'SERVICIO'))); }

  private getRangeParams(period: Period, customFrom: string, customTo: string) {
    const now = new Date();
    let start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    let end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (period === 'week') start.setDate(now.getDate() - 6);
    else if (period === 'month') { start = new Date(now.getFullYear(), now.getMonth(), 1); end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59); }
    else if (period === 'year') { start = new Date(now.getFullYear(), 0, 1); end = new Date(now.getFullYear(), 11, 31, 23, 59, 59); }
    else if (period === 'custom') { start = new Date(customFrom + 'T00:00:00'); end = new Date(customTo + 'T23:59:59'); }
    return { from: start.toISOString(), to: end.toISOString() };
  }

  loadGeneral() {
    this.loadingGeneral.set(true);
    const { from, to } = this.getRangeParams(this.periodGeneral(), this.fromGeneral(), this.toGeneral());
    this.reportsService.getSummary({ from, to }).subscribe(d => this.summaryGeneral.set(d || { count: 0, total: 0 }));
    this.reportsService.getByRange(from, to).subscribe({
      next: (rows) => { this.salesGeneral.set(rows || []); this.loadingGeneral.set(false); this.canExport.set(true); },
      error: () => this.loadingGeneral.set(false)
    });
  }

  loadByClient() {
    if (!this.selectedClientId()) return;
    this.loadingClient.set(true);
    const { from, to } = this.getRangeParams(this.periodClient(), this.fromClient(), this.toClient());
    this.reportsService.getByClient(this.selectedClientId(), { from, to }).subscribe({
      next: (data) => {
        const fixed = (data.sales || []).map((s: any) => ({ ...s, id: s.id || s.sale_id }));
        this.salesClient.set(fixed);
        this.summaryClient.set(data.summary || { count: 0, total: 0 });
        this.loadingClient.set(false);
        this.canExport.set(true);
      },
      error: () => this.loadingClient.set(false)
    });
  }

  loadByService() {
    if (!this.selectedServiceId()) return;
    this.loadingService.set(true);
    const { from, to } = this.getRangeParams(this.periodService(), this.fromService(), this.toService());
    this.reportsService.getByItem(this.selectedServiceId(), { from, to }).subscribe({
      next: (data) => {
        const fixed = (data.sales || []).map((s: any) => ({ ...s, id: s.id || s.sale_id }));
        this.salesServiceList.set(fixed);
        this.summaryService.set(data.summary || { count: 0, total: 0 });
        this.loadingService.set(false);
        this.canExport.set(true);
      },
      error: () => this.loadingService.set(false)
    });
  }

  toggleDetalles(id: string) {
    if (this.selectedSaleId() === id) { this.selectedSaleId.set(null); return; }
    this.selectedSaleId.set(id);
    if (this.saleDetails()[id]) return; 
    this.loadingDetail.set(true);
    this.salesService.getSaleDetails(id).subscribe({
      next: (r) => { this.saleDetails.set({ ...this.saleDetails(), [id]: r.details || [] }); this.loadingDetail.set(false); },
      error: () => this.loadingDetail.set(false)
    });
  }

  // --- 🟢 EXCEL PRO PARA CONTADORES ---
  async exportExcel() {
    if (!this.canExport()) return;

    let rows: SaleRow[] = [];
    let filename = 'reporte';

    if (this.innerTab() === 0) { rows = this.salesGeneral(); filename = 'ventas_general'; }
    else if (this.innerTab() === 1) { rows = this.salesClient(); filename = 'ventas_cliente'; }
    else { rows = this.salesServiceList(); filename = 'ventas_servicio'; }

    // Asegurar detalles antes de exportar
    await this.ensureDetails(rows);

    const exportData: any[] = [];

    rows.forEach(sale => {
        const tasa = sale.tax_rate !== undefined ? Number(sale.tax_rate) : this.taxRate();
        const vals = this.getValues(sale.total, 'inclusive', tasa);

        // Fila de la Venta
        exportData.push({
            'FECHA': this.formatearHora(sale.created_at),
            'TIPO': 'VENTA',
            'CLIENTE': sale.client_nombre || 'Consumidor Final',
            'CEDULA': sale.client_cedula || '-',
            'METODO PAGO': sale.metodo_pago || 'N/D',
            'PRODUCTO/SERVICIO': '---',
            'CANTIDAD': 1,
            'SUBTOTAL': vals.subtotal,
            'IVA': vals.iva,
            'TOTAL': vals.total
        });

        // Filas de los Detalles
        const details = this.saleDetails()[sale.id] || [];
        details.forEach(d => {
            const vItem = this.getValues(Number(d.subtotal)||0, 'additive', tasa);
            exportData.push({
                'FECHA': '',
                'TIPO': 'DETALLE',
                'CLIENTE': '',
                'CEDULA': '',
                'METODO PAGO': '',
                'PRODUCTO/SERVICIO': d.nombre_producto,
                'CANTIDAD': Number(d.cantidad),
                'SUBTOTAL': vItem.subtotal,
                'IVA': vItem.iva,
                'TOTAL': vItem.total
            });
        });
    });

    const ws: XLSX.WorkSheet = XLSX.utils.json_to_sheet(exportData);
    const wb: XLSX.WorkBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');
    XLSX.writeFile(wb, `${filename}_${new Date().getTime()}.xlsx`);
  }

  async exportPDF() {
    if (!this.canExport()) return;
    const doc = new jsPDF();
    const generatedAt = new Date();
    const currentTaxRate = this.taxRate(); 
    let cursorY = 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(16); doc.text('Reporte Contable', 14, cursorY);
    doc.setFontSize(10); doc.text(`Generado: ${generatedAt.toLocaleString('es-EC')}`, 14, cursorY + 6);

    const addSection = async (title: string, subtitle: string, rows: SaleRow[]) => {
      await this.ensureDetails(rows);
      cursorY += 16; doc.setFontSize(13); doc.text(title, 14, cursorY);
      doc.setFontSize(9); doc.text(subtitle, 14, cursorY + 5);

      if (!rows.length) { doc.text('Sin datos.', 14, cursorY + 12); cursorY += 22; return; }

      const body = [] as any[];
      let sectionTotal = 0;

      for (const sale of rows) {
        const tasa = sale.tax_rate !== undefined ? Number(sale.tax_rate) : currentTaxRate;
        const vals = this.getValues(sale.total, 'inclusive', tasa);
        sectionTotal += vals.total;

        body.push({
          type: 'sale', fecha: this.formatearHora(sale.created_at),
          cliente: `${sale.client_nombre || 'Consumidor final'}`, metodo: sale.metodo_pago || 'N/D',
          subtotal: `$${vals.subtotal.toFixed(2)}`, iva: `$${vals.iva.toFixed(2)}`, total: `$${vals.total.toFixed(2)}`
        });

        const details = this.saleDetails()[sale.id] || [];
        for (const d of details) {
          const vItem = this.getValues(Number(d.subtotal)||0, 'additive', tasa);
          body.push({ type: 'detail', fecha: '', cliente: `  ${d.nombre_producto}`, metodo: `x${d.cantidad}`, subtotal: `$${vItem.subtotal.toFixed(2)}`, iva: '', total: `$${vItem.total.toFixed(2)}` });
        }
      }

      autoTable(doc, {
        startY: cursorY + 8, head: [['Fecha', 'Cliente', 'Pago', 'Sub', 'IVA', 'Total']], body,
        columns: [{dataKey:'fecha'}, {dataKey:'cliente'}, {dataKey:'metodo'}, {dataKey:'subtotal'}, {dataKey:'iva'}, {dataKey:'total'}],
        styles: { fontSize: 8 },
        didParseCell: (data) => {
             // 🟢 CORRECCIÓN: Usamos 'as any' para evitar el error rojo
             const raw = data.row.raw as any; 
             if (raw?.type === 'sale') { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [240,240,240]; }
             if (raw?.type === 'detail') { data.cell.styles.textColor = [100,100,100]; }
        }
      });
      cursorY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`Total Sección: $${sectionTotal.toFixed(2)}`, 14, cursorY);
    };

    if (this.innerTab() === 0) await addSection('General', '', this.salesGeneral());
    else if (this.innerTab() === 1) await addSection('Por Cliente', '', this.salesClient());
    else if (this.innerTab() === 2) await addSection('Por Servicio', '', this.salesServiceList());

    doc.save(`reporte.pdf`);
  }

  private async ensureDetails(rows: SaleRow[]) {
    const pending = rows.filter((r) => !this.saleDetails()[r.id]);
    for (const sale of pending) {
      try {
        const resp = await firstValueFrom(this.salesService.getSaleDetails(sale.id));
        this.saleDetails.set({ ...this.saleDetails(), [sale.id]: resp.details || [] });
      } catch (err) { }
    }
  }

  getValues(monto: any, type: any, rate: any) {
    const valor = Number(monto) || 0;
    if (type === 'inclusive') { const s = valor / (1 + rate); return { subtotal: s, iva: valor - s, total: valor }; }
    else { const s = valor; return { subtotal: s, iva: s * rate, total: s + (s * rate) }; }
  }
  
  // Helpers UI
  getInitials(name: string | null | undefined): string {
    if (!name) return 'CF';
    const p = name.trim().split(' ');
    if (p.length === 1) return p[0].substring(0, 2).toUpperCase();
    return (p[0][0] + p[p.length - 1][0]).toUpperCase();
  }
  getAvatarColor(name: string | null | undefined): string {
    if (!name) return '#9e9e9e';
    const c = ['#e57373', '#ba68c8', '#7986cb', '#4db6ac', '#4dd0e1', '#a1887f'];
    let h = 0;
    for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
    return c[Math.abs(h) % c.length];
  }
  formatearHora(fechaIso: string): string {
    const d = new Date(fechaIso);
    return d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' });
  }
}