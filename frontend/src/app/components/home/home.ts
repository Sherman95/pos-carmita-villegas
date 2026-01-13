import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input'; // <--- IMPORTANTE: Nuevo
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatDividerModule } from '@angular/material/divider'; // <--- IMPORTANTE: Nuevo
import { Router } from '@angular/router';
import { ClientsService, Client } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatCardModule, 
    MatButtonModule, 
    MatIconModule, 
    MatFormFieldModule, 
    MatInputModule,        // <--- Agregado
    MatAutocompleteModule,
    MatDividerModule  // <--- Agregado (y quitamos MatSelectModule)
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class HomeComponent implements OnInit {
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private cartService = inject(CartService);

  // Lista completa de clientes traída del servicio
  clients = signal<Client[]>([]);
  
  // Lo que el usuario escribe en el input
  searchText = signal(''); 
  
  // El ID real que se usará para la venta
  selectedClientId = signal<string>('anon');

  // Filtro en tiempo real para el Autocomplete
  filteredClients = computed(() => {
    const term = this.searchText().toLowerCase().trim();
    // Si no escribe nada, devolvemos toda la lista (o vacía si prefieres no mostrar nada al inicio)
    if (!term) return this.clients();
    
    return this.clients().filter((c) =>
      (c.nombre || '').toLowerCase().includes(term) || 
      (c.cedula || '').toLowerCase().includes(term)
    );
  });

  ngOnInit(): void {
    this.cargarClientes();
    
    // Configuración inicial: Consumidor Final
    this.selectedClientId.set('anon');
    this.searchText.set('Consumidor Final');
    this.cartService.setCliente(null);
  }

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
    });
  }

  // Se ejecuta cuando el usuario hace clic en una opción de la lista
  onOptionSelected(event: any) {
    const val = event.option.value; // Puede ser el objeto cliente o el string 'anon'

    if (val === 'anon') {
      this.selectedClientId.set('anon');
      this.searchText.set('Consumidor Final');
    } else {
      // Es un cliente real
      this.selectedClientId.set(val.id);
      this.searchText.set(val.nombre); // Dejamos el nombre visible en el input
    }
  }

  // Opcional: Limpiar búsqueda al hacer focus (si quieres que sea fácil buscar otro)
  limpiarBusqueda() {
    // Descomenta si quieres que se borre el texto al hacer clic en el input
    // this.searchText.set('');
  }

  irAVenta() {
    const cid = this.selectedClientId();
    // Guardamos en el servicio antes de navegar
    this.cartService.setCliente(cid === 'anon' ? null : cid);
    this.router.navigate(['/catalog']);
  }

  irAClientes() {
    this.router.navigate(['/clients']);
  }

  irAReportes() {
    this.router.navigate(['/reports']);
  }

  irAHistorial() {
    this.router.navigate(['/history']);
  }
}