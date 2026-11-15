import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
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
import { label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { WalkthroughService } from '../../core/walkthrough.service';
import { RfiCreateDialogComponent } from './rfi-create-dialog.component';

@Component({
  selector: 'app-rfi-list',
  imports: [
    FormsModule,
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatInputModule,
    MatSelectModule,
    MatPaginatorModule,
  ],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">{{ session.project()?.code }} · Requests for information</p>
          <h1>RFIs</h1>
          <p>Every RFI cites the exact revision and page it is about.</p>
        </div>
        @if (canCreate()) {
          <button mat-flat-button (click)="create()">New RFI</button>
        }
      </div>

      <section class="panel filters" aria-label="Filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
          <mat-label>Search reference or subject</mat-label>
          <input
            matInput
            type="search"
            [ngModel]="query().search ?? ''"
            (ngModelChange)="onSearch($event)"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>State</mat-label>
          <mat-select [value]="query().state ?? ''" (selectionChange)="set('state', $event.value)">
            <mat-option value="">All states</mat-option>
            @for (s of states; track s) {
              <mat-option [value]="s">{{ label(s) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Assignee</mat-label>
          <mat-select
            [value]="query().assignee ?? ''"
            (selectionChange)="set('assignee', $event.value)"
          >
            <mat-option value="">Anyone</mat-option>
            <mat-option value="me">Assigned to me</mat-option>
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

      <section class="panel" aria-labelledby="rfi-results" [attr.aria-busy]="loading()">
        <h2 id="rfi-results" class="visually-hidden">RFI list</h2>
        @if (error()) {
          <div class="panel-pad">
            <div class="error-box" role="alert">{{ error() }}</div>
          </div>
        } @else if (loading() && !result()) {
          <div class="panel-pad stack" role="status" aria-label="Loading RFIs">
            <span class="skeleton"></span><span class="skeleton"></span
            ><span class="skeleton"></span>
          </div>
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <div class="state-box">
              <h3>No RFIs match</h3>
              <p>Adjust the filters or raise a new RFI.</p>
            </div>
          } @else {
            <div class="table-scroll">
              <table class="data-table">
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
                    <th scope="col">Due</th>
                  </tr>
                </thead>
                <tbody>
                  @for (x of r.items; track x.id) {
                    <tr>
                      <td class="mono">
                        <a [routerLink]="['/app/rfis', x.id]">{{ x.referenceNumber }}</a>
                      </td>
                      <td>
                        {{ x.subject
                        }}<span class="small muted block">{{ label(x.discipline) }}</span>
                      </td>
                      <td>
                        <span [class]="'chip ' + tone(x.state)">{{ label(x.state) }}</span>
                      </td>
                      <td class="small">
                        <span class="mono"
                          >{{ x.citation.documentNumber }} {{ x.citation.versionLabel }} p.{{
                            x.citation.page
                          }}</span
                        >
                        @if (x.citation.newerRevisionExists) {
                          <span class="chip warn plain">Newer rev</span>
                        }
                      </td>
                      <td>{{ x.assignee?.displayName ?? '—' }}</td>
                      <td class="small">
                        @if (x.dueAt) {
                          {{ x.dueAt | date: 'mediumDate' }}
                        } @else {
                          —
                        }
                        @if (x.isOverdue) {
                          <span class="overdue-badge">Overdue {{ x.daysOverdue }}d</span>
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
              aria-label="RFI pages"
            />
          }
        }
      </section>
    </div>
  `,
  styles: `
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
    .filters .search {
      width: 260px;
    }
    .block {
      display: block;
    }
    @media (max-width: 700px) {
      .filters mat-form-field,
      .filters .search {
        width: 100%;
      }
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
  protected readonly tone = tone;
  protected readonly states = RFI_STATES;
  protected readonly disciplines = DISCIPLINES;

  protected readonly query = signal<RfiQuery>({ page: 1, pageSize: 20 });
  protected readonly result = signal<Paged<RfiListItem> | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly reviewers = computed(() =>
    this.members().filter((m) => m.role === 'Reviewer'),
  );
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

  protected onSearch(value: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.set('search', value.trim()), 300);
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
      .open(RfiCreateDialogComponent, {
        data: { projectId: project.id },
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .subscribe((rfi?: RfiDetail) => {
        if (rfi) {
          this.tour.mark('create-rfi', rfi.id);
          void this.router.navigate(['/app/rfis', rfi.id]);
        }
      });
  }
}
