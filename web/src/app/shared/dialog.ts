import { ComponentType } from '@angular/cdk/portal';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';

/**
 * Opens a dialog with the shared anatomy: 560 px on desktop, a full-screen sheet below 600 px, scrolling body,
 * focus on the first field.
 */
export function openDialog<C, D, R>(
  dialog: MatDialog,
  component: ComponentType<C>,
  data: D,
): MatDialogRef<C, R> {
  return dialog.open<C, D, R>(component, {
    data,
    panelClass: 'dr-dialog',
    backdropClass: 'dr-backdrop',
    autoFocus: 'first-tabbable',
    restoreFocus: true,
    maxWidth: '100vw',
  });
}
