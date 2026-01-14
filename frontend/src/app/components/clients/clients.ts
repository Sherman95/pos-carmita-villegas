import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ClientsService, Client } from '../../services/clients.service';

@Component({
  selector: 'app-clients',
  standalone: true,
  imports: [
    CommonModule, 
    FormsModule, 
    MatCardModule, 
    MatFormFieldModule, 
    MatInputModule, 
    MatButtonModule, 
    MatDialogModule, 
    MatIconModule,
    MatTooltipModule
  ],
  templateUrl: './clients.html',
  styleUrl: './clients.scss'
})
export class ClientsComponent implements OnInit {
  private clientsService = inject(ClientsService);
  private dialog = inject(MatDialog);
  private dialogRef?: MatDialogRef<unknown>;

  @ViewChild('clientFormDialog') formDialog!: TemplateRef<unknown>;

  // SIGNALS
  clients = signal<Client[]>([]);
  loading = signal<boolean>(false);
  searchTerm = signal<string>('');

  // Computado para el buscador
  filteredClients = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.clients();
    return this.clients().filter((c) =>
      c.nombre.toLowerCase().includes(term) ||
      (c.cedula || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term)
    );
  });

  // DATOS DEL FORMULARIO
  form = signal<{ nombre: string; cedula?: string; telefono?: string; email?: string; direccion?: string }>({ 
    nombre: '', cedula: '', telefono: '', email: '', direccion: '' 
  });
  
  // ID DEL CLIENTE SELECCIONADO (Signal)
  selectedClientId = signal<string | null>(null);

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

  // =========================================================
  // FUNCIONES PARA LA LISTA (Nombres en Inglés para coincidir con tu HTML)
  // =========================================================

  showCreateForm() {
    this.resetForm();
    this.openDialog();
  }

  editClient(client: Client) {
    this.selectedClientId.set(client.id);
    this.form.set({
      nombre: client.nombre,
      cedula: client.cedula || '',
      telefono: client.telefono || '',
      email: client.email || '',
      direccion: client.direccion || ''
    });
    this.openDialog();
  }

  deleteClient(id: string) {
    if(!confirm('¿Estás seguro de eliminar este cliente?')) return;
    
    this.clientsService.deleteClient(id).subscribe({
      next: () => this.clients.set(this.clients().filter((c) => c.id !== id)),
      error: (err) => console.error('Error eliminando cliente', err)
    });
  }

  // =========================================================
  // FUNCIONES PARA EL MODAL (Nombres en Español para el nuevo diseño)
  // =========================================================

  guardar() {
    const payload = this.form();
    if (!payload.nombre) return;

    if (this.selectedClientId()) {
      // Editar
      this.clientsService.updateClient(this.selectedClientId()!, payload).subscribe({
        next: (updated) => {
          this.clients.set(this.clients().map((c) => (c.id === updated.id ? updated : c)));
          this.closeDialog();
        },
        error: (err) => console.error('Error actualizando cliente', err)
      });
    } else {
      // Crear
      this.clientsService.createClient(payload).subscribe({
        next: (created) => {
          this.clients.set([created, ...this.clients()]);
          this.closeDialog();
        },
        error: (err) => console.error('Error creando cliente', err)
      });
    }
  }

  cancelar() {
    this.closeDialog();
  }

  updateField<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]) {
    this.form.set({ ...this.form(), [key]: value });
  }

  // =========================================================
  // UTILIDADES PRIVADAS
  // =========================================================

  private openDialog() {
    this.dialogRef = this.dialog.open(this.formDialog, {
      width: '600px',
      autoFocus: true,
      panelClass: 'custom-dialog-container'
    });
    this.dialogRef.afterClosed().subscribe(() => this.resetForm());
  }

  private closeDialog() {
    this.dialogRef?.close();
    this.dialogRef = undefined;
  }

  private resetForm() {
    this.selectedClientId.set(null);
    this.form.set({ nombre: '', cedula: '', telefono: '', email: '', direccion: '' });
  }

  setSearch(term: string) {
    this.searchTerm.set(term || '');
  }
}