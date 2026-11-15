import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { RevisionChip } from '../../core/api.models';
import { IconComponent } from '../../shared/ui';
import { DecisionFormComponent, DecisionSubmit } from './decision-form.component';

export interface DecisionDialogData {
  number: string;
  cycle: number;
  versionLabel: string;
}

@Component({
  selector: 'app-decision-dialog',
  imports: [MatDialogModule, IconComponent, DecisionFormComponent],
  template: `
    <div class="dlg">
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>Record review decision</h2>
          <p>{{ data.number }} · {{ data.versionLabel }} · cycle {{ data.cycle }}</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dlg-body">
        <app-decision-form
          formId="decision-form"
          [cycle]="data.cycle"
          (decided)="ref.close($event)"
        />
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" form="decision-form" class="btn btn-primary">Record decision</button>
      </footer>
    </div>
  `,
})
export class DecisionDialogComponent {
  protected readonly data = inject<DecisionDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<DecisionDialogComponent, DecisionSubmit>);
}

export interface ResubmitDialogData {
  number: string;
  cycle: number;
  revisions: RevisionChip[];
}

@Component({
  selector: 'app-resubmit-dialog',
  imports: [FormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" (ngSubmit)="ref.close(revisionId)">
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>Resubmit for review</h2>
          <p>{{ data.number }} starts cycle {{ data.cycle + 1 }} with a newer revision.</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dlg-body form-grid">
        <div class="field">
          <label class="field-label" for="resubmit-rev">New revision</label>
          <select id="resubmit-rev" class="select" name="rev" [(ngModel)]="revisionId" required>
            @for (r of data.revisions; track r.id) {
              <option [value]="r.id">
                {{ r.versionLabel }}{{ r.isCurrent ? ' (current)' : '' }}
              </option>
            }
          </select>
          <span class="field-hint">The reviewer is notified and a new due date is set.</span>
        </div>
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" class="btn btn-primary" [disabled]="!revisionId">
          Resubmit (cycle {{ data.cycle + 1 }})
        </button>
      </footer>
    </form>
  `,
})
export class ResubmitDialogComponent {
  protected readonly data = inject<ResubmitDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<ResubmitDialogComponent, string>);
  protected revisionId = this.data.revisions.at(-1)?.id ?? '';
}
