import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ApiService } from '../../core/api.service';
import { ExtractionResult, Revision, Suggestion } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';

/**
 * Suggestions proposed from the revision's page text. Each cites its page and the rule that produced it; nothing
 * changes until a document controller or project manager accepts it.
 */
@Component({
  selector: 'app-extraction-panel',
  imports: [MatButtonModule],
  template: `
    <section class="panel" aria-labelledby="extract-title">
      <div class="panel-header">
        <h2 id="extract-title">Metadata suggestions</h2>
        <span class="engine small" data-testid="engine-label">{{
          result()?.engineLabel ?? 'Rules-based extraction'
        }}</span>
      </div>
      <div class="panel-pad">
        @if (error()) {
          <div class="error-box small" role="alert">{{ error() }}</div>
        }
        @if (result(); as r) {
          @if (r.status === 'NoTextLayer' || r.status === 'Unsupported') {
            <p class="notice" role="note" data-testid="extraction-limitation">{{ r.message }}</p>
          } @else {
            <p class="small muted">{{ r.message }}</p>
            @if (r.canRun) {
              <button mat-flat-button (click)="run()" [disabled]="busy()">
                {{ busy() ? 'Extracting…' : 'Suggest metadata from ' + revision().versionLabel }}
              </button>
            } @else if (r.status === 'NotRun') {
              <p class="small muted">
                A document controller or project manager can run extraction.
              </p>
            }
            @if (r.suggestions.length > 0) {
              <ul class="suggestions">
                @for (s of r.suggestions; track s.id) {
                  <li [class]="s.status.toLowerCase()">
                    <div class="head">
                      <span class="field">{{ fieldLabel(s.field) }}</span>
                      <strong class="value">{{ display(s) }}</strong>
                      <span
                        [class]="'chip plain conf-' + s.confidence.toLowerCase()"
                        [attr.title]="'Rule: ' + s.rule"
                      >
                        {{ s.confidence }}
                      </span>
                    </div>
                    <blockquote class="snippet">“{{ s.snippet }}”</blockquote>
                    <div class="meta small">
                      <button class="link" type="button" (click)="viewPage.emit(s.page)">
                        View on page {{ s.page }}
                      </button>
                      <span class="muted">· {{ s.rule }}</span>
                      @if (s.currentValue !== null && s.status === 'Pending') {
                        <span class="muted">· current: {{ s.currentValue || '—' }}</span>
                      }
                    </div>
                    @if (s.status === 'Pending') {
                      @if (canDecide()) {
                        <div class="actions">
                          <button
                            mat-stroked-button
                            (click)="decide(s, 'accept')"
                            [disabled]="busy()"
                            [attr.aria-label]="
                              'Accept ' + fieldLabel(s.field) + ' ' + s.proposedValue
                            "
                          >
                            Accept
                          </button>
                          <button
                            mat-button
                            (click)="decide(s, 'reject')"
                            [disabled]="busy()"
                            [attr.aria-label]="
                              'Reject ' + fieldLabel(s.field) + ' ' + s.proposedValue
                            "
                          >
                            Reject
                          </button>
                        </div>
                      }
                    } @else {
                      <p class="small decided">{{ s.status }} by {{ s.decidedBy?.displayName }}</p>
                    }
                  </li>
                }
              </ul>
            }
          }
        } @else {
          <span class="skeleton" role="status" aria-label="Loading suggestions"></span>
        }
      </div>
    </section>
  `,
  styles: `
    .engine {
      padding: 2px 8px;
      border-radius: 4px;
      background: var(--concrete-2);
      color: var(--steel-2);
      font-weight: 600;
    }
    .suggestions {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    li {
      border: 1px solid var(--line);
      border-left: 4px solid var(--blueprint);
      border-radius: var(--radius);
      padding: 10px 12px;
    }
    li.accepted {
      border-left-color: var(--success);
      background: #f7fbf8;
    }
    li.rejected {
      border-left-color: var(--line-strong);
      opacity: 0.7;
    }
    .head {
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .field {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .value {
      overflow-wrap: anywhere;
    }
    .conf-high {
      background: var(--success-soft);
      color: var(--success);
    }
    .conf-medium {
      background: var(--info-soft);
      color: var(--info);
    }
    .conf-low {
      background: var(--warn-soft);
      color: var(--warn);
    }
    .snippet {
      margin: 6px 0;
      padding: 4px 10px;
      border-left: 2px solid var(--line-strong);
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--steel-2);
      overflow-wrap: anywhere;
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      color: var(--blueprint);
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 6px;
    }
    .decided {
      margin: 6px 0 0;
      color: var(--muted);
    }
  `,
})
export class ExtractionPanelComponent {
  private readonly api = inject(ApiService);
  readonly revision = input.required<Revision>();
  readonly canDecide = input(false);
  readonly viewPage = output<number>();
  readonly metadataChanged = output<void>();

  protected readonly result = signal<ExtractionResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly pending = computed(
    () => this.result()?.suggestions.filter((s) => s.status === 'Pending').length ?? 0,
  );

  constructor() {
    effect(() => {
      const rev = this.revision();
      untracked(() => this.load(rev.id));
    });
  }

  protected fieldLabel(field: string): string {
    return label(field);
  }

  protected display(s: Suggestion): string {
    return s.field === 'Discipline' ? label(s.proposedValue) : s.proposedValue;
  }

  private load(revisionId: string): void {
    this.result.set(null);
    this.error.set('');
    this.api.extraction(revisionId).subscribe({
      next: (r) => this.result.set(r),
      error: (e) => this.error.set(problemMessage(e, 'Suggestions could not be loaded.')),
    });
  }

  protected run(): void {
    this.busy.set(true);
    this.error.set('');
    this.api.runExtraction(this.revision().id).subscribe({
      next: (r) => {
        this.result.set(r);
        this.busy.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'Extraction failed.'));
        this.busy.set(false);
      },
    });
  }

  protected decide(s: Suggestion, decision: 'accept' | 'reject'): void {
    this.busy.set(true);
    this.error.set('');
    this.api.decideSuggestion(s.id, decision, s.rowVersion).subscribe({
      next: (updated) => {
        this.result.update((r) =>
          r
            ? { ...r, suggestions: r.suggestions.map((x) => (x.id === updated.id ? updated : x)) }
            : r,
        );
        this.busy.set(false);
        if (decision === 'accept') {
          this.metadataChanged.emit();
        }
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'The suggestion could not be updated.'));
        this.busy.set(false);
        this.load(this.revision().id);
      },
    });
  }
}
