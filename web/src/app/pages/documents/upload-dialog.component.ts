import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CATEGORIES, DISCIPLINES } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { fileSize, label } from '../../core/labels';

export interface UploadDialogData {
  mode: 'document' | 'revision';
  projectId?: string;
  documentId?: string;
  documentNumber?: string;
  suggestedLabel?: string;
}

export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.png', '.jpg', '.jpeg'];
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Client-side pre-check for a friendlier message. The server re-validates content with magic-byte sniffing. */
export function precheckFile(file: File | null): string | null {
  if (!file) {
    return 'Choose a file to upload.';
  }
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return 'Only PDF, TXT, PNG and JPG files are allowed.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'The file exceeds the 25 MB limit.';
  }
  if (file.size === 0) {
    return 'The file is empty.';
  }
  return null;
}

@Component({
  selector: 'app-upload-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title>
      {{
        data.mode === 'document'
          ? 'New controlled document'
          : 'Upload new revision of ' + data.documentNumber
      }}
    </h2>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <mat-dialog-content class="fields">
        @if (data.mode === 'document') {
          <mat-form-field appearance="outline">
            <mat-label>Document number</mat-label>
            <input
              matInput
              formControlName="documentNumber"
              placeholder="e.g. MCC-M-23 07 00"
              required
            />
            <mat-error>Document number is required (2–60 characters).</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Title</mat-label>
            <input matInput formControlName="title" required />
            <mat-error>Title is required.</mat-error>
          </mat-form-field>
          <div class="pair">
            <mat-form-field appearance="outline">
              <mat-label>Discipline</mat-label>
              <mat-select formControlName="discipline" required>
                @for (d of disciplines; track d) {
                  <mat-option [value]="d">{{ label(d) }}</mat-option>
                }
              </mat-select>
              <mat-error>Choose a discipline.</mat-error>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Category</mat-label>
              <mat-select formControlName="category" required>
                @for (c of categories; track c) {
                  <mat-option [value]="c">{{ label(c) }}</mat-option>
                }
              </mat-select>
              <mat-error>Choose a category.</mat-error>
            </mat-form-field>
          </div>
        }
        <div class="pair">
          <mat-form-field appearance="outline">
            <mat-label>Revision label</mat-label>
            <input
              matInput
              formControlName="versionLabel"
              [placeholder]="data.suggestedLabel ?? 'R0'"
            />
            <mat-hint>Leave empty for {{ data.suggestedLabel ?? 'R0' }}</mat-hint>
            <mat-error>Letters, digits, dots, dashes or spaces (max 20).</mat-error>
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Change note</mat-label>
            <input matInput formControlName="changeNote" />
          </mat-form-field>
        </div>

        <div class="file-field">
          <label for="upload-file" class="file-label">File (PDF, TXT, PNG or JPG, max 25 MB)</label>
          <input
            id="upload-file"
            type="file"
            accept=".pdf,.txt,.png,.jpg,.jpeg"
            (change)="onFile($event)"
          />
          @if (file(); as f) {
            <p class="small muted">{{ f.name }} · {{ size(f.size) }}</p>
          }
        </div>

        @if (error()) {
          <div class="error-box" role="alert">{{ error() }}</div>
        }
        <p class="small muted">
          The server checks the file's real type from its first bytes, computes a SHA-256 checksum
          and stores it under a generated key. Previous revisions are never modified.
        </p>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button type="submit" [disabled]="busy()">
          {{ busy() ? 'Uploading…' : 'Upload' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: min(560px, 80vw);
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .file-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius);
      margin: 8px 0 12px;
    }
    .file-label {
      font-weight: 600;
    }
    @media (max-width: 600px) {
      .pair {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class UploadDialogComponent {
  protected readonly data = inject<UploadDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<UploadDialogComponent>);
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  protected readonly label = label;
  protected readonly size = fileSize;
  protected readonly disciplines = DISCIPLINES;
  protected readonly categories = CATEGORIES;

  protected readonly file = signal<File | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.nonNullable.group({
    documentNumber: [
      '',
      this.data.mode === 'document'
        ? [Validators.required, Validators.minLength(2), Validators.maxLength(60)]
        : [],
    ],
    title: [
      '',
      this.data.mode === 'document'
        ? [Validators.required, Validators.minLength(2), Validators.maxLength(300)]
        : [],
    ],
    discipline: ['', this.data.mode === 'document' ? [Validators.required] : []],
    category: ['', this.data.mode === 'document' ? [Validators.required] : []],
    versionLabel: ['', [Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9. -]{0,19}$/)]],
    changeNote: ['', [Validators.maxLength(1000)]],
  });

  protected onFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.file.set(input.files?.[0] ?? null);
    this.error.set('');
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const problem = precheckFile(this.file());
    if (problem) {
      this.error.set(problem);
      return;
    }
    const v = this.form.getRawValue();
    const body = new FormData();
    body.append('file', this.file()!);
    if (v.versionLabel) {
      body.append('versionLabel', v.versionLabel);
    }
    if (v.changeNote) {
      body.append('changeNote', v.changeNote);
    }
    let request: Observable<unknown>;
    if (this.data.mode === 'document') {
      body.append('documentNumber', v.documentNumber);
      body.append('title', v.title);
      body.append('discipline', v.discipline);
      body.append('category', v.category);
      request = this.api.createDocument(this.data.projectId!, body);
    } else {
      request = this.api.addRevision(this.data.documentId!, body);
    }
    this.busy.set(true);
    this.error.set('');
    request.subscribe({
      next: (result) => this.ref.close(result),
      error: (e) => {
        this.error.set(problemMessage(e, 'Upload failed.'));
        this.busy.set(false);
      },
    });
  }
}
