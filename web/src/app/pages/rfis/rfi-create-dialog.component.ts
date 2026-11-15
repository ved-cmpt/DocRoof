import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ApiService } from '../../core/api.service';
import { DocumentListItem, Revision, RfiDetail } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { IconComponent } from '../../shared/ui';

export interface RfiCreateData {
  projectId: string;
  /** Prefilled from the document detail page ("Raise RFI on this page"). */
  documentId?: string;
  revisionId?: string;
  page?: number;
}

@Component({
  selector: 'app-rfi-create-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>New RFI</h2>
          <p>The RFI stays pinned to the revision and page you cite.</p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>

      <div class="dlg-body form-grid">
        <div class="field">
          <label class="field-label" for="rfi-doc">Document</label>
          <select
            id="rfi-doc"
            class="select"
            formControlName="documentId"
            (change)="loadRevisions(form.controls.documentId.value)"
          >
            <option value="" disabled>Choose a document…</option>
            @for (d of documents(); track d.id) {
              <option [value]="d.id">{{ d.documentNumber }} · {{ d.title }}</option>
            }
          </select>
          @if (invalid('documentId')) {
            <p class="field-error">Choose the document you are asking about.</p>
          }
        </div>
        <div class="form-row">
          <div class="field">
            <label class="field-label" for="rfi-rev">Revision</label>
            <select id="rfi-rev" class="select" formControlName="revisionId">
              @if (revisions().length === 0) {
                <option value="" disabled>Choose a document first</option>
              }
              @for (r of revisions(); track r.id) {
                <option [value]="r.id">
                  {{ r.versionLabel }}{{ r.isCurrent ? ' (current)' : ' (superseded)' }} ·
                  {{ r.pageCount ?? 1 }} p.
                </option>
              }
            </select>
            @if (invalid('revisionId')) {
              <p class="field-error">Choose a revision.</p>
            }
          </div>
          <div class="field">
            <label class="field-label" for="rfi-page">Page</label>
            <input
              id="rfi-page"
              class="input"
              type="number"
              formControlName="page"
              min="1"
              [max]="maxPage()"
            />
            @if (invalid('page')) {
              <p class="field-error">Enter a page between 1 and {{ maxPage() }}.</p>
            } @else {
              <span class="field-hint">1 – {{ maxPage() }}</span>
            }
          </div>
        </div>
        <div class="field">
          <label class="field-label" for="rfi-subject">Subject</label>
          <input
            id="rfi-subject"
            class="input"
            formControlName="subject"
            maxlength="300"
            autocomplete="off"
          />
          @if (invalid('subject')) {
            <p class="field-error">Subject is required (5–300 characters).</p>
          }
        </div>
        <div class="field">
          <label class="field-label" for="rfi-question">Question</label>
          <textarea
            id="rfi-question"
            class="textarea"
            formControlName="question"
            rows="4"
            maxlength="4000"
          ></textarea>
          @if (invalid('question')) {
            <p class="field-error">Describe the question (at least 10 characters).</p>
          } @else {
            <span class="field-hint">Quote the clause or detail so the reviewer can answer fast.</span>
          }
        </div>
        <label class="check">
          <input type="checkbox" formControlName="submit" />
          Submit now (otherwise save a private draft)
        </label>
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
          {{ busy() ? 'Saving…' : form.value.submit ? 'Create and submit' : 'Save draft' }}
        </button>
      </footer>
    </form>
  `,
})
export class RfiCreateDialogComponent implements OnInit {
  protected readonly data = inject<RfiCreateData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<RfiCreateDialogComponent>);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);

  protected readonly documents = signal<DocumentListItem[]>([]);
  protected readonly revisions = signal<Revision[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly maxPage = signal(1);

  protected readonly form = this.fb.nonNullable.group({
    documentId: [this.data.documentId ?? '', Validators.required],
    revisionId: [this.data.revisionId ?? '', Validators.required],
    page: [this.data.page ?? 1, [Validators.required, Validators.min(1)]],
    subject: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(300)]],
    question: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(4000)]],
    submit: [true],
  });

  ngOnInit(): void {
    this.api
      .documents(this.data.projectId, { pageSize: 100, sort: 'number' })
      .subscribe((r) => this.documents.set(r.items));
    if (this.data.documentId) {
      this.loadRevisions(this.data.documentId, this.data.revisionId);
    }
    this.form.controls.revisionId.valueChanges.subscribe((id) => this.updateMaxPage(id));
  }

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected loadRevisions(documentId: string, preselect?: string): void {
    if (!documentId) {
      return;
    }
    this.api.document(documentId).subscribe((d) => {
      this.revisions.set(d.revisions);
      const id = preselect ?? d.currentRevisionId ?? d.revisions[0]?.id ?? '';
      this.form.controls.revisionId.setValue(id);
      this.updateMaxPage(id);
    });
  }

  private updateMaxPage(revisionId: string): void {
    const max = this.revisions().find((r) => r.id === revisionId)?.pageCount ?? 1;
    this.maxPage.set(max);
    this.form.controls.page.setValidators([
      Validators.required,
      Validators.min(1),
      Validators.max(max),
    ]);
    this.form.controls.page.updateValueAndValidity();
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    this.api
      .createRfi(this.data.projectId, {
        subject: v.subject,
        question: v.question,
        sourceRevisionId: v.revisionId,
        sourcePage: Number(v.page),
        submit: v.submit,
      })
      .subscribe({
        next: (rfi: RfiDetail) => this.ref.close(rfi),
        error: (e) => {
          this.error.set(problemMessage(e, 'The RFI could not be created.'));
          this.busy.set(false);
        },
      });
  }
}
