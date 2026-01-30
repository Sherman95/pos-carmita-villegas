import { Component, OnInit, ChangeDetectorRef } from '@angular/core'; // 👈 1. Importado
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { CashService } from '../../services/cash'; 
import { ClosingDetails } from '../../models/cash.model';
import { Router } from '@angular/router';

@Component({
  selector: 'app-cash-control',
  standalone: true,
  imports: [
    CommonModule, FormsModule, 
    MatCardModule, MatButtonModule, MatFormFieldModule, 
    MatInputModule, MatIconModule, MatDividerModule
  ],
  templateUrl: './cash-control.html',
  styleUrls: ['./cash-control.scss']
})
export class CashControlComponent implements OnInit {

  loading = true;
  isOpen = false;
  
  // PARA ABRIR
  initialAmount = 0;

  // PARA CERRAR
  closingData: ClosingDetails | null = null;
  realAmount = 0; // Lo que cuentas en mano
  observaciones = '';

  constructor(
    private cashService: CashService, 
    private router: Router,
    private cd: ChangeDetectorRef // 👈 2. Inyectado aquí
  ) {}

  ngOnInit() {
    this.checkStatus();
  }

  // 1. Verificar cómo está la caja
  checkStatus() {
    this.loading = true;
    this.cashService.getStatus().subscribe({
      next: (res) => {
        this.isOpen = res.isOpen;
        if (this.isOpen) {
          // Si está abierta, traemos los detalles para pre-calcular el cierre
          this.loadClosingDetails();
        } else {
          this.loading = false;
          this.cd.detectChanges(); // 👈 3. ¡Actualizar pantalla YA!
        }
      },
      error: (err) => {
        console.error(err);
        this.loading = false;
        this.cd.detectChanges(); // 👈 3. ¡Actualizar pantalla YA!
      }
    });
  }

  // 2. Cargar datos de cuánto se ha vendido
  loadClosingDetails() {
    this.cashService.getClosingDetails().subscribe({
      next: (data) => {
        this.closingData = data;
        this.loading = false;
        this.cd.detectChanges(); // 👈 3. ¡Actualizar pantalla YA!
      },
      error: (err) => {
        console.error('Error cargando detalles', err);
        this.loading = false;
        this.cd.detectChanges(); // 👈 3. ¡Actualizar pantalla YA!
      }
    });
  }

  // 3. ACCIÓN: ABRIR CAJA 🔓
  openBox() {
    const userId = '00000000-0000-0000-0000-000000000000'; // ID temporal

    this.loading = true;
    this.cashService.openRegister(this.initialAmount, userId).subscribe({
      next: () => {
        alert('✅ ¡Caja Abierta! A vender se ha dicho.');
        this.checkStatus(); // Recargar estado
      },
      error: (err) => {
        alert(err.error?.error || 'Error al abrir');
        this.loading = false;
        this.cd.detectChanges(); // 👈 Por seguridad
      }
    });
  }

  // 4. ACCIÓN: CERRAR CAJA 🔐
  closeBox() {
    if (!this.closingData) return;

    const diff = this.realAmount - this.closingData.monto_esperado;
    let confirmMsg = `El sistema espera $${this.closingData.monto_esperado}\nTú contaste $${this.realAmount}\n\nDiferencia: $${diff}`;
    
    if (diff < 0) confirmMsg += '\n⚠️ ¡FALTA DINERO!';
    if (diff > 0) confirmMsg += '\n🤑 ¡SOBRA DINERO!';
    
    if (!confirm(confirmMsg + '\n\n¿Seguro deseas cerrar el turno?')) return;

    this.loading = true;
    
    const payload = {
      monto_real: this.realAmount,
      observaciones: this.observaciones,
      total_ventas: this.closingData.total_ventas,
      total_gastos: this.closingData.total_gastos,
      monto_esperado: this.closingData.monto_esperado
    };

    this.cashService.closeRegister(this.closingData.session_id, payload).subscribe({
      next: () => {
        alert('🔒 Caja cerrada correctamente. ¡Buen trabajo hoy!');
        this.checkStatus(); // Volver al inicio
      },
      error: (err) => {
        console.error(err);
        alert('Error al cerrar caja');
        this.loading = false;
        this.cd.detectChanges(); // 👈 Por seguridad
      }
    });
  }

  // Getters para la vista
  get difference() {
    if (!this.closingData) return 0;
    return this.realAmount - this.closingData.monto_esperado;
  }
}