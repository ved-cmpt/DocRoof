import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Observable } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CATEGORIES, DISCIPLINES } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { fileSize, label } from '../../core/labels';
import { IconComponent } from '../../shared/ui';

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
  imports: [ReactiveFormsModule, MatDialogModule, IconComponent],
  template: `
    <form class="dlg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <header class="dlg-head">
        <div>
          <h2 mat-dialog-title>
            {{ data.mode === 'document' ? 'Upload document' : 'Upload new revision' }}
          </h2>
          <p>
            {{
              data.mode === 'document'
                ? 'Creates a controlled document with its first revision.'
                : data.documentNumber + ' · earlier revisions stay unchanged.'
            }}
          </p>
        </div>
        <button type="button" class="btn btn-icon" mat-dialog-close aria-label="Close">
          <app-icon name="x" />
        </button>
      </header>

      <div class="dlg-body form-grid">
        @if (data.mode === 'document') {
          <div class="field">
            <label class="field-label" for="up-number">Document number</label>
            <input
              id="up-number"
              class="input mono"
              formControlName="documentNumber"
              placeholder="MCC-M-23 07 00"
              autocomplete="off"
            />
            @if (invalid('documentNumber')) {
              <p class="field-error">Enter 2–60 characters.</p>
            }
          </div>
          <div class="field">
            <label class="field-label" for="up-title">Title</label>
            <input id="up-title" class="input" formControlName="title" autocomplete="off" />
            @if (invalid('title')) {
              <p class="field-error">Title is required.</p>
            }
          </div>
          <div class="form-row">
            <div class="field">
              <label class="field-label" for="up-discipline">Discipline</label>
              <select id="up-discipline" class="select" formControlName="discipline">
                <option value="" disabled>Choose…</option>
                @for (d of disciplines; track d) {
                  <option [value]="d">{{ label(d) }}</option>
                }
              </select>
              @if (invalid('discipline')) {
                <p class="field-error">Choose a discipline.</p>
              }
            </div>
            <div class="field">
              <label class="field-label" for="up-category">Category</label>
              <select id="up-category" class="select" formControlName="category">
                <option value="" disabled>Choose…</option>
                @for (c of categories; track c) {
                  <option [value]="c">{{ label(c) }}</option>
                }
              </select>
              @if (invalid('category')) {
                <p class="field-error">Choose a category.</p>
              }
            </div>
          </div>
        }
        <div class="form-row">
          <div class="field">
            <label class="field-label" for="up-label"
              >Revision label <span class="optional">(optional)</span></label
            >
            <input
              id="up-label"
              class="input mono"
              formControlName="versionLabel"
              [placeholder]="data.suggestedLabel ?? 'R0'"
              autocomplete="off"
            />
            @if (invalid('versionLabel')) {
              <p class="field-error">Letters, digits, dots, dashes or spaces (max 20).</p>
            } @else {
              <span class="field-hint">Empty means {{ data.suggestedLabel ?? 'R0' }}.</span>
            }
          </div>
          <div class="field">
            <label class="field-label" for="up-note"
              >Change note <span class="optional">(optional)</span></label
            >
            <input id="up-note" class="input" formControlName="changeNote" autocomplete="off" />
          </div>
        </div>

        <div class="field">
          <span class="field-label" id="up-file-label">File</span>
          <input
            id="upload-file"
            class="file-input"
            type="file"
            accept=".pdf,.txt,.png,.jpg,.jpeg"
            aria-labelledby="up-file-label"
            aria-describedby="up-file-hint"
            (change)="onFile($event)"
          />
          <label
            class="drop"
            [class.over]="dragging()"
            [class.has-file]="!!file()"
            for="upload-file"
            (dragover)="onDrag($event, true)"
            (dragleave)="dragging.set(false)"
            (drop)="onDrop($event)"
          >
            <app-icon [name]="file() ? 'file-check' : 'upload'" [size]="20" />
            @if (file(); as f) {
              <span class="drop-main">{{ f.name }}</span>
              <span class="field-hint" id="up-file-hint"
                >{{ size(f.size) }} · choose another file to replace it</span
              >
            } @else {
              <span class="drop-main"
                ><span class="link-like">Choose a file</span> or drag it here</span
              >
              <span class="field-hint" id="up-file-hint">PDF, TXT, PNG or JPG · up to 25 MB</span>
            }
          </label>
        </div>

        @if (error()) {
          <div class="alert tone-danger" role="alert">
            <app-icon name="triangle-alert" [size]="16" />
            <p>{{ error() }}</p>
          </div>
        }
        <p class="field-hint note">
          The server checks the real file type, stores a SHA-256 checksum and never changes earlier
          revisions.
        </p>
      </div>

      <footer class="dlg-foot">
        <button type="button" class="btn btn-secondary" mat-dialog-close>Cancel</button>
        <button type="submit" class="btn btn-primary" [disabled]="busy()">
          {{ busy() ? 'Uploading…' : 'Upload' }}
        </button>
      </footer>
    </form>
  `,
  styles: `
    .file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
    }
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 20px 16px;
      border: 1px dashed var(--border-strong);
      border-radius: var(--r-sm);
      background: var(--surface-subtle);
      color: var(--text-2);
      text-align: center;
      cursor: pointer;
      overflow-wrap: anywhere;
    }
    .drop:hover,
    .drop.over {
      border-color: var(--brand);
      background: var(--brand-tint);
    }
    .drop.has-file {
      border-style: solid;
      background: var(--surface);
    }
    .file-input:focus-visible + .drop {
      box-shadow: var(--focus-ring);
    }
    .drop-main {
      color: var(--text);
      font-weight: 500;
    }
    .link-like {
      color: var(--brand);
    }
    .note {
      margin: 0;
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
  protected readonly dragging = signal(false);
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

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const c = this.form.controls[name];
    return c.invalid && (c.touched || c.dirty);
  }

  protected onDrag(event: DragEvent, over: boolean): void {
    event.preventDefault();
    this.dragging.set(over);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const f = event.dataTransfer?.files?.[0];
    if (f) {
      this.file.set(f);
      this.error.set('');
    }
  }

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
