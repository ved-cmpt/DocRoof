import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuditEvent, AuditQuery, Member, Paged } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { auditLabel, label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { WalkthroughService } from '../../core/walkthrough.service';
import { auditSummary } from '../../shared/activity.components';

@Component({
  selector: 'app-audit',
  imports: [DatePipe, FormsModule, RouterLink, MatInputModule, MatSelectModule, MatPaginatorModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">{{ session.project()?.code }} · Append-only</p>
          <h1>Audit trail</h1>
          <p>
            Every change is written in the same transaction as the change itself. Rows cannot be
            edited.
          </p>
        </div>
      </div>
      <section class="panel filters" aria-label="Filters">
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Resource</mat-label>
          <mat-select
            [value]="query().resource ?? ''"
            (selectionChange)="set('resource', $event.value)"
          >
            <mat-option value="">All resources</mat-option>
            @for (r of resources; track r) {
              <mat-option [value]="r">{{ label(r) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Actor</mat-label>
          <mat-select
            [value]="query().actorId ?? ''"
            (selectionChange)="set('actorId', $event.value)"
          >
            <mat-option value="">Anyone</mat-option>
            @for (m of members(); track m.userId) {
              <mat-option [value]="m.userId">{{ m.displayName }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Action starts with</mat-label>
          <input
            matInput
            [ngModel]="query().action ?? ''"
            (change)="set('action', $any($event.target).value)"
            placeholder="rfi."
          />
        </mat-form-field>
      </section>
      <section class="panel" aria-labelledby="audit-results" [attr.aria-busy]="loading()">
        <h2 id="audit-results" class="visually-hidden">Audit events</h2>
        @if (error()) {
          <div class="panel-pad">
            <div class="error-box" role="alert">{{ error() }}</div>
          </div>
        } @else if (result(); as r) {
          @if (r.items.length === 0) {
            <div class="state-box"><h3>No events match</h3></div>
          } @else {
            <div class="table-scroll">
              <table class="data-table">
                <caption class="visually-hidden">
                  Audit events,
                  {{
                    r.totalCount
                  }}
                  total
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When (UTC)</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Action</th>
                    <th scope="col">Item</th>
                    <th scope="col">Change</th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of r.items; track e.id) {
                    <tr>
                      <td class="small nowrap">
                        {{ e.timestamp | date: 'y-MM-dd HH:mm' : 'UTC' }}
                      </td>
                      <td>{{ e.actor?.displayName ?? 'System' }}</td>
                      <td>
                        <span class="chip plain">{{ verb(e.action) }}</span>
                      </td>
                      <td class="mono small">
                        @if (link(e); as l) {
                          <a [routerLink]="l">{{ e.reference ?? e.resource }}</a>
                        } @else {
                          {{ e.reference ?? label(e.resource) }}
                        }
                      </td>
                      <td class="small change">{{ summary(e) }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <mat-paginator
              [length]="r.totalCount"
              [pageIndex]="r.page - 1"
              [pageSize]="r.pageSize"
              [pageSizeOptions]="[25, 50, 100]"
              (page)="onPage($event)"
              aria-label="Audit pages"
            />
          }
        } @else {
          <div class="panel-pad stack" role="status" aria-label="Loading audit events">
            <span class="skeleton"></span>
          </div>
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
      width: 200px;
    }
    .nowrap {
      white-space: nowrap;
    }
    .change {
      max-width: 420px;
      overflow-wrap: anywhere;
    }
    @media (max-width: 700px) {
      .filters mat-form-field {
        width: 100%;
      }
    }
  `,
})
export class AuditPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly tour = inject(WalkthroughService);
  protected readonly label = label;
  protected readonly verb = auditLabel;
  protected readonly summary = auditSummary;
  protected readonly resources = [
    'Project',
    'Document',
    'DocumentRevision',
    'Rfi',
    'Submittal',
    'ExtractionSuggestion',
  ] as const;
  protected readonly query = signal<AuditQuery>({ page: 1, pageSize: 50 });
  protected readonly result = signal<Paged<AuditEvent> | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    this.tour.mark('audit');
    effect(() => {
      const project = this.session.project();
      const q = this.query();
      this.session.version();
      untracked(() => {
        if (!project) {
          return;
        }
        this.loading.set(true);
        this.api.audit(project.id, q).subscribe({
          next: (r) => {
            this.result.set(r);
            this.loading.set(false);
          },
          error: (e) => {
            this.error.set(problemMessage(e, 'The audit trail could not be loaded.'));
            this.loading.set(false);
          },
        });
        this.api.members(project.id).subscribe((m) => this.members.set(m));
      });
    });
  }

  protected set<K extends keyof AuditQuery>(key: K, value: AuditQuery[K]): void {
    this.query.update((q) => ({ ...q, [key]: value, page: 1 }));
  }

  protected onPage(e: PageEvent): void {
    this.query.update((q) => ({ ...q, page: e.pageIndex + 1, pageSize: e.pageSize }));
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
