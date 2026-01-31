import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import Swal from 'sweetalert2';

import { SalesService } from '../../services/sales.service';

// Interfaces Visuales
interface Debtor {
  clientId: string;
  clientName: string;
  balance: number;
  lastUpdate: string;
  originalData?: any; // Para mantener referencia a los datos crudos
}

interface Movimiento {
  id: string;
  type: 'DEUDA' | 'PAGO';
  amount: number;
  date: string;
  note?: string;
}

@Component({
  selector: 'app-fiados',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatDialogModule, 
    MatTooltipModule
  ],
  templateUrl: './fiados.html',
  styleUrl: './fiados.scss'
})
export class FiadosComponent implements OnInit {
  
  private salesService = inject(SalesService);
  private dialog = inject(MatDialog);

  // Vistas del Dialog
  @ViewChild('abonoDialog') abonoDialog!: TemplateRef<any>;
  @ViewChild('historyDialog') historyDialog!: TemplateRef<any>;
  @ViewChild('editDialog') editDialog!: TemplateRef<any>;

  // Datos
  debtors = signal<Debtor[]>([]);
  loading = signal(true);
  searchTerm = signal('');
  
  // Selección actual
  selectedDebtor = signal<Debtor | null>(null);
  movimientos = signal<Movimiento[]>([]);
  
  // Variables para formularios
  montoAbono: number = 0;
  notaAbono: string = '';
  
  // Edición
  selectedMovimiento: Movimiento | null = null;
  editMonto: number = 0;
  editNota: string = '';

  // Filtros y Cálculos
  filteredDebtors = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.debtors().filter(d => d.clientName.toLowerCase().includes(term));
  });

  totalDeuda = computed(() => {
    return this.debtors().reduce((acc, curr) => acc + curr.balance, 0);
  });

  ngOnInit() {
    this.cargarDeudores();
  }

  cargarDeudores() {
    this.loading.set(true);
    this.salesService.getCarteraVencida()
      .then((data: any[]) => {
        // Transformamos los datos del servicio a nuestro formato visual
        const mapped: Debtor[] = data.map(d => ({
          clientId: d.cliente_id || '0',
          clientName: d.nombre || 'Desconocido',
          balance: Number(d.total_deuda) || 0,
          lastUpdate: new Date().toISOString(), // Idealmente vendría del backend
          originalData: d
        }));
        
        this.debtors.set(mapped);
        this.loading.set(false);
      })
      .catch(err => {
        console.error(err);
        this.loading.set(false);
      });
  }

  // --- FUNCIONES DE VISUALIZACIÓN ---

  getColor(name: string): string {
    const colors = ['#e11d48', '#db2777', '#9333ea', '#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  setSearch(term: string) {
    this.searchTerm.set(term);
  }

  // --- 1. LÓGICA DE ABONOS RÁPIDOS ---

  abrirAbonar(debtor: Debtor) {
    this.selectedDebtor.set(debtor);
    this.montoAbono = 0;
    this.notaAbono = '';
    this.dialog.open(this.abonoDialog, { width: '400px', panelClass: 'custom-dialog-container' });
  }

  async guardarAbono() {
    if (this.montoAbono <= 0) return;
    
    const debtor = this.selectedDebtor();
    if (!debtor) return;

    // LÓGICA DE NEGOCIO:
    // Como tu backend actual cobra por venta específica, aquí tomamos la venta más antigua
    // o simplemente enviamos el pago a la primera venta pendiente para simular "Abono a Cuenta".
    // (Idealmente tu backend debería soportar "Abono a Cliente" general).
    
    try {
      const ventasPendientes = debtor.originalData?.ventas || [];
      if (ventasPendientes.length > 0) {
        const ventaId = ventasPendientes[0].id; // Tomamos la primera para el ejemplo
        
        await this.salesService.registrarAbono(ventaId, this.montoAbono, 'EFECTIVO');
        
        Swal.fire({
          icon: 'success',
          title: 'Abono registrado',
          text: `Se abonaron $${this.montoAbono} a la cuenta de ${debtor.clientName}`,
          timer: 2000,
          showConfirmButton: false
        });

        this.cargarDeudores(); // Recargar datos reales
        this.dialog.closeAll();
      } else {
        Swal.fire('Error', 'No se encontraron ventas pendientes para asignar el pago.', 'error');
      }
    } catch (e) {
      console.error(e);
      Swal.fire('Error', 'No se pudo procesar el pago.', 'error');
    }
  }

  // --- 2. LÓGICA DE HISTORIAL (AUDITORÍA) ---

  verHistorial(debtor: Debtor) {
    this.selectedDebtor.set(debtor);
    
    // AQUÍ DEBERÍAS LLAMAR A: this.salesService.getHistorialCliente(id)
    // Como no existe, generamos un mock visual basado en sus ventas pendientes
    // para que veas cómo quedaría el diseño.
    
    const mockMovimientos: Movimiento[] = [];
    
    // Convertimos ventas pendientes en "Deudas"
    if (debtor.originalData?.ventas) {
      debtor.originalData.ventas.forEach((v: any) => {
        mockMovimientos.push({
          id: v.id,
          type: 'DEUDA',
          amount: Number(v.total),
          date: v.created_at,
          note: `Venta #${v.numero || 'S/N'}`
        });
        
        // Si ya abonó algo, mostramos el pago
        const pagado = Number(v.total) - Number(v.saldo_pendiente);
        if (pagado > 0) {
          mockMovimientos.push({
            id: `pago-${v.id}`,
            type: 'PAGO',
            amount: pagado,
            date: new Date().toISOString(), // Fecha simulada
            note: 'Abono parcial'
          });
        }
      });
    }

    // Ordenar por fecha
    mockMovimientos.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    this.movimientos.set(mockMovimientos);

    this.dialog.open(this.historyDialog, { width: '600px', panelClass: 'custom-dialog-container' });
  }

  // --- 3. LÓGICA DE CORRECCIÓN (EDITAR/BORRAR) ---

  editarMovimiento(mov: Movimiento) {
    // Solo permitimos editar si es un PAGO (no una venta, eso es intocable aquí)
    if (mov.type !== 'PAGO') return;

    this.selectedMovimiento = mov;
    this.editMonto = mov.amount;
    this.editNota = mov.note || '';
    
    this.dialog.open(this.editDialog, { width: '400px', panelClass: 'custom-dialog-container' });
  }

  guardarEdicion() {
    if (!this.selectedMovimiento) return;

    // AQUÍ LLAMARÍAS AL BACKEND PARA ACTUALIZAR EL PAGO
    console.log('Actualizando pago:', this.selectedMovimiento.id, this.editMonto);
    
    Swal.fire('Corregido', 'El monto ha sido actualizado (Simulación)', 'success');

    // Actualización visual local
    this.movimientos.update(movs => movs.map(m => {
      if (m.id === this.selectedMovimiento?.id) {
        return { ...m, amount: this.editMonto, note: this.editNota + ' (Corregido)' };
      }
      return m;
    }));

    this.dialog.closeAll(); 
    // Nota: En la vida real, al cerrar esto deberías recargar los deudores
  }

  eliminarMovimiento(mov: Movimiento) {
    Swal.fire({
      title: '¿Eliminar este abono?',
      text: "La deuda del cliente aumentará. Esta acción deja rastro.",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Sí, eliminar'
    }).then((result) => {
      if (result.isConfirmed) {
        // AQUÍ LLAMARÍAS AL BACKEND PARA BORRAR EL PAGO
        console.log('Borrando pago:', mov.id);
        
        this.movimientos.update(movs => movs.filter(m => m.id !== mov.id));
        Swal.fire('Eliminado', 'El abono ha sido anulado.', 'success');
      }
    });
  }
}