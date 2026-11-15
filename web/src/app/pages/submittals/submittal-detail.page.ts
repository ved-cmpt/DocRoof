import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Comment, SubmittalAction, SubmittalDetail } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { CommentsComponent, TimelineComponent } from '../../shared/activity.components';
import { DecisionFormComponent, DecisionSubmit } from './decision-form.component';

@Component({
  selector: 'app-submittal-detail',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatSelectModule,
    CommentsComponent,
    TimelineComponent,
    DecisionFormComponent,
  ],
  template: `
    <div class="page">
      <nav class="crumbs small" aria-label="Breadcrumb">
        <a routerLink="/app/submittals">Submittals</a> <span aria-hidden="true">/</span>
        <span aria-current="page">{{ s()?.number ?? 'Submittal' }}</span>
      </nav>
      @if (loading() && !s()) {
        <div class="panel panel-pad stack" role="status" aria-label="Loading submittal">
          <span class="skeleton"></span>
        </div>
      } @else if (notFound()) {
        <section class="panel state-box">
          <h1>Submittal not found</h1>
          <p>It does not exist or belongs to a project you are not a member of.</p>
        </section>
      } @else if (error()) {
        <div class="error-box" role="alert">{{ error() }}</div>
      } @else if (s(); as x) {
        <div class="page-header">
          <div>
            <p class="eyebrow">
              {{ x.projectCode }} · Spec {{ x.specSection || '—' }} · {{ label(x.discipline) }}
            </p>
            <h1>
              <span class="mono ref">{{ x.number }}</span> {{ x.title }}
            </h1>
          </div>
          <div class="row">
            <span [class]="'chip ' + tone(x.status)">{{ label(x.status) }}</span>
            <span class="chip plain">Cycle {{ x.cycle }}</span>
            @if (x.isOverdue) {
              <span class="overdue-badge">Overdue</span>
            }
          </div>
        </div>

        <div class="layout">
          <div class="stack">
            <dl class="title-block">
              <div>
                <dt>Submitted revision</dt>
                <dd>
                  <a
                    [routerLink]="['/app/documents', x.documentId]"
                    [queryParams]="{ rev: x.revisionId }"
                  >
                    <span class="mono">{{ x.documentNumber }} {{ x.versionLabel }}</span>
                  </a>
                </dd>
              </div>
              <div>
                <dt>Revision status</dt>
                <dd>
                  <span [class]="'chip ' + tone(x.revisionApprovalStatus)">{{
                    label(x.revisionApprovalStatus)
                  }}</span>
                </dd>
              </div>
              <div>
                <dt>Reviewer</dt>
                <dd>{{ x.reviewer.displayName }}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>{{ x.dueAt ? (x.dueAt | date: 'mediumDate') : '—' }}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{{ x.submittedAt | date: 'mediumDate' }} by {{ x.submittedBy.displayName }}</dd>
              </div>
              <div>
                <dt>Your role</dt>
                <dd>{{ label(x.myRole) }}</dd>
              </div>
            </dl>

            <section class="panel panel-pad" aria-labelledby="dec-title">
              <h2 id="dec-title">Review decisions</h2>
              @if (x.decisions.length === 0) {
                <p class="muted">No decision recorded yet.</p>
              }
              @for (d of x.decisions; track d.id) {
                <article class="decision">
                  <div class="row small">
                    <strong>Cycle {{ d.cycle }}</strong>
                    <span class="mono">{{ d.versionLabel }}</span>
                    <span [class]="'chip ' + tone(d.decision)">{{ label(d.decision) }}</span>
                    <span class="muted"
                      >{{ d.reviewer.displayName }} · {{ d.createdAt | date: 'medium' }}</span
                    >
                  </div>
                  @if (d.comments) {
                    <p>{{ d.comments }}</p>
                  }
                </article>
              }
            </section>

            <section class="panel panel-pad" aria-labelledby="sc-title">
              <h2 id="sc-title">Comments</h2>
              <app-comments
                resource="submittals"
                [resourceId]="x.id"
                [comments]="x.comments"
                [documentId]="x.documentId"
                (added)="onComment($event)"
              />
            </section>
          </div>

          <div class="stack">
            <section class="panel panel-pad actions" aria-labelledby="sa-title">
              <h2 id="sa-title">Actions</h2>
              @if (x.availableActions.length === 0) {
                <p class="muted small">No actions are available to you in this state.</p>
              }
              @if (can('StartReview')) {
                <button mat-flat-button (click)="run('start-review', {})" [disabled]="busy()">
                  Start review
                </button>
              }
              @if (can('Decide')) {
                <app-decision-form [cycle]="x.cycle" [busy]="busy()" (decided)="decide($event)" />
              }
              @if (can('Finalize')) {
                <button
                  mat-flat-button
                  class="btn-amber"
                  (click)="run('finalize', {})"
                  [disabled]="busy()"
                >
                  Finalize submittal
                </button>
              }
              @if (can('Resubmit')) {
                <div class="action-form">
                  <h3>Resubmit with a newer revision</h3>
                  <mat-form-field appearance="outline" subscriptSizing="dynamic">
                    <mat-label>New revision</mat-label>
                    <mat-select [(ngModel)]="resubmitRevision" name="rev">
                      @for (r of x.newerRevisions; track r.id) {
                        <mat-option [value]="r.id">{{ r.versionLabel }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>
                  <button
                    mat-flat-button
                    (click)="resubmit()"
                    [disabled]="busy() || !resubmitRevision"
                  >
                    Resubmit (cycle {{ x.cycle + 1 }})
                  </button>
                </div>
              } @else if (x.status === 'ReviseAndResubmit') {
                <p class="notice small">
                  Revise &amp; resubmit needs a new revision. Upload it on
                  <a [routerLink]="['/app/documents', x.documentId]">{{ x.documentNumber }}</a>
                  first.
                </p>
              }
              @if (actionError()) {
                <div class="error-box small" role="alert">{{ actionError() }}</div>
              }
            </section>
            <section class="panel" aria-labelledby="st-title">
              <div class="panel-header"><h2 id="st-title">Timeline</h2></div>
              <app-timeline [events]="x.timeline" label="Submittal timeline" />
            </section>
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .crumbs {
      margin-bottom: 10px;
      color: var(--muted);
    }
    .crumbs a {
      color: var(--muted);
    }
    .ref {
      display: inline-block;
      font-size: 0.8em;
      padding: 2px 8px;
      margin-right: 6px;
      border-radius: 4px;
      background: var(--steel);
      color: #fff;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }
    .decision {
      border-left: 3px solid var(--line-strong);
      padding: 6px 12px;
      margin-bottom: 10px;
    }
    .decision p {
      margin: 6px 0 0;
      white-space: pre-wrap;
    }
    .actions {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .action-form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border: 1px dashed var(--line-strong);
      border-radius: var(--radius);
    }
    .action-form h3 {
      margin: 0;
    }
    @media (max-width: 1000px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `,
})
export class SubmittalDetailPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);
  readonly id = input.required<string>();
  protected readonly label = label;
  protected readonly tone = tone;
  protected readonly s = signal<SubmittalDetail | null>(null);
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal(false);
  protected resubmitRevision = '';

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
    this.api.submittal(id).subscribe({
      next: (s) => {
        this.s.set(s);
        this.resubmitRevision = s.newerRevisions.at(-1)?.id ?? '';
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

  protected decide(d: DecisionSubmit): void {
    this.run('decisions', { decision: d.decision, comments: d.comments });
  }

  protected resubmit(): void {
    this.run('resubmit', { revisionId: this.resubmitRevision });
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
        this.toast.success(`${updated.number} is now ${label(updated.status)}.`);
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
}
