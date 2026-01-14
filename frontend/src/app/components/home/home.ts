import { Component, OnInit, computed, inject, signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule, MatAutocompleteTrigger } from '@angular/material/autocomplete';
import { MatDividerModule } from '@angular/material/divider';
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
    MatInputModule,
    MatAutocompleteModule,
    MatDividerModule
  ],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class HomeComponent implements OnInit {
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  public cartService = inject(CartService);

  // Para poder abrir la lista manualmente
  @ViewChild(MatAutocompleteTrigger) autocompleteTrigger!: MatAutocompleteTrigger;

  clients = signal<Client[]>([]);
  searchText = signal(''); 
  
  // LOGICA LISTA DESPLEGABLE:
  filteredClients = computed(() => {
    const term = this.searchText().toLowerCase().trim();
    
    // CAMBIO IMPORTANTE: Si está vacío, devolvemos TODA la lista (para hacer scroll)
    if (!term) return this.clients();
    
    return this.clients().filter((c) =>
      (c.nombre || '').toLowerCase().includes(term) || 
      (c.cedula || '').toLowerCase().includes(term) ||
      (c.telefono || '').includes(term)
    );
  });

  ngOnInit(): void {
    this.cargarClientes();
    this.cartService.setCliente(null);
    this.searchText.set('');
  }

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
    });
  }

  onSearchChange(val: string) {
    this.searchText.set(val);
  }

  // Al tocar la barra, nos aseguramos que se abra la lista
  onFocus() {
    if (!this.searchText()) {
       // Pequeño hack para forzar apertura si ya estaba en foco
       this.autocompleteTrigger?.openPanel();
    }
  }

  onOptionSelected(event: any) {
    const val = event.option.value;

    if (val === 'anon') {
      this.cartService.setCliente(null);
      this.searchText.set('Consumidor Final');
    } 
    else if (val === 'NEW_CLIENT') {
      const nombrePosible = this.searchText();
      if(confirm(`¿Deseas ir a registrar a "${nombrePosible}" ahora?`)) {
        this.router.navigate(['/clients']);
      } else {
        this.limpiarBusqueda();
      }
    } 
    else {
      this.cartService.setCliente(val);
      this.searchText.set(val.nombre);
    }
  }

  limpiarBusqueda() {
    this.searchText.set('');
    this.cartService.setCliente(null);
    // Al limpiar, volvemos a abrir la lista completa
    setTimeout(() => this.autocompleteTrigger?.openPanel(), 100);
  }

  irAVenta() {
    this.router.navigate(['/catalog']);
  }
  irAClientes() { this.router.navigate(['/clients']); }
  irAReportes() { this.router.navigate(['/reports']); }
  irAHistorial() { this.router.navigate(['/history']); }
}