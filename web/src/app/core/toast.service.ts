import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable } from 'rxjs';

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

  /** A small toast with one action; emits when the action is chosen. */
  offer(message: string, action: string, duration = 9000): Observable<void> {
    return this.snack
      .open(message, action, { duration, panelClass: 'toast-offer', politeness: 'polite' })
      .onAction();
  }
}
