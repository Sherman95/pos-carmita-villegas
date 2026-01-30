export type ExpenseCategory = 
  | 'INSUMOS_LOCAL' 
  | 'SERVICIOS_BASICOS' 
  | 'MANTENIMIENTO' 
  | 'GASTOS_PERSONALES' 
  | 'ALIMENTACION' 
  | 'SALUD' 
  | 'OTROS'
  | 'TODAS'; // Agregamos TODAS por si acaso para filtros

export interface Expense {
  id?: string;
  descripcion: string;
  monto: number;
  categoria: ExpenseCategory | string;
  fecha?: Date;
  
  // 👇 ESTO ES LO QUE FALTA Y CAUSA EL ERROR
  metodo_pago?: 'EFECTIVO' | 'TRANSFERENCIA'; 
}

export interface ExpensesResponse {
  expenses: Expense[];
  total: number;
}