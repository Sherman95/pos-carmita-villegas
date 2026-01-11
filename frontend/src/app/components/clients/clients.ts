import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { ClientsService, Client } from '../../services/clients.service';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  templateUrl: './clients.html',
  styleUrl: './clients.scss'
})
export class ClientsComponent implements OnInit {
  private clientsService = inject(ClientsService);

  clients = signal<Client[]>([]);
  loading = signal<boolean>(false);

  form = signal<{ nombre: string; cedula?: string; telefono?: string; email?: string }>({ nombre: '', cedula: '', telefono: '', email: '' });
  editingId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadClients();
  }

  loadClients() {
    this.loading.set(true);
    this.clientsService.getClients().subscribe({
      next: (data) => {
        this.clients.set(data || []);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error cargando clientes', err);
        this.loading.set(false);
      }
    });
  }

  saveClient() {
    const payload = this.form();
    if (!payload.nombre) return;

    if (this.editingId()) {
      this.clientsService.updateClient(this.editingId()!, payload).subscribe({
        next: (updated) => {
          this.clients.set(this.clients().map((c) => (c.id === updated.id ? updated : c)));
          this.resetForm();
        },
        error: (err) => console.error('Error actualizando cliente', err)
      });
      return;
    }

    this.clientsService.createClient(payload).subscribe({
      next: (created) => {
        this.clients.set([created, ...this.clients()]);
        this.resetForm();
      },
      error: (err) => console.error('Error creando cliente', err)
    });
  }

  editClient(client: Client) {
    this.editingId.set(client.id);
    this.form.set({
      nombre: client.nombre,
      cedula: client.cedula || '',
      telefono: client.telefono || '',
      email: client.email || ''
    });
  }

  cancelEdit() {
    this.resetForm();
  }

  private resetForm() {
    this.editingId.set(null);
    this.form.set({ nombre: '', cedula: '', telefono: '', email: '' });
  }

  deleteClient(id: string) {
    this.clientsService.deleteClient(id).subscribe({
      next: () => this.clients.set(this.clients().filter((c) => c.id !== id)),
      error: (err) => console.error('Error eliminando cliente', err)
    });
  }

  updateField<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]) {
    this.form.set({ ...this.form(), [key]: value });
  }
}
