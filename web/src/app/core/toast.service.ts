import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snack = inject(MatSnackBar);

  success(message: string): void {
    this.snack.open(message, 'Dismiss', {
      duration: 4000,
      panelClass: 'toast-success',
      politeness: 'polite',
    });
  }

  error(message: string): void {
    this.snack.open(message, 'Dismiss', {
      duration: 7000,
      panelClass: 'toast-error',
      politeness: 'assertive',
    });
  }
}
