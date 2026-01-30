import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion'; 
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { Router } from '@angular/router'; 
import { firstValueFrom } from 'rxjs';    
import { MatDialog, MatDialogModule } from '@angular/material/dialog'; // 👈 Importante
import Swal from 'sweetalert2';

import { SalesService, DeudaCliente } from '../../services/sales.service';
import { CashService } from '../../services/cash'; 
import { PaymentDialogComponent } from './payment-dialog/payment-dialog'; // 👈 Importamos el nuevo componente

@Component({
  selector: 'app-fiados',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatIconModule, 
    MatButtonModule, 
    MatExpansionModule,
    MatInputModule,
    MatFormFieldModule,
    MatDialogModule // 👈 No olvides esto
  ],
  templateUrl: './fiados.html',
  styleUrl: './fiados.scss'
})
export class FiadosComponent implements OnInit {
  private salesService = inject(SalesService);
  private cashService = inject(CashService);
  private router = inject(Router);
  private dialog = inject(MatDialog); // 👈 Inyectamos MatDialog

  // ESTADO
  deudores = signal<DeudaCliente[]>([]);
  loading = signal(true);
  searchTerm = signal('');

  // BUSCADOR
  filteredDeudores = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.deudores().filter(d => 
      d.nombre.toLowerCase().includes(term)
    );
  });

  // TOTAL GENERAL
  totalCartera = computed(() => {
    return this.deudores().reduce((acc, curr) => acc + curr.total_deuda, 0);
  });

  ngOnInit() {
    this.cargarDatos();
  }

  cargarDatos() {
    this.loading.set(true);
    this.salesService.getCarteraVencida()
      .then(data => {
        this.deudores.set(data);
        this.loading.set(false);
      })
      .catch(err => {
        console.error(err);
        this.loading.set(false);
        Swal.fire('Error', 'No se pudieron cargar las deudas', 'error');
      });
  }

  // 💵 ACCIÓN: COBRAR / ABONAR (NUEVA VERSIÓN LIMPIA)
  async abonar(venta: any, clienteNombre: string) {
    
    // 1. SEGURIDAD: VERIFICAR CAJA
    try {
      const status = await firstValueFrom(this.cashService.getStatus());
      
      if (!status.isOpen) {
        Swal.fire({
          title: '⛔ Caja Cerrada',
          text: 'Debes abrir turno para recibir dinero de abonos.',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: 'Ir a Abrir Caja',
          confirmButtonColor: '#d32f2f',
          cancelButtonText: 'Cancelar'
        }).then((res) => {
          if (res.isConfirmed) {
            this.router.navigate(['/cash-control']);
          }
        });
        return; 
      }
    } catch (e) {
      console.error('Error verificando caja', e);
      return;
    }
    
    // 2. ABRIR EL DIÁLOGO ELEGANTE
    const dialogRef = this.dialog.open(PaymentDialogComponent, {
      width: '400px',
      disableClose: true, // No cierra si haces clic afuera
      data: {
        clienteNombre: clienteNombre,
        saldoPendiente: venta.saldo_pendiente
      }
    });

    // 3. ESPERAR RESULTADO
    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        // Si el usuario confirmó, result tendrá { monto: 10, metodo: 'EFECTIVO' }
        const { monto, metodo } = result;

        try {
          await this.salesService.registrarAbono(venta.id, Number(monto), metodo);
          
          // Feedback sutil
          Swal.fire({
            title: '¡Pago Registrado!',
            text: `Se abonaron $${monto} vía ${metodo}.`,
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
          });

          this.cargarDatos(); // Recargamos la lista
        } catch (error) {
          Swal.fire('Error', 'No se pudo registrar el pago', 'error');
        }
      }
    });
  }
}