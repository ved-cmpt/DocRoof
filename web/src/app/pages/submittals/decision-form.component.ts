import { Component, effect, input, output } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { ReviewDecisionType } from '../../core/api.models';

export interface DecisionSubmit {
  decision: ReviewDecisionType;
  comments: string;
}

/** Comments are mandatory unless the submittal is approved as submitted (mirrors the server rule). */
export const commentsRequiredUnlessApproved: ValidatorFn = (
  group: AbstractControl,
): ValidationErrors | null => {
  const decision = group.get('decision')?.value as ReviewDecisionType | '';
  const comments = (group.get('comments')?.value as string | null)?.trim() ?? '';
  return decision && decision !== 'Approved' && comments.length === 0
    ? { commentsRequired: true }
    : null;
};

@Component({
  selector: 'app-decision-form',
  imports: [ReactiveFormsModule, MatRadioModule, MatInputModule, MatButtonModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate aria-labelledby="decision-title">
      <h3 id="decision-title">Record review decision (cycle {{ cycle() }})</h3>
      <mat-radio-group formControlName="decision" aria-label="Decision" class="options">
        <mat-radio-button value="Approved">Approved</mat-radio-button>
        <mat-radio-button value="ApprovedWithComments">Approved with comments</mat-radio-button>
        <mat-radio-button value="ReviseAndResubmit">Revise and resubmit</mat-radio-button>
      </mat-radio-group>
      @if (submitted && form.controls.decision.invalid) {
        <p class="field-error" role="alert">Choose a decision.</p>
      }
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>Review comments</mat-label>
        <textarea matInput formControlName="comments" rows="4" maxlength="4000"></textarea>
      </mat-form-field>
      @if (submitted && form.hasError('commentsRequired')) {
        <p class="field-error" role="alert">
          Comments are required unless the submittal is approved as submitted.
        </p>
      }
      <button mat-flat-button type="submit" [disabled]="busy()">
        {{ busy() ? 'Saving…' : 'Record decision' }}
      </button>
    </form>
  `,
  styles: `
    form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    h3 {
      margin: 0;
    }
    .options {
      display: flex;
      flex-direction: column;
    }
    .field-error {
      color: var(--danger);
      margin: 0;
      font-size: 0.85rem;
    }
  `,
})
export class DecisionFormComponent {
  private readonly fb = inject(FormBuilder);
  readonly cycle = input(1);
  readonly busy = input(false);
  readonly decided = output<DecisionSubmit>();
  protected submitted = false;

  readonly form = this.fb.nonNullable.group(
    {
      decision: ['' as ReviewDecisionType | '', Validators.required],
      comments: ['', Validators.maxLength(4000)],
    },
    { validators: commentsRequiredUnlessApproved },
  );

  constructor() {
    effect(() => {
      this.cycle();
      this.form.reset({ decision: '', comments: '' });
      this.submitted = false;
    });
  }

  submit(): void {
    this.submitted = true;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.decided.emit({ decision: v.decision as ReviewDecisionType, comments: v.comments.trim() });
  }
}
