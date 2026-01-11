import { Component, OnInit, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ItemsService } from '../../services/items.service';
import { Item } from '../../interfaces/interfaces';
import { PriceDialogComponent } from '../price-dialog/price-dialog';
import { CartService } from '../../services/cart.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatDialogModule],
  templateUrl: './catalog.html',
  styleUrl: './catalog.scss'
})
export class CatalogComponent implements OnInit {
  private itemsService = inject(ItemsService);
  private dialog = inject(MatDialog);
  private cartService = inject(CartService);
  private router = inject(Router);
  private dialogRef?: MatDialogRef<unknown>;

  @ViewChild('serviceFormDialog') formDialog!: TemplateRef<unknown>;

  items = signal<Item[]>([]);
  selectedId = signal<string>('');
  form = signal<{ nombre: string; precio: number | null }>({ nombre: '', precio: null });
  searchTerm = signal<string>('');
  filteredItems = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    if (!term) return this.items();
    return this.items().filter((i) => i.nombre.toLowerCase().includes(term));
  });

  presets: Array<{ nombre: string; precio: number }> = [
    { nombre: 'Manicure', precio: 0 },
    { nombre: 'Pedicure', precio: 0 },
    { nombre: 'Tinturados de cabello', precio: 0 },
    { nombre: 'Keratina', precio: 0 },
    { nombre: 'Tratamiento antifrizz', precio: 0 },
    { nombre: 'Uñas acrílicas', precio: 0 },
    { nombre: 'Depilación con cera y gillette', precio: 0 },
    { nombre: 'Maquillaje', precio: 0 },
    { nombre: 'Peinado', precio: 0 },
  ];

  ngOnInit(): void {
    this.cargarItems();
  }

  irAlHistorial() {
    this.router.navigate(['/history']);
  }
  
  cargarItems() {
    this.itemsService.getItems().subscribe({
      next: (data: Item[]) => {
        // Filtramos solo servicios porque esta vista es de servicios
        this.items.set((data || []).filter((i) => i.tipo === 'SERVICIO'));
      },
      error: (err: any) => {
        console.error('Error al cargar items', err);
      }
    });
  }

  seleccionar(id: string) {
    this.selectedId.set(id);
    const found = this.items().find((i) => i.id === id);
    if (found) {
      this.form.set({ nombre: found.nombre, precio: found.precio });
      this.openDialog();
    }
  }

  limpiar() {
    this.selectedId.set('');
    this.form.set({ nombre: '', precio: null });
  }

  nuevoServicio() {
    this.limpiar();
    this.openDialog();
  }

  updateField<K extends keyof ReturnType<typeof this.form>>(key: K, value: ReturnType<typeof this.form>[K]) {
    this.form.set({ ...this.form(), [key]: value });
  }

  setSearch(term: string) {
    this.searchTerm.set(term || '');
  }

  guardar() {
    const nombre = this.form().nombre?.trim();
    const precio = Number(this.form().precio);
    if (!nombre) return;
    if (Number.isNaN(precio) || precio < 0) return;

    const payload = { nombre, precio, tipo: 'SERVICIO' as const };
    const id = this.selectedId();

    const obs = id ? this.itemsService.updateItem(id, payload) : this.itemsService.createItem(payload);
    obs.subscribe({
      next: () => {
        this.closeDialog();
        this.cargarItems();
      },
      error: (err) => console.error('Error guardando servicio', err)
    });
  }

  cancelar() {
    this.closeDialog();
  }

  seedServicios() {
    const existentes = new Set(this.items().map((i) => i.nombre.toLowerCase()));
    const toCreate = this.presets.filter((p) => !existentes.has(p.nombre.toLowerCase()));
    if (toCreate.length === 0) return;

    toCreate.forEach((s) => {
      this.itemsService.createItem({ nombre: s.nombre, precio: s.precio, tipo: 'SERVICIO' }).subscribe({
        next: () => this.cargarItems(),
        error: (err) => console.error('Error creando servicio', err)
      });
    });
  }

  alTocarItem(item: Item) {
    if (item.tipo === 'SERVICIO') {
      this.abrirDialogoPrecio(item);
    } else {
      this.agregarAlCarrito(item, item.precio);
    }
  }

  abrirDialogoPrecio(item: Item) {
    const dialogRef = this.dialog.open(PriceDialogComponent, {
      width: '300px',
      data: { nombre: item.nombre, precioBase: item.precio }
    });

    dialogRef.afterClosed().subscribe((nuevoPrecio: number) => {
      if (nuevoPrecio !== undefined) {
        this.agregarAlCarrito(item, nuevoPrecio);
      }
    });
  }

  agregarAlCarrito(item: Item, precioFinal: number) {
    this.cartService.agregar(item, precioFinal);
  }

  private openDialog() {
    this.dialogRef = this.dialog.open(this.formDialog, {
      width: '520px',
      autoFocus: true
    });

    this.dialogRef.afterClosed().subscribe(() => this.limpiar());
  }

  private closeDialog() {
    this.dialogRef?.close();
    this.dialogRef = undefined;
  }
}