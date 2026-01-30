import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';

@Component({
  selector: 'app-cash-detail-sheet',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, MatDividerModule],
  templateUrl: './cash-detail-sheet.html',
  styleUrls: ['./cash-detail-sheet.scss']
})
export class CashDetailSheetComponent {
  constructor(
    private _bottomSheetRef: MatBottomSheetRef<CashDetailSheetComponent>,
    @Inject(MAT_BOTTOM_SHEET_DATA) public data: any
  ) {}

  close(): void {
    this._bottomSheetRef.dismiss();
  }
}