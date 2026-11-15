import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Member } from '../core/api.models';
import { IconComponent } from './ui';

export interface AssignDialogData {
  title: string;
  subtitle: string;
  reviewers: Member[];
  assigneeId: string;
  /** yyyy-mm-dd */
  dueDate: string;
  confirm: string;
}

export interface AssignResult {
  assigneeId: string;
  dueAt: string;
}

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

@Component({
  selector: 'app-assign-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>{{ data.title }}</h2>
          <p>{{ data.subtitle }}</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dlg-body form-grid">
        <div class="field">
          <label class="field-label" for="assign-reviewer">Reviewer</label>
          <select id="assign-reviewer" class="select" formControlName="assigneeId">
            <option value="" disabled>Choose a reviewer…</option>
            @for (m of data.reviewers; track m.userId) {
              <option [value]="m.userId">{{ m.displayName }} · {{ m.jobTitle }}</option>
            }
          </select>
          @if (form.controls.assigneeId.invalid && form.controls.assigneeId.touched) {
            <p class="field-error">Choose a reviewer.</p>
          }
        </div>
        <div class="field">
          <label class="field-label" for="assign-due">Due date</label>
          <input id="assign-due" class="input" type="date" formControlName="dueDate" [min]="minDue" />
          @if (form.controls.dueDate.invalid && form.controls.dueDate.touched) {
            <p class="field-error">Choose a date from tomorrow on.</p>
          } @else {
            <span class="field-hint">Due at 17:00 on that day. Overdue items get a reminder.</span>
          }
        </div>
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" class="btn btn-primary">{{ data.confirm }}</button>
      </footer>
    </form>
  `,
})
export class AssignDialogComponent {
  protected readonly data = inject<AssignDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<AssignDialogComponent, AssignResult>);
  protected readonly minDue = isoDay(1);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    assigneeId: [this.data.assigneeId, Validators.required],
    dueDate: [this.data.dueDate, Validators.required],
  });

  protected submit(): void {
    if (this.form.invalid || this.form.value.dueDate! < this.minDue) {
      this.form.markAllAsTouched();
      this.form.controls.dueDate.setErrors(
        this.form.value.dueDate! < this.minDue ? { min: true } : this.form.controls.dueDate.errors,
      );
      return;
    }
    const v = this.form.getRawValue();
    this.ref.close({
      assigneeId: v.assigneeId,
      dueAt: new Date(`${v.dueDate}T17:00:00`).toISOString(),
    });
  }
}

export interface ReasonDialogData {
  title: string;
  subtitle: string;
  label: string;
  confirm: string;
  danger?: boolean;
}

/** Asks for a short reason (return an answer, reopen an RFI). */
@Component({
  selector: 'app-reason-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>{{ data.title }}</h2>
          <p>{{ data.subtitle }}</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dlg-body form-grid">
        <div class="field">
          <label class="field-label" for="reason-text">{{ data.label }}</label>
          <textarea
            id="reason-text"
            class="textarea"
            formControlName="reason"
            rows="3"
            maxlength="1000"
          ></textarea>
          @if (form.controls.reason.invalid && form.controls.reason.touched) {
            <p class="field-error">Give a reason (at least 5 characters).</p>
          } @else {
            <span class="field-hint">Recorded in the audit trail.</span>
          }
        </div>
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" class="btn" [class.btn-danger]="data.danger" [class.btn-primary]="!data.danger">
          {{ data.confirm }}
        </button>
      </footer>
    </form>
  `,
})
export class ReasonDialogComponent {
  protected readonly data = inject<ReasonDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ReasonDialogComponent, string>);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    reason: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(1000)]],
  });

  protected submit(): void {
    const reason = this.form.value.reason?.trim() ?? '';
    if (reason.length < 5) {
      this.form.controls.reason.setErrors({ minlength: true });
      this.form.markAllAsTouched();
      return;
    }
    this.ref.close(reason);
  }
}

export { isoDay };
