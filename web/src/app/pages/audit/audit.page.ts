import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuditEvent, AuditQuery, Member, Paged } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { auditLabel, label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { WalkthroughService } from '../../core/walkthrough.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { describeEvent } from '../../shared/activity';
import {
  EmptyStateComponent,
  FilterChipComponent,
  FilterOption,
  IconComponent,
  LongDateTimePipe,
  PagerComponent,
  PersonComponent,
  SkeletonRowsComponent,
} from '../../shared/ui';

@Component({
  selector: 'app-audit',
  imports: [
    FormsModule,
    RouterLink,
    TopbarComponent,
    IconComponent,
    FilterChipComponent,
    PagerComponent,
    PersonComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    LongDateTimePipe,
  ],
  template: `
    <app-topbar title="Audit trail" />
    <div class="page">
      <section class="card" aria-labelledby="audit-results" [attr.aria-busy]="loading()">
        <h2 id="audit-results" class="visually-hidden">Audit events</h2>
        <div class="toolbar" role="toolbar" aria-label="Filters">
          <div class="search-box">
            <app-icon name="search" [size]="16" />
            <input
              class="input input-sm"
              type="search"
              placeholder="Action, e.g. rfi."
              aria-label="Action starts with"
              [ngModel]="query().action ?? ''"
              (ngModelChange)="onAction($event)"
            />
          </div>
          <app-filter-chip
            label="Resource"
            [options]="resourceOptions"
            [value]="query().resource"
            (valueChange)="set('resource', $any($event))"
          />
          <app-filter-chip
            label="Actor"
            [options]="actorOptions()"
            [value]="query().actorId"
            allLabel="Anyone"
            (valueChange)="set('actorId', $event)"
          />
          @if (activeFilters() > 0) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="clear()">
              Clear <span class="filter-badge">{{ activeFilters() }}</span>
            </button>
          }
          <span class="count">
            <app-icon name="lock" [size]="14" /> Append-only
            @if (result(); as r) {
              · {{ r.totalCount }} events
            }
          </span>
        </div>
        @if (error()) {
          <app-empty icon="triangle-alert" heading="The audit trail could not be loaded" [text]="error()">
            <button type="button" class="btn btn-secondary" (click)="retry()">Try again</button>
          </app-empty>
        } @else if (loading() && !result()) {
          <app-skeleton-rows label="Loading audit events" [widths]="[14, 10, 12, 30, 12]" />
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <app-empty icon="scroll-text" heading="No events match" text="Try removing a filter." />
          } @else {
            <div class="table-wrap">
              <table class="table">
                <caption class="visually-hidden">
                  Audit events,
                  {{
                    r.totalCount
                  }}
                  total
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Item</th>
                    <th scope="col">Details</th>
                    <th scope="col" class="num-cell">When (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of r.items; track e.id) {
                    <tr>
                      <td class="actor">
                        <app-person [name]="e.actor?.displayName ?? 'System'" />
                      </td>
                      <td class="nowrap">
                        <span class="chip">{{ verb(e.action) }}</span>
                      </td>
                      <td class="nowrap">
                        @if (link(e); as l) {
                          <a class="cell-link doc-num" [routerLink]="l">{{
                            e.reference ?? label(e.resource)
                          }}</a>
                        } @else {
                          <span class="doc-num">{{ e.reference ?? label(e.resource) }}</span>
                        }
                      </td>
                      <td class="details">{{ details(e) }}</td>
                      <td class="num-cell text-2" [title]="e.timestamp | longDate">
                        {{ utc(e.timestamp) }}
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
                ariaLabel="Audit pages"
                (pageChange)="set('page', $event)"
              />
            }
          }
        }
      </section>
    </div>
  `,
  styles: `
    .count {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .actor {
      min-width: 170px;
    }
    .details {
      min-width: 240px;
      max-width: 480px;
      color: var(--text-2);
      overflow-wrap: anywhere;
    }
  `,
})
export class AuditPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly tour = inject(WalkthroughService);
  protected readonly label = label;
  protected readonly verb = auditLabel;
  protected readonly resourceOptions: FilterOption[] = [
    'Project',
    'Document',
    'DocumentRevision',
    'Rfi',
    'Submittal',
    'ExtractionSuggestion',
  ].map((r) => ({ value: r, label: label(r) }));
  protected readonly query = signal<AuditQuery>({ page: 1, pageSize: 50 });
  protected readonly result = signal<Paged<AuditEvent> | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly actorOptions = computed<FilterOption[]>(() =>
    this.members().map((m) => ({ value: m.userId, label: m.displayName })),
  );
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly activeFilters = computed(() => {
    const q = this.query();
    return [q.resource, q.actorId, q.action].filter((v) => !!v).length;
  });
  private sub?: Subscription;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.tour.mark('audit');
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

  private load(projectId: string | null, q: AuditQuery): void {
    this.sub?.unsubscribe();
    if (!projectId) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sub = this.api.audit(projectId, q).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'The audit trail could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected set<K extends keyof AuditQuery>(key: K, value: AuditQuery[K]): void {
    this.query.update((q) => ({ ...q, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  protected onAction(value: string): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.set('action', value.trim()), 300);
  }

  protected clear(): void {
    this.query.set({ page: 1, pageSize: this.query().pageSize });
  }

  protected retry(): void {
    this.query.update((q) => ({ ...q }));
  }

  /** The part of the sentence after the verb: who/what, then context, then any quoted reason. */
  protected details(e: AuditEvent): string {
    const t = describeEvent(e);
    const parts = [t.object, t.meta, t.quote ? `“${t.quote}”` : undefined].filter(
      (p): p is string => !!p && p !== e.reference,
    );
    return parts.join(' · ') || '—';
  }

  protected utc(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  protected link(e: AuditEvent): string[] | null {
    switch (e.resource) {
      case 'Rfi':
        return ['/app/rfis', e.resourceId];
      case 'Submittal':
        return ['/app/submittals', e.resourceId];
      case 'Document':
        return ['/app/documents', e.resourceId];
      default:
        return null;
    }
  }
}
