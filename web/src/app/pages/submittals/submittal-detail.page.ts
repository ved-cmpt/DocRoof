import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Comment, SubmittalAction, SubmittalDetail, SubmittalStatus } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { CommentsComponent, TimelineComponent } from '../../shared/activity.components';
import { openDialog } from '../../shared/dialog';
import {
  AvatarComponent,
  EmptyStateComponent,
  IconComponent,
  LongDateTimePipe,
  PersonComponent,
  RelativeTimePipe,
  ShortDatePipe,
  StatusChipComponent,
} from '../../shared/ui';
import { DecisionSubmit } from './decision-form.component';
import {
  DecisionDialogComponent,
  DecisionDialogData,
  ResubmitDialogComponent,
  ResubmitDialogData,
} from './submittal-dialogs';

const WAITING_ON: Record<SubmittalStatus, string> = {
  Submitted: 'The assigned reviewer starts the review next.',
  InReview: 'The assigned reviewer records a decision next.',
  Approved: 'A document controller or project manager finalizes it next.',
  ApprovedWithComments: 'A document controller or project manager finalizes it next.',
  ReviseAndResubmit: 'A document controller resubmits it with a newer revision.',
  Final: 'This submittal is final.',
};

@Component({
  selector: 'app-submittal-detail',
  imports: [
    RouterLink,
    MatTooltipModule,
    TopbarComponent,
    IconComponent,
    StatusChipComponent,
    AvatarComponent,
    PersonComponent,
    EmptyStateComponent,
    RelativeTimePipe,
    ShortDatePipe,
    LongDateTimePipe,
    CommentsComponent,
    TimelineComponent,
  ],
  template: `
    <app-topbar
      [title]="s()?.number ?? 'Submittal'"
      [monoTitle]="!!s()"
      [crumbs]="[{ label: 'Submittals', link: '/app/submittals' }]"
    />
    <div class="page">
      @if (loading() && !s()) {
        <div class="record" role="status" aria-label="Loading submittal">
          <div class="card card-body stack">
            <span class="skeleton" style="width: 50%"></span><span class="skeleton"></span>
          </div>
          <div class="card card-body stack"><span class="skeleton"></span></div>
        </div>
      } @else if (notFound()) {
        <section class="card">
          <app-empty
            icon="clipboard-check"
            heading="Submittal not found"
            text="It does not exist or belongs to a project you are not a member of."
          >
            <a class="btn btn-secondary" routerLink="/app/submittals">Back to submittals</a>
          </app-empty>
        </section>
      } @else if (error()) {
        <section class="card">
          <app-empty icon="triangle-alert" heading="The submittal could not be loaded" [text]="error()">
            <button type="button" class="btn btn-secondary" (click)="load(id())">Try again</button>
          </app-empty>
        </section>
      } @else if (s(); as x) {
        <div class="record-head">
          <div>
            <span class="ref">Spec {{ x.specSection || '—' }} · {{ label(x.discipline) }}</span>
            <h2>{{ x.title }}</h2>
          </div>
          <div class="head-actions">
            <app-status [value]="x.status" data-testid="submittal-status" />
            @if (can('StartReview')) {
              <button
                type="button"
                class="btn btn-primary"
                (click)="run('start-review', {})"
                [disabled]="busy()"
              >
                <app-icon name="eye" [size]="16" /> Start review
              </button>
            }
            @if (can('Decide')) {
              <button
                type="button"
                class="btn btn-primary"
                (click)="openDecision()"
                [disabled]="busy()"
              >
                <app-icon name="clipboard-check" [size]="16" /> Record decision
              </button>
            }
            @if (can('Resubmit')) {
              <button type="button" class="btn btn-primary" (click)="openResubmit()" [disabled]="busy()">
                <app-icon name="refresh-cw" [size]="16" /> Resubmit
              </button>
            }
            @if (can('Finalize')) {
              <button
                type="button"
                class="btn btn-primary"
                (click)="run('finalize', {})"
                [disabled]="busy()"
              >
                <app-icon name="file-check" [size]="16" /> Finalize
              </button>
            }
            @if (x.availableActions.length === 0) {
              <span
                class="no-actions"
                tabindex="0"
                data-testid="no-actions"
                [matTooltip]="waitingOn()"
                [attr.aria-label]="'No actions for your role. ' + waitingOn()"
              >
                <button type="button" class="btn btn-secondary" disabled tabindex="-1">
                  No action for your role
                </button>
              </span>
            }
          </div>
        </div>

        @if (actionError()) {
          <div class="alert tone-danger action-error" role="alert">
            <app-icon name="triangle-alert" [size]="16" />
            <p>{{ actionError() }}</p>
          </div>
        }

        <div class="record">
          <div class="stack">
            <section class="card" aria-labelledby="rev-title">
              <div class="card-header"><h2 id="rev-title">Submitted revision</h2></div>
              <div class="card-body">
                <a
                  class="citation"
                  [routerLink]="['/app/documents', x.documentId]"
                  [queryParams]="{ rev: x.revisionId }"
                >
                  <app-icon name="file-text" [size]="20" />
                  <span class="cite-text">
                    <span class="cite-doc"
                      ><span class="mono">{{ x.documentNumber }}</span> {{ x.documentTitle }}</span
                    >
                    <span class="cite-where"
                      >Revision {{ x.versionLabel }} · review status
                      {{ label(x.revisionApprovalStatus).toLowerCase() }}</span
                    >
                  </span>
                  <app-icon name="arrow-right" [size]="16" />
                </a>
                @if (x.status === 'ReviseAndResubmit' && !can('Resubmit')) {
                  <div class="alert tone-warning" role="note">
                    <app-icon name="upload" [size]="16" />
                    <p>
                      Revise &amp; resubmit needs a newer revision. Upload it on
                      <a [routerLink]="['/app/documents', x.documentId]">{{ x.documentNumber }}</a>
                      first.
                    </p>
                  </div>
                }
              </div>
            </section>

            <section class="card" aria-labelledby="dec-title">
              <div class="card-header">
                <h2 id="dec-title">Review decisions</h2>
                <span class="meta">{{ x.decisions.length }}</span>
              </div>
              @if (x.decisions.length === 0) {
                <p class="card-body none">No decision recorded yet.</p>
              } @else {
                <ul class="decisions">
                  @for (d of x.decisions; track d.id) {
                    <li>
                      <app-avatar [name]="d.reviewer.displayName" />
                      <div class="dec-body">
                        <div class="dec-meta">
                          <strong>{{ d.reviewer.displayName }}</strong>
                          <app-status [value]="d.decision" />
                          <span class="text-2">Cycle {{ d.cycle }} · {{ d.versionLabel }}</span>
                          <time [attr.datetime]="d.createdAt" [title]="d.createdAt | longDate">{{
                            d.createdAt | relTime
                          }}</time>
                        </div>
                        @if (d.comments) {
                          <p class="dec-text">{{ d.comments }}</p>
                        }
                      </div>
                    </li>
                  }
                </ul>
              }
            </section>

            <section class="card" aria-label="Discussion and activity">
              <div class="tabs" role="tablist" aria-label="Submittal sections">
                <button
                  type="button"
                  role="tab"
                  id="sub-tab-comments"
                  [attr.aria-selected]="tab() === 'comments'"
                  [attr.tabindex]="tab() === 'comments' ? 0 : -1"
                  aria-controls="sub-tabpanel"
                  (click)="tab.set('comments')"
                  (keydown.arrowRight)="moveTab()"
                  (keydown.arrowLeft)="moveTab()"
                >
                  Comments <span class="tab-count">{{ x.comments.length }}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  id="sub-tab-activity"
                  [attr.aria-selected]="tab() === 'activity'"
                  [attr.tabindex]="tab() === 'activity' ? 0 : -1"
                  aria-controls="sub-tabpanel"
                  (click)="tab.set('activity')"
                  (keydown.arrowRight)="moveTab()"
                  (keydown.arrowLeft)="moveTab()"
                >
                  Activity <span class="tab-count">{{ x.timeline.length }}</span>
                </button>
              </div>
              <div id="sub-tabpanel" role="tabpanel" [attr.aria-labelledby]="'sub-tab-' + tab()">
                @if (tab() === 'comments') {
                  <div class="card-body">
                    <app-comments
                      resource="submittals"
                      [resourceId]="x.id"
                      [comments]="x.comments"
                      [documentId]="x.documentId"
                      (added)="onComment($event)"
                    />
                  </div>
                } @else {
                  <app-timeline [events]="x.timeline" label="Submittal activity" />
                }
              </div>
            </section>
          </div>

          <aside class="record-aside" aria-label="Submittal properties">
            <section class="card" aria-labelledby="sprops-title">
              <div class="card-header"><h2 id="sprops-title">Details</h2></div>
              <dl class="props">
                <div>
                  <dt>Status</dt>
                  <dd><app-status [value]="x.status" /></dd>
                </div>
                <div>
                  <dt>Cycle</dt>
                  <dd>{{ x.cycle }}</dd>
                </div>
                <div>
                  <dt>Reviewer</dt>
                  <dd><app-person [name]="x.reviewer.displayName" /></dd>
                </div>
                <div>
                  <dt>Due</dt>
                  <dd class="due">
                    {{ x.dueAt ? (x.dueAt | shortDate) : '—' }}
                    @if (x.isOverdue) {
                      <app-status value="Overdue" />
                    }
                  </dd>
                </div>
                <div>
                  <dt>Revision</dt>
                  <dd>
                    <a
                      class="mono"
                      [routerLink]="['/app/documents', x.documentId]"
                      [queryParams]="{ rev: x.revisionId }"
                      >{{ x.versionLabel }}</a
                    >
                  </dd>
                </div>
                <div>
                  <dt>Submitted by</dt>
                  <dd><app-person [name]="x.submittedBy.displayName" /></dd>
                </div>
                <div>
                  <dt>Submitted</dt>
                  <dd [title]="x.submittedAt | longDate">{{ x.submittedAt | shortDate }}</dd>
                </div>
                <div>
                  <dt>Your role</dt>
                  <dd>{{ label(x.myRole) }}</dd>
                </div>
              </dl>
            </section>
          </aside>
        </div>
      }
    </div>
  `,
  styles: `
    .action-error {
      margin-bottom: 16px;
    }
    .no-actions {
      display: inline-flex;
      border-radius: var(--r-sm);
    }
    .citation {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface-subtle);
      color: var(--text);
    }
    .citation:hover {
      text-decoration: none;
      border-color: var(--border-strong);
    }
    .citation > .icon {
      color: var(--brand);
    }
    .citation > .icon:last-child {
      color: var(--text-3);
    }
    .cite-text {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .cite-doc {
      font-weight: 500;
      overflow-wrap: anywhere;
    }
    .cite-where {
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .alert {
      margin-top: 12px;
    }
    .none {
      margin: 0;
      color: var(--text-2);
    }
    .decisions {
      list-style: none;
      margin: 0;
      padding: 4px 16px;
    }
    .decisions li {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      gap: 10px;
      padding: 12px 0;
    }
    .decisions li + li {
      border-top: 1px solid var(--border);
    }
    .dec-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .dec-meta time {
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .dec-text {
      margin: 6px 0 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .due {
      display: flex;
      align-items: center;
      gap: 8px;
    }
  `,
})
export class SubmittalDetailPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(MatDialog);
  protected readonly session = inject(SessionService);
  readonly id = input.required<string>();
  protected readonly label = label;
  protected readonly s = signal<SubmittalDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected readonly tab = signal<'comments' | 'activity'>('comments');
  protected readonly waitingOn = computed(() => {
    const x = this.s();
    return x ? `${WAITING_ON[x.status]} Switch persona from the profile menu to act.` : '';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.session.version();
      untracked(() => this.load(id));
    });
  }

  can(action: SubmittalAction): boolean {
    return this.s()?.availableActions.includes(action) ?? false;
  }

  protected load(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.error.set('');
    this.api.submittal(id).subscribe({
      next: (s) => {
        this.s.set(s);
        this.loading.set(false);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        if (e instanceof HttpErrorResponse && e.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(problemMessage(e, 'The submittal could not be loaded.'));
        }
      },
    });
  }

  protected openDecision(): void {
    const x = this.s();
    if (!x) {
      return;
    }
    openDialog<DecisionDialogComponent, DecisionDialogData, DecisionSubmit>(
      this.dialog,
      DecisionDialogComponent,
      { number: x.number, cycle: x.cycle, versionLabel: x.versionLabel },
    )
      .afterClosed()
      .subscribe((d) => {
        if (d) {
          this.run('decisions', { decision: d.decision, comments: d.comments });
        }
      });
  }

  protected openResubmit(): void {
    const x = this.s();
    if (!x) {
      return;
    }
    openDialog<ResubmitDialogComponent, ResubmitDialogData, string>(
      this.dialog,
      ResubmitDialogComponent,
      { number: x.number, cycle: x.cycle, revisions: x.newerRevisions },
    )
      .afterClosed()
      .subscribe((revisionId) => {
        if (revisionId) {
          this.run('resubmit', { revisionId });
        }
      });
  }

  protected run(action: string, extra: object): void {
    const s = this.s();
    if (!s || this.busy()) {
      return;
    }
    this.busy.set(true);
    this.actionError.set('');
    this.api.submittalAction(s.id, action, { rowVersion: s.rowVersion, ...extra }).subscribe({
      next: (updated) => {
        this.s.set(updated);
        this.busy.set(false);
        this.toast.success(`${updated.number} is now ${label(updated.status).toLowerCase()}.`);
      },
      error: (e: unknown) => {
        this.busy.set(false);
        this.actionError.set(problemMessage(e, 'The action failed.'));
        if (e instanceof HttpErrorResponse && e.status === 409) {
          this.load(s.id);
        }
      },
    });
  }

  protected onComment(c: Comment): void {
    this.s.update((x) => (x ? { ...x, comments: [...x.comments, c] } : x));
  }

  protected moveTab(): void {
    const next = this.tab() === 'comments' ? 'activity' : 'comments';
    this.tab.set(next);
    document.getElementById('sub-tab-' + next)?.focus();
  }
}
