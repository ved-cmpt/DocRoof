import { Component, effect, inject, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { ReviewQueueItem } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { TopbarComponent } from '../../layout/topbar.component';
import {
  EmptyStateComponent,
  IconComponent,
  PersonComponent,
  ShortDatePipe,
  SkeletonRowsComponent,
  StatusChipComponent,
} from '../../shared/ui';

type Scope = 'me' | 'all' | 'overdue';

/** RFIs and submittals waiting on a reviewer, from the documented vw_ReviewQueue SQL view. */
@Component({
  selector: 'app-review-queue',
  imports: [
    RouterLink,
    TopbarComponent,
    IconComponent,
    StatusChipComponent,
    PersonComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    ShortDatePipe,
  ],
  template: `
    <app-topbar title="Review queue" />
    <div class="page">
      <section class="card" aria-labelledby="queue-title" [attr.aria-busy]="loading()">
        <h2 id="queue-title" class="visually-hidden">Review queue</h2>
        <div class="tabs" role="tablist" aria-label="Queue scope">
          @for (t of tabs; track t.key) {
            <button
              type="button"
              role="tab"
              [id]="'tab-' + t.key"
              [attr.aria-selected]="scope() === t.key"
              [attr.tabindex]="scope() === t.key ? 0 : -1"
              aria-controls="queue-panel"
              (click)="select(t.key)"
              (keydown.arrowRight)="move(1)"
              (keydown.arrowLeft)="move(-1)"
            >
              {{ t.label }}
            </button>
          }
          <span class="spacer"></span>
          <span class="source">From the <code>vw_ReviewQueue</code> view</span>
        </div>
        <div id="queue-panel" role="tabpanel" [attr.aria-labelledby]="'tab-' + scope()">
          @if (error()) {
            <app-empty icon="triangle-alert" heading="The queue could not be loaded" [text]="error()">
              <button type="button" class="btn btn-secondary" (click)="reload()">Try again</button>
            </app-empty>
          } @else if (loading() && items() === null) {
            <app-skeleton-rows label="Loading review queue" [widths]="[8, 10, 36, 10, 14, 8]" />
          } @else if (items(); as list) {
            @if (list.length === 0) {
              <app-empty
                icon="circle-check"
                [heading]="scope() === 'me' ? 'Nothing is waiting on you' : 'The queue is empty'"
                [text]="
                  scope() === 'overdue'
                    ? 'No review is past its due date.'
                    : 'Assigned RFIs and submittals appear here.'
                "
              />
            } @else {
              <div class="table-wrap">
                <table class="table">
                  <caption class="visually-hidden">
                    Review queue items,
                    {{
                      list.length
                    }}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Reference</th>
                      <th scope="col">Title</th>
                      <th scope="col">State</th>
                      <th scope="col">Assignee</th>
                      <th scope="col" class="num-cell">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (q of list; track q.itemId) {
                      <tr class="clickable" (click)="open(q, $event)">
                        <td class="nowrap text-2">
                          <span class="type">
                            <app-icon
                              [name]="q.itemType === 'Rfi' ? 'message-square-text' : 'clipboard-check'"
                              [size]="16"
                            />
                            {{ q.itemType === 'Rfi' ? 'RFI' : 'Submittal' }}
                          </span>
                        </td>
                        <td>
                          <a class="cell-link doc-num" [routerLink]="link(q)">{{ q.reference }}</a>
                        </td>
                        <td class="title-cell">
                          {{ q.title }}<span class="sub">{{ label(q.discipline) }}</span>
                        </td>
                        <td><app-status [value]="q.state" /></td>
                        <td><app-person [name]="q.assignee?.displayName" fallback="Unassigned" /></td>
                        <td class="num-cell">
                          @if (q.isOverdue) {
                            <app-status
                              value="Overdue"
                              [label]="'Overdue ' + (q.daysOverdue ?? 0) + ' d'"
                            />
                          } @else {
                            <span class="text-2">{{ q.dueAt ? (q.dueAt | shortDate) : '—' }}</span>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          }
        </div>
      </section>
    </div>
  `,
  styles: `
    .type {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .source {
      align-self: center;
      color: var(--text-2);
      font-size: var(--fs-12);
      white-space: nowrap;
    }
    @media (max-width: 640px) {
      .source {
        display: none;
      }
    }
  `,
})
export class ReviewQueuePage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);
  protected readonly label = label;
  protected readonly tabs: { key: Scope; label: string }[] = [
    { key: 'me', label: 'Waiting on me' },
    { key: 'all', label: 'Everyone' },
    { key: 'overdue', label: 'Overdue' },
  ];
  protected readonly scope = signal<Scope>('me');
  protected readonly items = signal<ReviewQueueItem[] | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  private sub?: Subscription;

  constructor() {
    effect(() => {
      const id = this.session.project()?.id;
      const scope = this.scope();
      this.session.version();
      untracked(() => this.load(id ?? null, scope));
    });
  }

  private load(projectId: string | null, scope: Scope): void {
    this.sub?.unsubscribe();
    if (!projectId) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sub = this.api
      .reviewQueue(projectId, scope === 'me' ? 'me' : undefined, scope === 'overdue')
      .subscribe({
        next: (q) => {
          this.items.set(q);
          this.loading.set(false);
        },
        error: (e) => {
          this.error.set(problemMessage(e, 'The review queue could not be loaded.'));
          this.loading.set(false);
        },
      });
  }

  protected select(scope: Scope): void {
    this.scope.set(scope);
  }

  protected move(delta: number): void {
    const i = this.tabs.findIndex((t) => t.key === this.scope());
    const next = this.tabs[(i + delta + this.tabs.length) % this.tabs.length];
    this.scope.set(next.key);
    document.getElementById('tab-' + next.key)?.focus();
  }

  protected reload(): void {
    this.load(this.session.project()?.id ?? null, this.scope());
  }

  protected link(q: ReviewQueueItem): string[] {
    return [q.itemType === 'Rfi' ? '/app/rfis' : '/app/submittals', q.itemId];
  }

  protected open(q: ReviewQueueItem, event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('a, button')) {
      void this.router.navigate(this.link(q));
    }
  }
}
