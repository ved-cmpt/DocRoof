import { Component, effect, inject, input, output } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
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

const OPTIONS: { value: ReviewDecisionType; title: string; hint: string }[] = [
  { value: 'Approved', title: 'Approved', hint: 'Approved as submitted. Comments are optional.' },
  {
    value: 'ApprovedWithComments',
    title: 'Approved with comments',
    hint: 'Work may proceed with the notes below.',
  },
  {
    value: 'ReviseAndResubmit',
    title: 'Revise and resubmit',
    hint: 'A newer revision is required; this starts a new cycle.',
  },
];

/** Review decision fields. Submitted from the dialog footer through the form id. */
@Component({
  selector: 'app-decision-form',
  imports: [ReactiveFormsModule],
  template: `
    <form [id]="formId()" [formGroup]="form" (ngSubmit)="submit()" novalidate class="form-grid">
      <fieldset class="options">
        <legend class="field-label">Decision for cycle {{ cycle() }}</legend>
        @for (o of options; track o.value) {
          <label class="option" [class.selected]="form.value.decision === o.value">
            <input type="radio" formControlName="decision" [value]="o.value" />
            <span>
              <span class="option-title">{{ o.title }}</span>
              <span class="option-hint">{{ o.hint }}</span>
            </span>
          </label>
        }
        @if (submitted && form.controls.decision.invalid) {
          <p class="field-error" role="alert">Choose a decision.</p>
        }
      </fieldset>
      <div class="field">
        <label class="field-label" [for]="formId() + '-comments'">Review comments</label>
        <textarea
          class="textarea"
          [id]="formId() + '-comments'"
          formControlName="comments"
          rows="4"
          maxlength="4000"
        ></textarea>
        @if (submitted && form.hasError('commentsRequired')) {
          <p class="field-error" role="alert">
            Comments are required unless the submittal is approved as submitted.
          </p>
        } @else {
          <span class="field-hint">Shared with the submitter and kept in the audit trail.</span>
        }
      </div>
    </form>
  `,
  styles: `
    .options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin: 0;
      padding: 0;
      border: 0;
    }
    legend {
      margin-bottom: 6px;
      padding: 0;
    }
    .option {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid var(--border-strong);
      border-radius: var(--r-sm);
      cursor: pointer;
    }
    .option:hover {
      background: var(--surface-subtle);
    }
    .option.selected {
      border-color: var(--brand);
      background: var(--brand-tint);
    }
    .option input {
      margin: 3px 0 0;
      accent-color: var(--brand);
    }
    .option-title {
      display: block;
      font-weight: 500;
    }
    .option-hint {
      display: block;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
  `,
})
export class DecisionFormComponent {
  private readonly fb = inject(FormBuilder);
  readonly cycle = input(1);
  readonly formId = input('decision-form');
  readonly decided = output<DecisionSubmit>();
  protected readonly options = OPTIONS;
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
