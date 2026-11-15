import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  DISCIPLINES,
  Member,
  Paged,
  ReviewQueueItem,
  SUBMITTAL_STATUSES,
  SubmittalDetail,
  SubmittalListItem,
  SubmittalQuery,
} from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { SubmittalCreateDialogComponent } from './submittal-create-dialog.component';

@Component({
  selector: 'app-submittal-list',
  imports: [RouterLink, DatePipe, MatButtonModule, MatSelectModule, MatPaginatorModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">{{ session.project()?.code }} · Submittals and review queue</p>
          <h1>Submittals</h1>
          <p>
            One decision per review cycle; Revise &amp; Resubmit starts a new cycle with a new
            revision.
          </p>
        </div>
        @if (canCreate()) {
          <button mat-flat-button (click)="create()">New submittal</button>
        }
      </div>

      <section class="panel queue" aria-labelledby="queue-title">
        <div class="panel-header">
          <h2 id="queue-title">My review queue</h2>
          <span class="small muted"
            >From the vw_ReviewQueue SQL view · RFIs and submittals assigned to you</span
          >
        </div>
        @if (queue().length === 0) {
          <p class="panel-pad muted">Nothing is waiting on you.</p>
        } @else {
          <ul class="queue-list">
            @for (q of queue(); track q.itemId) {
              <li>
                <a
                  [routerLink]="[q.itemType === 'Rfi' ? '/app/rfis' : '/app/submittals', q.itemId]"
                  class="mono"
                  >{{ q.reference }}</a
                >
                <span class="title">{{ q.title }}</span>
                <span [class]="'chip ' + tone(q.state)">{{ label(q.state) }}</span>
                <span class="small muted">{{
                  q.dueAt ? (q.dueAt | date: 'mediumDate') : 'No due date'
                }}</span>
                @if (q.isOverdue) {
                  <span class="overdue-badge">Overdue {{ q.daysOverdue }}d</span>
                }
              </li>
            }
          </ul>
        }
      </section>

      <section class="panel filters" aria-label="Filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Status</mat-label>
          <mat-select
            [value]="query().status ?? ''"
            (selectionChange)="set('status', $event.value)"
          >
            <mat-option value="">All statuses</mat-option>
            @for (s of statuses; track s) {
              <mat-option [value]="s">{{ label(s) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Reviewer</mat-label>
          <mat-select
            [value]="query().reviewer ?? ''"
            (selectionChange)="set('reviewer', $event.value)"
          >
            <mat-option value="">Any reviewer</mat-option>
            <mat-option value="me">Me</mat-option>
            @for (m of reviewers(); track m.userId) {
              <mat-option [value]="m.userId">{{ m.displayName }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Due</mat-label>
          <mat-select [value]="query().due ?? ''" (selectionChange)="set('due', $event.value)">
            <mat-option value="">Any due date</mat-option>
            <mat-option value="overdue">Overdue</mat-option>
            <mat-option value="week">Due in 7 days</mat-option>
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Discipline</mat-label>
          <mat-select
            [value]="query().discipline ?? ''"
            (selectionChange)="set('discipline', $event.value)"
          >
            <mat-option value="">All disciplines</mat-option>
            @for (d of disciplines; track d) {
              <mat-option [value]="d">{{ label(d) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </section>

      <section class="panel" aria-labelledby="sub-results" [attr.aria-busy]="loading()">
        <h2 id="sub-results" class="visually-hidden">All submittals</h2>
        @if (error()) {
          <div class="panel-pad">
            <div class="error-box" role="alert">{{ error() }}</div>
          </div>
        } @else if (loading() && !result()) {
          <div class="panel-pad stack" role="status" aria-label="Loading submittals">
            <span class="skeleton"></span><span class="skeleton"></span>
          </div>
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <div class="state-box"><h3>No submittals match</h3></div>
          } @else {
            <div class="table-scroll">
              <table class="data-table">
                <caption class="visually-hidden">
                  Submittals,
                  {{
                    r.totalCount
                  }}
                  total
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Number</th>
                    <th scope="col">Title</th>
                    <th scope="col">Status</th>
                    <th scope="col">Cycle</th>
                    <th scope="col">Document</th>
                    <th scope="col">Reviewer</th>
                    <th scope="col">Due</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of r.items; track s.id) {
                    <tr>
                      <td class="mono">
                        <a [routerLink]="['/app/submittals', s.id]">{{ s.number }}</a>
                      </td>
                      <td>
                        {{ s.title
                        }}<span class="small muted block"
                          >{{ s.specSection }} · {{ label(s.discipline) }}</span
                        >
                      </td>
                      <td>
                        <span [class]="'chip ' + tone(s.status)">{{ label(s.status) }}</span>
                      </td>
                      <td>{{ s.cycle }}</td>
                      <td class="mono small">{{ s.documentNumber }} {{ s.versionLabel }}</td>
                      <td>{{ s.reviewer.displayName }}</td>
                      <td class="small">
                        {{ s.dueAt ? (s.dueAt | date: 'mediumDate') : '—' }}
                        @if (s.isOverdue) {
                          <span class="overdue-badge">Overdue {{ s.daysOverdue }}d</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <mat-paginator
              [length]="r.totalCount"
              [pageIndex]="r.page - 1"
              [pageSize]="r.pageSize"
              [pageSizeOptions]="[10, 20, 50]"
              (page)="onPage($event)"
              aria-label="Submittal pages"
            />
          }
        }
      </section>
    </div>
  `,
  styles: `
    .queue {
      margin-bottom: 16px;
    }
    .queue-list {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .queue-list li {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 10px 20px;
      border-bottom: 1px solid var(--line);
    }
    .queue-list .title {
      flex: 1 1 220px;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 14px;
      margin-bottom: 16px;
    }
    .filters mat-form-field {
      width: 190px;
    }
    .block {
      display: block;
    }
    @media (max-width: 700px) {
      .filters mat-form-field {
        width: 100%;
      }
    }
  `,
})
export class SubmittalListPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly label = label;
  protected readonly tone = tone;
  protected readonly statuses = SUBMITTAL_STATUSES;
  protected readonly disciplines = DISCIPLINES;

  protected readonly query = signal<SubmittalQuery>({ page: 1, pageSize: 20 });
  protected readonly result = signal<Paged<SubmittalListItem> | null>(null);
  protected readonly queue = signal<ReviewQueueItem[]>([]);
  protected readonly members = signal<Member[]>([]);
  protected readonly reviewers = computed(() =>
    this.members().filter((m) => m.role === 'Reviewer'),
  );
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly canCreate = computed(() => {
    const role = this.session.role();
    return role === 'DocumentController' || role === 'ProjectManager';
  });
  private sub?: Subscription;

  constructor() {
    effect(() => {
      const project = this.session.project();
      const q = this.query();
      this.session.version();
      untracked(() => this.load(project?.id ?? null, q));
    });
    effect(() => {
      const id = this.session.project()?.id;
      this.session.version();
      if (id) {
        untracked(() => {
          this.api.members(id).subscribe((m) => this.members.set(m));
          this.api.reviewQueue(id, 'me').subscribe((q) => this.queue.set(q));
        });
      }
    });
  }

  private load(projectId: string | null, q: SubmittalQuery): void {
    this.sub?.unsubscribe();
    if (!projectId) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sub = this.api.submittals(projectId, q).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'Submittals could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected set<K extends keyof SubmittalQuery>(key: K, value: SubmittalQuery[K]): void {
    this.query.update((q) => ({ ...q, [key]: value, page: 1 }));
  }

  protected onPage(e: PageEvent): void {
    this.query.update((q) => ({ ...q, page: e.pageIndex + 1, pageSize: e.pageSize }));
  }

  protected create(): void {
    const project = this.session.project();
    if (!project) {
      return;
    }
    this.dialog
      .open(SubmittalCreateDialogComponent, {
        data: { projectId: project.id },
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe((s?: SubmittalDetail) => {
        if (s) {
          void this.router.navigate(['/app/submittals', s.id]);
        }
      });
  }
}
