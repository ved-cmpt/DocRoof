import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { DocumentListItem, Revision, RfiDetail } from '../../core/api.models';
import { problemMessage } from '../../core/http';

export interface RfiCreateData {
  projectId: string;
  /** Prefilled from the document detail page ("Raise RFI on this page"). */
  documentId?: string;
  revisionId?: string;
  page?: number;
}

@Component({
  selector: 'app-rfi-create-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
  ],
  template: `
    <h2 mat-dialog-title>New RFI</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="fields">
        <p class="small muted">
          An RFI cites one exact document revision and page. The citation stays pinned to that
          revision even after newer revisions are issued.
        </p>
        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Document</mat-label>
            <mat-select
              formControlName="documentId"
              (selectionChange)="loadRevisions($event.value)"
              required
            >
              @for (d of documents(); track d.id) {
                <mat-option [value]="d.id">{{ d.documentNumber }} · {{ d.title }}</mat-option>
              }
            </mat-select>
            <mat-error>Choose the document you are asking about.</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Revision</mat-label>
            <mat-select formControlName="revisionId" required>
              @for (r of revisions(); track r.id) {
                <mat-option [value]="r.id"
                  >{{ r.versionLabel }}{{ r.isCurrent ? ' (current)' : ' (superseded)' }} ·
                  {{ r.pageCount ?? 1 }} p.</mat-option
                >
              }
            </mat-select>
            <mat-error>Choose a revision.</mat-error>
          </mat-form-field>
        </div>
        <mat-form-field appearance="outline" class="page">
          <mat-label>Page</mat-label>
          <input matInput type="number" formControlName="page" min="1" [max]="maxPage()" required />
          <mat-hint>1 – {{ maxPage() }}</mat-hint>
          <mat-error>Enter a page between 1 and {{ maxPage() }}.</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Subject</mat-label>
          <input matInput formControlName="subject" maxlength="300" required />
          <mat-error>Subject is required (5–300 characters).</mat-error>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>Question</mat-label>
          <textarea
            matInput
            formControlName="question"
            rows="4"
            maxlength="4000"
            required
          ></textarea>
          <mat-error>Describe the question (at least 10 characters).</mat-error>
        </mat-form-field>
        <mat-checkbox formControlName="submit"
          >Submit now (otherwise save as a private draft)</mat-checkbox
        >
        @if (error()) {
          <div class="error-box" role="alert">{{ error() }}</div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ busy() ? 'Saving…' : form.value.submit ? 'Create and submit' : 'Save draft' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: min(620px, 80vw);
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .page {
      width: 160px;
    }
    @media (max-width: 600px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
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

  protected loadRevisions(documentId: string, preselect?: string): void {
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
