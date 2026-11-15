import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ApiService } from '../../core/api.service';
import { DocumentListItem, Member } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { isoDay } from '../../shared/action-dialogs';
import { IconComponent } from '../../shared/ui';

@Component({
  selector: 'app-submittal-create-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>New submittal</h2>
          <p>The document's current revision is submitted for review.</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>
      <div class="dlg-body form-grid">
        <div class="field">
          <label class="field-label" for="sub-title">Title</label>
          <input id="sub-title" class="input" formControlName="title" maxlength="300" autocomplete="off" />
          @if (invalid('title')) {
            <p class="field-error">Title is required (at least 3 characters).</p>
          }
        </div>
        <div class="field">
          <label class="field-label" for="sub-doc">Document</label>
          <select id="sub-doc" class="select" formControlName="documentId">
            <option value="" disabled>Choose a document…</option>
            @for (d of documents(); track d.id) {
              <option [value]="d.id">
                {{ d.documentNumber }} {{ d.currentVersionLabel }} · {{ d.title }}
              </option>
            }
          </select>
          @if (invalid('documentId')) {
            <p class="field-error">Choose a document.</p>
          }
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label" for="sub-spec"
              >Spec section <span class="optional">(optional)</span></label
            >
            <input
              id="sub-spec"
              class="input mono"
              formControlName="specSection"
              placeholder="23 05 00"
              maxlength="20"
              autocomplete="off"
            />
          </div>
          <div class="field">
            <label class="field-label" for="sub-due">Due date</label>
            <input id="sub-due" class="input" type="date" formControlName="dueDate" [min]="minDue" />
            @if (invalid('dueDate')) {
              <p class="field-error">Choose a future due date.</p>
            }
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="sub-reviewer">Reviewer</label>
          <select id="sub-reviewer" class="select" formControlName="reviewerId">
            <option value="" disabled>Choose a reviewer…</option>
            @for (m of reviewers(); track m.userId) {
              <option [value]="m.userId">{{ m.displayName }} · {{ m.jobTitle }}</option>
            }
          </select>
          @if (invalid('reviewerId')) {
            <p class="field-error">Choose a reviewer.</p>
          }
        </div>
        @if (error()) {
          <div class="alert tone-danger" role="alert">
            <app-icon name="triangle-alert" [size]="16" />
            <p>{{ error() }}</p>
          </div>
        }
      </div>
      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">
          {{ busy() ? 'Submitting…' : 'Submit for review' }}
        </button>
      </footer>
    </form>
  `,
})
export class SubmittalCreateDialogComponent implements OnInit {
  protected readonly data = inject<{ projectId: string }>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<SubmittalCreateDialogComponent>);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly documents = signal<DocumentListItem[]>([]);
  protected readonly members = signal<Member[]>([]);
  protected readonly reviewers = computed(() =>
    this.members().filter((m) => m.role === 'Reviewer'),
  );
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly minDue = isoDay(1);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    documentId: ['', Validators.required],
    specSection: [''],
    reviewerId: ['', Validators.required],
    dueDate: [isoDay(10), Validators.required],
  });

  ngOnInit(): void {
    this.api
      .documents(this.data.projectId, { pageSize: 100, sort: 'number' })
      .subscribe((r) => this.documents.set(r.items));
    this.api.members(this.data.projectId).subscribe((m) => this.members.set(m));
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .createSubmittal(this.data.projectId, {
        title: v.title,
        documentId: v.documentId,
        specSection: v.specSection,
        reviewerId: v.reviewerId,
        dueAt: new Date(`${v.dueDate}T17:00:00`).toISOString(),
      })
      .subscribe({
        next: (s) => this.ref.close(s),
        error: (e) => {
          this.error.set(problemMessage(e, 'The submittal could not be created.'));
          this.busy.set(false);
        },
      });
  }
}
