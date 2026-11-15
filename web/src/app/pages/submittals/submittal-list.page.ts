import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  DISCIPLINES,
  Member,
  Paged,
  SUBMITTAL_STATUSES,
  SubmittalDetail,
  SubmittalListItem,
  SubmittalQuery,
} from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { openDialog } from '../../shared/dialog';
import {
  EmptyStateComponent,
  FilterChipComponent,
  FilterOption,
  IconComponent,
  PagerComponent,
  PersonComponent,
  ShortDatePipe,
  SkeletonRowsComponent,
  StatusChipComponent,
} from '../../shared/ui';
import { SubmittalCreateDialogComponent } from './submittal-create-dialog.component';

@Component({
  selector: 'app-submittal-list',
  imports: [
    RouterLink,
    TopbarComponent,
    IconComponent,
    FilterChipComponent,
    PagerComponent,
    StatusChipComponent,
    PersonComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    ShortDatePipe,
  ],
  template: `
    <app-topbar title="Submittals">
      @if (canCreate()) {
        <button type="button" class="btn btn-primary" (click)="create()" aria-label="New submittal">
          <app-icon name="plus" [size]="16" /><span class="btn-text">New submittal</span>
        </button>
      }
    </app-topbar>
    <div class="page">
      <section class="card" aria-labelledby="sub-results" [attr.aria-busy]="loading()">
        <h2 id="sub-results" class="visually-hidden">All submittals</h2>
        <div class="toolbar" role="toolbar" aria-label="Filters">
          <app-filter-chip
            label="Status"
            [options]="statusOptions"
            [value]="query().status"
            (valueChange)="set('status', $any($event))"
          />
          <app-filter-chip
            label="Reviewer"
            [options]="reviewerOptions()"
            [value]="query().reviewer"
            allLabel="Anyone"
            (valueChange)="set('reviewer', $event)"
          />
          <app-filter-chip
            label="Due"
            [options]="dueOptions"
            [value]="query().due"
            allLabel="Any date"
            (valueChange)="set('due', $any($event))"
          />
          <app-filter-chip
            label="Discipline"
            [options]="disciplineOptions"
            [value]="query().discipline"
            (valueChange)="set('discipline', $any($event))"
          />
          @if (activeFilters() > 0) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="clear()">
              Clear <span class="filter-badge">{{ activeFilters() }}</span>
            </button>
          }
          <span class="count">
            @if (result(); as r) {
              {{ r.totalCount }} {{ r.totalCount === 1 ? 'submittal' : 'submittals' }}
            }
          </span>
        </div>
        @if (error()) {
          <app-empty icon="triangle-alert" heading="Submittals could not be loaded" [text]="error()">
            <button type="button" class="btn btn-secondary" (click)="retry()">Try again</button>
          </app-empty>
        } @else if (loading() && !result()) {
          <app-skeleton-rows label="Loading submittals" [widths]="[8, 32, 12, 6, 16, 14, 8]" />
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <app-empty
              icon="clipboard-check"
              heading="No submittals match"
              [text]="activeFilters() > 0 ? 'Try removing a filter.' : 'Submit a document for review to start.'"
            >
              @if (activeFilters() > 0) {
                <button type="button" class="btn btn-secondary" (click)="clear()">
                  Clear filters
                </button>
              }
            </app-empty>
          } @else {
            <div class="table-wrap">
              <table class="table">
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
                    <th scope="col" class="num-cell">Cycle</th>
                    <th scope="col">Document</th>
                    <th scope="col">Reviewer</th>
                    <th scope="col" class="num-cell">Due</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of r.items; track s.id) {
                    <tr class="clickable" (click)="open(s.id, $event)">
                      <td>
                        <a class="cell-link doc-num" [routerLink]="['/app/submittals', s.id]">{{
                          s.number
                        }}</a>
                      </td>
                      <td class="title-cell">
                        {{ s.title
                        }}<span class="sub">{{ s.specSection }} · {{ label(s.discipline) }}</span>
                      </td>
                      <td><app-status [value]="s.status" /></td>
                      <td class="num-cell">{{ s.cycle }}</td>
                      <td class="nowrap doc">{{ s.documentNumber }} · {{ s.versionLabel }}</td>
                      <td><app-person [name]="s.reviewer.displayName" /></td>
                      <td class="num-cell">
                        @if (s.isOverdue) {
                          <app-status value="Overdue" [label]="'Overdue ' + s.daysOverdue + ' d'" />
                        } @else {
                          <span class="text-2">{{ s.dueAt ? (s.dueAt | shortDate) : '—' }}</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (r.totalCount > r.pageSize) {
              <app-pager
                [page]="r.page"
                [pageSize]="r.pageSize"
                [total]="r.totalCount"
                ariaLabel="Submittal pages"
                (pageChange)="setPage($event)"
              />
            }
          }
        }
      </section>
    </div>
  `,
  styles: `
    .doc {
      font-family: var(--font-mono);
      font-size: var(--fs-12);
      color: var(--text-2);
    }
  `,
})
export class SubmittalListPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly label = label;
  protected readonly statusOptions: FilterOption[] = SUBMITTAL_STATUSES.map((v) => ({
    value: v,
    label: label(v),
  }));
  protected readonly disciplineOptions: FilterOption[] = DISCIPLINES.map((v) => ({
    value: v,
    label: label(v),
  }));
  protected readonly dueOptions: FilterOption[] = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'week', label: 'Due in 7 days' },
  ];

  protected readonly query = signal<SubmittalQuery>({ page: 1, pageSize: 20 });
  protected readonly result = signal<Paged<SubmittalListItem> | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly reviewerOptions = computed<FilterOption[]>(() => [
    { value: 'me', label: 'Me' },
    ...this.members()
      .filter((m) => m.role === 'Reviewer')
      .map((m) => ({ value: m.userId, label: m.displayName })),
  ]);
  protected readonly activeFilters = computed(() => {
    const q = this.query();
    return [q.status, q.reviewer, q.due, q.discipline].filter((v) => !!v).length;
  });
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
      if (id) {
        untracked(() => this.api.members(id).subscribe((m) => this.members.set(m)));
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

  protected setPage(page: number): void {
    this.query.update((q) => ({ ...q, page }));
  }

  protected clear(): void {
    this.query.set({ page: 1, pageSize: this.query().pageSize });
  }

  protected retry(): void {
    this.query.update((q) => ({ ...q }));
  }

  protected open(id: string, event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('a, button')) {
      void this.router.navigate(['/app/submittals', id]);
    }
  }

  protected create(): void {
    const project = this.session.project();
    if (!project) {
      return;
    }
    openDialog<SubmittalCreateDialogComponent, { projectId: string }, SubmittalDetail>(
      this.dialog,
      SubmittalCreateDialogComponent,
      { projectId: project.id },
    )
      .afterClosed()
      .subscribe((s) => {
        if (s) {
          void this.router.navigate(['/app/submittals', s.id]);
        }
      });
  }
}
