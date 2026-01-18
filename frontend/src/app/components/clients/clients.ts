import {
  Component,
  OnInit,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal
} from '@angular/core';
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

  // =========================
  // SIGNALS
  // =========================
  clients = signal<Client[]>([]);
  loading = signal<boolean>(false);
  searchTerm = signal<string>('');

  // Error dentro del modal
  formError = signal<string | null>(null);

  // =========================
  // FORMULARIO
  // =========================
  form = signal<{
    nombre: string;
    cedula?: string;
    telefono?: string;
    email?: string;
    direccion?: string;
  }>({
    nombre: '',
    cedula: '',
    telefono: '',
    email: '',
    direccion: ''
  });

  selectedClientId = signal<string | null>(null);

  // =========================
  // COMPUTED
  // =========================
  filteredClients = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.clients();

    return this.clients().filter(c =>
      c.nombre.toLowerCase().includes(term) ||
      (c.cedula || '').toLowerCase().includes(term) ||
      (c.email || '').toLowerCase().includes(term)
    );
  });

  // =========================
  // INIT
  // =========================
  ngOnInit(): void {
    this.loadClients();
  }

  loadClients() {
    this.loading.set(true);
    this.clientsService.getClients().subscribe({
      next: data => {
        this.clients.set(data || []);
        this.loading.set(false);
      },
      error: err => {
        console.error('Error cargando clientes', err);
        this.loading.set(false);
      }
    });
  }

  // =========================
  // LISTA
  // =========================
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
    if (!confirm('¿Eliminar este cliente?')) return;

    this.clientsService.deleteClient(id).subscribe({
      next: () => {
        this.clients.set(this.clients().filter(c => c.id !== id));
      },
      error: err => console.error('Error eliminando cliente', err)
    });
  }

  // =========================
  // MODAL
  // =========================
  guardar() {
    const payload = this.form();
    if (!payload.nombre) return;

    this.formError.set(null);

    if (this.selectedClientId()) {
      // EDITAR
      this.clientsService
        .updateClient(this.selectedClientId()!, payload)
        .subscribe({
          next: updated => {
            this.clients.set(
              this.clients().map(c => c.id === updated.id ? updated : c)
            );
            this.closeDialog();
          },
          error: err => this.manejarErrorBackend(err)
        });
    } else {
      // CREAR
      this.clientsService.createClient(payload).subscribe({
        next: created => {
          this.clients.set([created, ...this.clients()]);
          this.closeDialog();
        },
        error: err => this.manejarErrorBackend(err)
      });
    }
  }

  cancelar() {
    this.closeDialog();
  }

  updateField<K extends keyof ReturnType<typeof this.form>>(
    key: K,
    value: ReturnType<typeof this.form>[K]
  ) {
    this.form.set({ ...this.form(), [key]: value });
  }

  // =========================
  // MANEJO DE ERRORES
  // =========================
  private manejarErrorBackend(err: any) {
    const errorBody = err.error;
    const mensajeServidor =
      errorBody?.error ||
      errorBody?.message ||
      JSON.stringify(errorBody) ||
      '';

    const mensajeLower = mensajeServidor.toLowerCase();
    let mensaje = 'Ocurrió un error al guardar.';

    if (
      mensajeLower.includes('unique') ||
      mensajeLower.includes('duplicate') ||
      mensajeLower.includes('ya existe')
    ) {
      mensaje = '⚠️ Esa CÉDULA ya está registrada.';
    }
    else if (mensajeLower.includes('check_cedula_length')) {
      mensaje = '⚠️ La identificación debe tener 10 o 13 dígitos.';
    }
    else if (mensajeLower.includes('check_telefono_length')) {
      mensaje = '⚠️ El teléfono no debe tener más de 10 dígitos.';
    }
    else if (err.status === 500) {
      mensaje = '⚠️ Verifica la cédula y el teléfono.';
    }

    this.formError.set(mensaje);
  }

  // =========================
  // DIALOG
  // =========================
  private openDialog() {
    this.formError.set(null);
    this.dialogRef = this.dialog.open(this.formDialog, {
      width: '600px',
      autoFocus: true
    });
  }

  private closeDialog() {
    this.dialogRef?.close();
    this.dialogRef = undefined;
  }

  private resetForm() {
    this.selectedClientId.set(null);
    this.formError.set(null);
    this.form.set({
      nombre: '',
      cedula: '',
      telefono: '',
      email: '',
      direccion: ''
    });
  }

  setSearch(term: string) {
    this.searchTerm.set(term || '');
  }
}
