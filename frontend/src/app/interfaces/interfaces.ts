export interface Item {
  id: string;
  nombre: string;
  precio: number;
  tipo: 'PRODUCTO' | 'SERVICIO';
  stock?: number | null;
  active?: boolean;
  duration_minutes?: number | null;
  padding_minutes?: number | null;
  is_reservable?: boolean;
  sidro_image_url?: string | null;
  sidro_image_public_id?: string | null;
}
