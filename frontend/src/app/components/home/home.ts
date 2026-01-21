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

import { ClientsService } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';

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

  @ViewChild('searchInput') searchInput!: ElementRef;

  // Señales para el buscador reactivo
  searchText = signal('');
  clients = signal<any[]>([]);
  
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
    // Opcional: Lógica al enfocar
  }

  /// Al seleccionar un cliente del buscador
  onOptionSelected(event: any) {
    const val = event.option.value;
    
    if (val === 'NEW_CLIENT') {
      this.router.navigate(['/clients']); 
    } else {
      // 👇 AQUÍ ESTABA EL ERROR: Es 'setCliente' (con e al final)
      this.cartService.setCliente(val);
      
      this.router.navigate(['/catalog']);
    }
    
    this.searchText.set(''); 
  }

  // ==========================================
  // 👇 NAVEGACIÓN DEL DASHBOARD (LOS BOTONES)
  // ==========================================

  irAVenta() {
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

  // ✅ ESTA ES LA QUE FALTABA
  irAFiados() {
    this.router.navigate(['/fiados']);
  }
}