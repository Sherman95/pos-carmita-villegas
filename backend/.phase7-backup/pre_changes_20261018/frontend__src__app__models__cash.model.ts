export interface CashSession {
  id?: string;
  fecha_apertura?: string;
  monto_inicial: number;
  total_ventas_sistema?: number;
  total_gastos_sistema?: number;
  monto_esperado?: number;
  monto_real?: number;
  diferencia?: number;
  estado?: 'ABIERTA' | 'CERRADA';
}

export interface CashStatus {
  isOpen: boolean;
  session?: CashSession;
  message?: string;
}

export interface ClosingDetails {
  session_id: string;
  fecha_apertura: string;
  monto_inicial: number;
  
  // 👇 Desglose de dinero (Caja vs Banco)
  resumen?: {
    efectivo_ventas: number;
    efectivo_abonos: number;
    digital_total: number;
  };

  total_ventas: number;     // Total real recibido (Caja + Banco)
  total_facturado: number;  // Ventas totales del sistema (incluye fiado)
  credito_otorgado: number; // Lo que se fió
  
  total_gastos: number;        // Gastos totales (Caja + Banco)
  gastos_en_efectivo?: number; // 👈 Agregamos esto (Solo lo que salió del cajón)

  monto_esperado: number;   // Lo que debe haber físicamente
}