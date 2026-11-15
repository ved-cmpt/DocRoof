import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuditEvent, Comment } from '../core/api.models';
import { problemMessage } from '../core/http';
import { EventText, describeEvent } from './activity';
import { AvatarComponent, IconComponent, LongDateTimePipe, RelativeTimePipe } from './ui';

interface Row {
  event: AuditEvent;
  text: EventText;
}

/** Activity as a clean vertical list: avatar, one short sentence, relative time. */
@Component({
  selector: 'app-timeline',
  imports: [AvatarComponent, RelativeTimePipe, LongDateTimePipe],
  template: `
    @if (rows().length === 0) {
      <p class="none">No activity yet.</p>
    } @else {
      <ol class="feed" [attr.aria-label]="label()">
        @for (r of rows(); track r.event.id) {
          <li>
            <app-avatar [name]="r.event.actor?.displayName ?? 'System'" />
            <div class="body">
              <p class="line">
                <strong>{{ r.event.actor?.displayName ?? 'System' }}</strong>
                {{ r.text.verb }}
                @if (r.text.object) {
                  <span class="obj">{{ r.text.object }}</span>
                }
                @if (r.text.meta) {
                  <span class="meta"> · {{ r.text.meta }}</span>
                }
              </p>
              @if (r.text.quote) {
                <p class="quote">“{{ r.text.quote }}”</p>
              }
            </div>
            <time [attr.datetime]="r.event.timestamp" [title]="r.event.timestamp | longDate">{{
              r.event.timestamp | relTime
            }}</time>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .none {
      margin: 0;
      padding: 16px;
      color: var(--text-2);
    }
    .feed {
      list-style: none;
      margin: 0;
      padding: 8px 16px 12px;
    }
    li {
      position: relative;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
      gap: 10px;
      padding: 8px 0;
    }
    li:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 11.5px;
      top: 36px;
      bottom: -6px;
      width: 1px;
      background: var(--border);
    }
    .body {
      min-width: 0;
    }
    .line {
      margin: 2px 0 0;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    strong {
      font-weight: 600;
    }
    .obj {
      font-weight: 500;
    }
    .meta {
      color: var(--text-2);
    }
    .quote {
      margin: 4px 0 0;
      color: var(--text-2);
      font-size: var(--fs-13);
      overflow-wrap: anywhere;
    }
    time {
      color: var(--text-2);
      font-size: var(--fs-12);
      white-space: nowrap;
      padding-top: 3px;
    }
  `,
})
export class TimelineComponent {
  readonly events = input.required<AuditEvent[]>();
  readonly label = input('Activity');
  /** Newest first unless told otherwise. */
  readonly newestFirst = input(true);
  protected readonly rows = computed<Row[]>(() => {
    const sorted = [...this.events()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (this.newestFirst()) {
      sorted.reverse();
    }
    return sorted.map((event) => ({ event, text: describeEvent(event) }));
  });
}

@Component({
  selector: 'app-comments',
  imports: [FormsModule, RouterLink, AvatarComponent, IconComponent, RelativeTimePipe, LongDateTimePipe],
  template: `
    @if (comments().length === 0) {
      <p class="none">No comments yet. Start the conversation below.</p>
    } @else {
      <ul class="comments">
        @for (c of comments(); track c.id) {
          <li>
            <app-avatar [name]="c.author.displayName" />
            <div class="body">
              <div class="meta">
                <strong>{{ c.author.displayName }}</strong>
                <time [attr.datetime]="c.createdAt" [title]="c.createdAt | longDate">{{
                  c.createdAt | relTime
                }}</time>
                @if (c.page && documentId()) {
                  <a
                    class="cite"
                    [routerLink]="['/app/documents', documentId()]"
                    [queryParams]="{ rev: c.revisionId, page: c.page }"
                    >{{ c.versionLabel }} · p.{{ c.page }}</a
                  >
                } @else if (c.page) {
                  <span class="cite">p.{{ c.page }}</span>
                }
              </div>
              <p class="text">{{ c.body }}</p>
            </div>
          </li>
        }
      </ul>
    }
    <form class="composer" (ngSubmit)="add()">
      <label class="visually-hidden" [for]="'comment-' + resourceId()">Add a comment</label>
      <textarea
        class="textarea"
        [id]="'comment-' + resourceId()"
        name="body"
        [(ngModel)]="body"
        rows="2"
        maxlength="4000"
        placeholder="Write a comment…"
      ></textarea>
      <div class="composer-foot">
        @if (revisionId()) {
          <label class="page-field">
            <span>Cite page</span>
            <input
              class="input input-sm"
              type="number"
              name="page"
              min="1"
              [max]="maxPage()"
              [(ngModel)]="page"
              placeholder="—"
            />
          </label>
        }
        <span class="spacer"></span>
        <button class="btn btn-secondary btn-sm" type="submit" [disabled]="busy() || !body.trim()">
          <app-icon name="send" [size]="16" /> Comment
        </button>
      </div>
      @if (error()) {
        <p class="field-error" role="alert">{{ error() }}</p>
      }
    </form>
  `,
  styles: `
    .none {
      margin: 0 0 12px;
      color: var(--text-2);
    }
    .comments {
      list-style: none;
      margin: 0 0 12px;
      padding: 0;
    }
    li {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 10px;
      padding: 8px 0;
    }
    .meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: var(--fs-13);
    }
    time {
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .cite {
      font-family: var(--font-mono);
      font-size: var(--fs-12);
      padding: 1px 6px;
      border-radius: var(--r-sm);
      background: var(--brand-tint);
      color: var(--brand-hover);
    }
    .text {
      margin: 2px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .composer {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .textarea {
      min-height: 64px;
    }
    .composer-foot {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .page-field {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .page-field .input {
      width: 72px;
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
