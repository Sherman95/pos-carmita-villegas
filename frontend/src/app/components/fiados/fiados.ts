import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatExpansionModule } from '@angular/material/expansion'; 
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import Swal from 'sweetalert2';

import { SalesService, DeudaCliente } from '../../services/sales.service';

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
    MatFormFieldModule
  ],
  templateUrl: './fiados.html',
  styleUrl: './fiados.scss'
})
export class FiadosComponent implements OnInit {
  private salesService = inject(SalesService);

  // ESTADO
  deudores = signal<DeudaCliente[]>([]);
  loading = signal(true);
  searchTerm = signal('');

  // 🔍 BUSCADOR
  filteredDeudores = computed(() => {
    const term = this.searchTerm().toLowerCase();
    return this.deudores().filter(d => 
      d.nombre.toLowerCase().includes(term)
    );
  });

  // 💰 TOTAL GENERAL (Suma de todas las deudas)
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

  // 💵 ACCIÓN: COBRAR / ABONAR
  async abonar(venta: any, clienteNombre: string) {
    
    // Popup para pedir el monto
    const { value: monto } = await Swal.fire({
      title: `Abonar Cuenta`,
      html: `
        <div style="text-align: left; font-size: 0.9rem;">
          <p>Cliente: <strong>${clienteNombre}</strong></p>
          <p>Fecha Venta: ${new Date(venta.created_at).toLocaleDateString()}</p>
          <p>Saldo pendiente: <b style="color:#d32f2f; font-size:1.1rem">$${venta.saldo_pendiente.toFixed(2)}</b></p>
        </div>
      `,
      input: 'number',
      inputLabel: 'Ingrese el monto recibido:',
      inputPlaceholder: '0.00',
      showCancelButton: true,
      confirmButtonText: 'CONFIRMAR PAGO',
      confirmButtonColor: '#2e7d32', // Verde
      inputValidator: (value) => {
        if (!value || Number(value) <= 0) return 'Ingresa un monto válido';
        if (Number(value) > venta.saldo_pendiente) return 'No puedes abonar más de lo que debe';
        return null;
      }
    });

    // Si ingresó un monto y dio aceptar
    if (monto) {
      try {
        await this.salesService.registrarAbono(venta.id, Number(monto));
        
        Swal.fire({
          title: '¡Pago Registrado!',
          text: `Se abonaron $${monto} correctamente.`,
          icon: 'success',
          timer: 1500,
          showConfirmButton: false
        });

        this.cargarDatos(); // Recargar la lista para ver el nuevo saldo
      } catch (error) {
        Swal.fire('Error', 'No se pudo registrar el pago', 'error');
      }
    }
  }
}