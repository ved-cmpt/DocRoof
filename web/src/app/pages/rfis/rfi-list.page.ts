import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  DISCIPLINES,
  Member,
  Paged,
  RFI_STATES,
  RfiDetail,
  RfiListItem,
  RfiQuery,
} from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { WalkthroughService } from '../../core/walkthrough.service';
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
import { RfiCreateData, RfiCreateDialogComponent } from './rfi-create-dialog.component';

@Component({
  selector: 'app-rfi-list',
  imports: [
    FormsModule,
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
    <app-topbar title="RFIs">
      @if (canCreate()) {
        <button type="button" class="btn btn-primary" (click)="create()" aria-label="New RFI">
          <app-icon name="plus" [size]="16" /><span class="btn-text">New RFI</span>
        </button>
      }
    </app-topbar>
    <div class="page">
      <section class="card" aria-labelledby="rfi-results" [attr.aria-busy]="loading()">
        <h2 id="rfi-results" class="visually-hidden">RFI list</h2>
        <div class="toolbar" role="toolbar" aria-label="Filters">
          <div class="search-box">
            <app-icon name="search" [size]="16" />
            <input
              class="input input-sm"
              type="search"
              placeholder="Search reference or subject"
              aria-label="Search reference or subject"
              [ngModel]="query().search ?? ''"
              (ngModelChange)="onSearch($event)"
            />
          </div>
          <app-filter-chip
            label="State"
            [options]="stateOptions"
            [value]="query().state"
            (valueChange)="set('state', $any($event))"
          />
          <app-filter-chip
            label="Assignee"
            [options]="assigneeOptions()"
            [value]="query().assignee"
            allLabel="Anyone"
            (valueChange)="set('assignee', $event)"
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
              {{ r.totalCount }} {{ r.totalCount === 1 ? 'RFI' : 'RFIs' }}
            }
          </span>
        </div>

        @if (error()) {
          <app-empty icon="triangle-alert" heading="RFIs could not be loaded" [text]="error()">
            <button type="button" class="btn btn-secondary" (click)="retry()">Try again</button>
          </app-empty>
        } @else if (loading() && !result()) {
          <app-skeleton-rows label="Loading RFIs" [widths]="[8, 34, 10, 18, 14, 8]" />
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <app-empty
              icon="message-square-text"
              heading="No RFIs match"
              [text]="
                activeFilters() > 0
                  ? 'Try removing a filter.'
                  : 'Raise the first RFI from a document page.'
              "
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
                  RFIs,
                  {{
                    r.totalCount
                  }}
                  total
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Ref</th>
                    <th scope="col">Subject</th>
                    <th scope="col">State</th>
                    <th scope="col">Cites</th>
                    <th scope="col">Assignee</th>
                    <th scope="col" class="num-cell">Due</th>
                  </tr>
                </thead>
                <tbody>
                  @for (x of r.items; track x.id) {
                    <tr class="clickable" (click)="open(x.id, $event)">
                      <td>
                        <a class="cell-link doc-num" [routerLink]="['/app/rfis', x.id]">{{
                          x.referenceNumber
                        }}</a>
                      </td>
                      <td class="title-cell">
                        {{ x.subject }}<span class="sub">{{ label(x.discipline) }}</span>
                      </td>
                      <td><app-status [value]="x.state" /></td>
                      <td class="nowrap">
                        <span class="cite"
                          >{{ x.citation.documentNumber }} · {{ x.citation.versionLabel }} · p.{{
                            x.citation.page
                          }}</span
                        >
                        @if (x.citation.newerRevisionExists) {
                          <app-status value="Newer rev" tone="warning" />
                        }
                      </td>
                      <td>
                        <app-person [name]="x.assignee?.displayName" fallback="Unassigned" />
                      </td>
                      <td class="num-cell">
                        @if (x.isOverdue) {
                          <app-status value="Overdue" [label]="'Overdue ' + x.daysOverdue + ' d'" />
                        } @else {
                          <span class="text-2">{{ x.dueAt ? (x.dueAt | shortDate) : '—' }}</span>
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
                ariaLabel="RFI pages"
                (pageChange)="setPage($event)"
              />
            }
          }
        }
      </section>
    </div>
  `,
  styles: `
    .cite {
      font-family: var(--font-mono);
      font-size: var(--fs-12);
      color: var(--text-2);
      margin-right: 6px;
    }
  `,
})
export class RfiListPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly tour = inject(WalkthroughService);
  protected readonly label = label;
  protected readonly stateOptions: FilterOption[] = RFI_STATES.map((v) => ({
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

  protected readonly query = signal<RfiQuery>({ page: 1, pageSize: 20 });
  protected readonly result = signal<Paged<RfiListItem> | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly assigneeOptions = computed<FilterOption[]>(() => [
    { value: 'me', label: 'Assigned to me' },
    ...this.members()
      .filter((m) => m.role === 'Reviewer')
      .map((m) => ({ value: m.userId, label: m.displayName })),
  ]);
  protected readonly activeFilters = computed(() => {
    const q = this.query();
    return [q.search, q.state, q.assignee, q.due, q.discipline].filter((v) => !!v).length;
  });
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly canCreate = computed(
    () => this.session.role() !== 'Reviewer' && !!this.session.role(),
  );
  private sub?: Subscription;
  private timer: ReturnType<typeof setTimeout> | undefined;

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

  private load(projectId: string | null, q: RfiQuery): void {
    this.sub?.unsubscribe();
    if (!projectId) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sub = this.api.rfis(projectId, q).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'RFIs could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected set<K extends keyof RfiQuery>(key: K, value: RfiQuery[K]): void {
    this.query.update((q) => ({ ...q, [key]: value, page: 1 }));
  }

  protected setPage(page: number): void {
    this.query.update((q) => ({ ...q, page }));
  }

  protected onSearch(value: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.set('search', value.trim()), 300);
  }

  protected clear(): void {
    this.query.set({ page: 1, pageSize: this.query().pageSize });
  }

  protected retry(): void {
    this.query.update((q) => ({ ...q }));
  }

  protected open(id: string, event: MouseEvent): void {
    if (!(event.target as HTMLElement).closest('a, button')) {
      void this.router.navigate(['/app/rfis', id]);
    }
  }

  protected create(): void {
    const project = this.session.project();
    if (!project) {
      return;
    }
    openDialog<RfiCreateDialogComponent, RfiCreateData, RfiDetail>(
      this.dialog,
      RfiCreateDialogComponent,
      { projectId: project.id },
    )
      .afterClosed()
      .subscribe((rfi) => {
        if (rfi) {
          this.tour.mark('create-rfi', rfi.id);
          void this.router.navigate(['/app/rfis', rfi.id]);
        }
      });
  }
}
