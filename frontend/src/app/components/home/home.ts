import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { Router } from '@angular/router';
import { ClientsService, Client } from '../../services/clients.service';
import { CartService } from '../../services/cart.service';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatSelectModule],
  templateUrl: './home.html',
  styleUrl: './home.scss'
})
export class HomeComponent implements OnInit {
  private router = inject(Router);
  private clientsService = inject(ClientsService);
  private cartService = inject(CartService);

  clients = signal<Client[]>([]);
  selectedClientId = signal<string>('');

  clienteOpciones = computed(() => [{ id: 'anon', nombre: 'Consumidor final' }, ...this.clients()]);

  ngOnInit(): void {
    this.cargarClientes();
    this.selectedClientId.set('anon');
    this.cartService.setCliente(null);
  }

  irAVenta() {
    const cid = this.selectedClientId();
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

  cargarClientes() {
    this.clientsService.getClients().subscribe({
      next: (data) => this.clients.set(data || []),
      error: (err) => console.error('Error cargando clientes', err)
    });
  }
}
