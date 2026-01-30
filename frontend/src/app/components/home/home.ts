import { Component, OnInit, signal, computed, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router'; 
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import Swal from 'sweetalert2'; // 👈 IMPORTANTE

import { ClientsService } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';
import { CashService } from '../../services/cash';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatAutocompleteModule,
    MatInputModule,
    MatFormFieldModule
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class HomeComponent implements OnInit {
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private cartService = inject(CartService);
  private cashService = inject(CashService); // 👈 Inyectamos servicio de caja

  @ViewChild('searchInput') searchInput!: ElementRef;

  // Señales
  searchText = signal('');
  clients = signal<any[]>([]);
  isBoxOpen = signal(false); // 👈 Nueva señal para saber si está abierta
  
  // Filtro automático
  filteredClients = computed(() => {
    const term = this.searchText().toLowerCase();
    return this.clients().filter(c => 
      c.nombre.toLowerCase().includes(term) || 
      (c.cedula && c.cedula.includes(term))
    );
  });

  ngOnInit() {
    this.loadClients();
    this.checkCajaStatus(); // 👈 Verificamos al iniciar
  }

  // 👇 NUEVO: Consultar estado de caja
  checkCajaStatus() {
    this.cashService.getStatus().subscribe({
      next: (res) => {
        this.isBoxOpen.set(res.isOpen);
      },
      error: (err) => console.error('Error verificando caja', err)
    });
  }

  loadClients() {
    this.clientsService.getClients().subscribe(data => {
      this.clients.set(data);
    });
  }

  onSearchChange(val: string) {
    this.searchText.set(val);
  }

  limpiarBusqueda() {
    this.searchText.set('');
  }

  onFocus() {
    // Opcional
  }

  /// Al seleccionar un cliente del buscador
  onOptionSelected(event: any) {
    const val = event.option.value;
    
    if (val === 'NEW_CLIENT') {
      this.router.navigate(['/clients']); 
    } else {
      
      // 👇 BLOQUEO DE SEGURIDAD AQUÍ TAMBIÉN
      if (!this.isBoxOpen()) {
        this.mostrarAlertaCajaCerrada();
        this.searchText.set(''); // Limpiamos para que no parezca que seleccionó
        return;
      }

      this.cartService.setCliente(val);
      this.router.navigate(['/catalog']);
    }
    
    this.searchText.set(''); 
  }

  // ==========================================
  // 👇 NAVEGACIÓN DEL DASHBOARD (LOS BOTONES)
  // ==========================================

  irAVenta() {
    // 👇 BLOQUEO DE SEGURIDAD
    if (!this.isBoxOpen()) {
      this.mostrarAlertaCajaCerrada();
      return;
    }
    
    this.router.navigate(['/catalog']); 
  }

  irAHistorial() {
    this.router.navigate(['/history']);
  }

  irAReportes() {
    this.router.navigate(['/reports']);
  }

  irAClientes() {
    this.router.navigate(['/clients']);
  }

  irAFiados() {
    this.router.navigate(['/fiados']);
  }

  irACaja() {
    this.router.navigate(['/cash-control']);
  }

  irAGastos() {
    // Verificamos si la caja está abierta antes de ir (Opcional, pero recomendado)
    if (!this.isBoxOpen()) {
        this.mostrarAlertaCajaCerrada();
        return;
    }
    this.router.navigate(['/expenses']);
  }

  // 👇 HELPER: Alerta bonita
  private mostrarAlertaCajaCerrada() {
    Swal.fire({
      title: '⛔ Caja Cerrada',
      text: 'No puedes vender sin abrir turno. ¿Quieres ir a abrirla ahora?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Ir a Abrir Caja',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d32f2f' // Rojo alerta
    }).then((result) => {
      if (result.isConfirmed) {
        this.router.navigate(['/cash-control']);
      }
    });
  }
}