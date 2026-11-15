import { DatePipe } from '@angular/common';
import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuditEvent, Comment } from '../core/api.models';
import { problemMessage } from '../core/http';
import { auditLabel } from '../core/labels';

/** Summarizes an audit event's after-state for display (identifiers and checksums are omitted). */
export function auditSummary(e: AuditEvent): string {
  try {
    const parsed = JSON.parse(e.changeJson) as { after?: Record<string, unknown> };
    return Object.entries(parsed.after ?? {})
      .filter(([k, v]) => v !== null && !/id$|sha/i.test(k))
      .map(
        ([k, v]) =>
          `${k}: ${typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : String(v)}`,
      )
      .join(' · ');
  } catch {
    return '';
  }
}

@Component({
  selector: 'app-timeline',
  imports: [DatePipe],
  template: `
    @if (events().length === 0) {
      <p class="muted empty">No events recorded yet.</p>
    } @else {
      <ol class="timeline" [attr.aria-label]="label()">
        @for (e of events(); track e.id) {
          <li>
            <span class="when small muted">
              <time [attr.datetime]="e.timestamp">{{ e.timestamp | date: 'MMM d, y, HH:mm' }}</time>
            </span>
            <span>
              <strong>{{ e.actor?.displayName ?? 'System' }}</strong> {{ verb(e.action) }}
              @if (showReference() && e.reference) {
                <span class="mono small">{{ e.reference }}</span>
              }
            </span>
            @if (summary(e); as s) {
              <span class="small muted detail">{{ s }}</span>
            }
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .empty {
      padding: 12px 20px;
    }
    .timeline {
      list-style: none;
      margin: 0;
      padding: 8px 20px 16px;
    }
    li {
      display: flex;
      flex-direction: column;
      padding: 8px 0 8px 16px;
      border-left: 2px solid var(--line);
      position: relative;
    }
    li::before {
      content: '';
      position: absolute;
      left: -6px;
      top: 13px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--amber);
      border: 2px solid #fff;
    }
    .detail {
      overflow-wrap: anywhere;
    }
  `,
})
export class TimelineComponent {
  readonly events = input.required<AuditEvent[]>();
  readonly label = input('Timeline');
  readonly showReference = input(false);
  protected readonly verb = auditLabel;
  protected readonly summary = auditSummary;
}

@Component({
  selector: 'app-comments',
  imports: [DatePipe, FormsModule, MatButtonModule, MatInputModule, RouterLink],
  template: `
    @if (comments().length === 0) {
      <p class="muted small">No comments yet.</p>
    }
    <ul class="comments">
      @for (c of comments(); track c.id) {
        <li>
          <div class="meta small">
            <strong>{{ c.author.displayName }}</strong>
            <span class="muted">{{ c.createdAt | date: 'MMM d, HH:mm' }}</span>
            @if (c.page && documentId()) {
              <a
                class="cite"
                [routerLink]="['/app/documents', documentId()]"
                [queryParams]="{ rev: c.revisionId, page: c.page }"
                >{{ c.versionLabel }} · page {{ c.page }}</a
              >
            } @else if (c.page) {
              <span class="cite">page {{ c.page }}</span>
            }
          </div>
          <p class="body">{{ c.body }}</p>
        </li>
      }
    </ul>
    <form class="add" (ngSubmit)="add()" #f="ngForm">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="text">
        <mat-label>Add a comment</mat-label>
        <textarea
          matInput
          name="body"
          [(ngModel)]="body"
          rows="2"
          maxlength="4000"
          required
        ></textarea>
      </mat-form-field>
      @if (revisionId()) {
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="page">
          <mat-label>Page (optional)</mat-label>
          <input matInput type="number" name="page" min="1" [max]="maxPage()" [(ngModel)]="page" />
        </mat-form-field>
      }
      <button mat-stroked-button type="submit" [disabled]="busy() || !body.trim()">Comment</button>
    </form>
    @if (error()) {
      <div class="error-box small" role="alert">{{ error() }}</div>
    }
  `,
  styles: `
    .comments {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    li {
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
    }
    .meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .cite {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--blueprint-soft);
    }
    .body {
      margin: 4px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .add {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      flex-wrap: wrap;
    }
    .text {
      flex: 1 1 260px;
    }
    .page {
      width: 140px;
    }
  `,
})
export class CommentsComponent {
  private readonly api = inject(ApiService);
  readonly resource = input.required<'documents' | 'rfis' | 'submittals'>();
  readonly resourceId = input.required<string>();
  readonly comments = input.required<Comment[]>();
  /** Revision a page citation refers to (enables the page field). */
  readonly revisionId = input<string | null>(null);
  readonly maxPage = input<number | null>(null);
  readonly documentId = input<string | null>(null);
  readonly added = output<Comment>();

  protected body = '';
  protected page: number | null = null;
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected add(): void {
    if (!this.body.trim()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    const page = this.page ? Number(this.page) : null;
    this.api
      .addComment(this.resource(), this.resourceId(), {
        body: this.body.trim(),
        page,
        revisionId: page ? this.revisionId() : null,
      })
      .subscribe({
        next: (c) => {
          this.body = '';
          this.page = null;
          this.busy.set(false);
          this.added.emit(c);
        },
        error: (e) => {
          this.error.set(problemMessage(e, 'The comment could not be saved.'));
          this.busy.set(false);
        },
      });
  }
}
