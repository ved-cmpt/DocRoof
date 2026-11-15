import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { DocumentListItem, Member } from '../../core/api.models';
import { problemMessage } from '../../core/http';

@Component({
  selector: 'app-submittal-create-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>New submittal</h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="fields">
        <mat-form-field appearance="outline">
          <mat-label>Title</mat-label>
          <input matInput formControlName="title" maxlength="300" required />
          <mat-error>Title is required.</mat-error>
        </mat-form-field>
        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Document (current revision is submitted)</mat-label>
            <mat-select formControlName="documentId" required>
              @for (d of documents(); track d.id) {
                <mat-option [value]="d.id"
                  >{{ d.documentNumber }} {{ d.currentVersionLabel }} · {{ d.title }}</mat-option
                >
              }
            </mat-select>
            <mat-error>Choose a document.</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Spec section</mat-label>
            <input matInput formControlName="specSection" placeholder="23 05 00" maxlength="20" />
          </mat-form-field>
        </div>
        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Reviewer</mat-label>
            <mat-select formControlName="reviewerId" required>
              @for (m of reviewers(); track m.userId) {
                <mat-option [value]="m.userId">{{ m.displayName }} · {{ m.jobTitle }}</mat-option>
              }
            </mat-select>
            <mat-error>Choose a reviewer.</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Due date</mat-label>
            <input matInput type="date" formControlName="dueDate" [min]="minDue" required />
            <mat-error>Choose a future due date.</mat-error>
          </mat-form-field>
        </div>
        @if (error()) {
          <div class="error-box" role="alert">{{ error() }}</div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ busy() ? 'Submitting…' : 'Submit for review' }}
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
    @media (max-width: 600px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
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
  protected readonly minDue = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  protected readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    documentId: ['', Validators.required],
    specSection: [''],
    reviewerId: ['', Validators.required],
    dueDate: [
      new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10),
      Validators.required,
    ],
  });

  ngOnInit(): void {
    this.api
      .documents(this.data.projectId, { pageSize: 100, sort: 'number' })
      .subscribe((r) => this.documents.set(r.items));
    this.api.members(this.data.projectId).subscribe((m) => this.members.set(m));
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
