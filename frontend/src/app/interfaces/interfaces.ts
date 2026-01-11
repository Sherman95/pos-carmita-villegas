export interface Item {
  id: string;
  nombre: string;
  precio: number;
  tipo: 'PRODUCTO' | 'SERVICIO';
  stock?: number | null;
}