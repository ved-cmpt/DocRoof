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
import { ApiService } from '../../core/api.service';
import { ExtractionResult, Revision, Suggestion } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { IconComponent, StatusChipComponent } from '../../shared/ui';

/**
 * Suggestions proposed from the revision's page text. Each cites its page and the rule that produced it; nothing
 * changes until a document controller or project manager accepts it.
 */
@Component({
  selector: 'app-extraction-panel',
  imports: [IconComponent, StatusChipComponent],
  template: `
    <section class="card" aria-labelledby="extract-title">
      <div class="card-header">
        <h2 id="extract-title">Metadata suggestions</h2>
        <span class="engine" data-testid="engine-label">{{
          result()?.engineLabel ?? 'Rules-based extraction'
        }}</span>
      </div>
      <div class="card-body">
        @if (error()) {
          <div class="alert tone-danger" role="alert">
            <app-icon name="triangle-alert" [size]="16" />
            <p>{{ error() }}</p>
          </div>
        }
        @if (result(); as r) {
          @if (r.status === 'NoTextLayer' || r.status === 'Unsupported') {
            <div class="alert" role="note">
              <app-icon name="scan-text" [size]="16" />
              <p data-testid="extraction-limitation">{{ r.message }}</p>
            </div>
          } @else {
            <p class="intro">{{ r.message }}</p>
            @if (r.canRun) {
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                (click)="run()"
                [disabled]="busy()"
              >
                <app-icon name="scan-text" [size]="16" />
                {{ busy() ? 'Extracting…' : 'Suggest metadata from ' + revision().versionLabel }}
              </button>
            } @else if (r.status === 'NotRun') {
              <p class="intro">A document controller or project manager can run extraction.</p>
            }
            @if (r.suggestions.length > 0) {
              <ul class="suggestions">
                @for (s of r.suggestions; track s.id) {
                  <li [class.muted]="s.status === 'Rejected'">
                    <div class="head">
                      <span class="field">{{ fieldLabel(s.field) }}</span>
                      <span class="conf" [attr.title]="'Rule: ' + s.rule"
                        >{{ s.confidence }} confidence</span
                      >
                    </div>
                    <strong class="value">{{ display(s) }}</strong>
                    <blockquote class="snippet">{{ s.snippet }}</blockquote>
                    <div class="meta">
                      <button class="link-btn" type="button" (click)="viewPage.emit(s.page)">
                        View on page {{ s.page }}
                      </button>
                      @if (s.currentValue !== null && s.status === 'Pending') {
                        <span>· now {{ s.currentValue || '—' }}</span>
                      }
                    </div>
                    @if (s.status === 'Pending') {
                      @if (canDecide()) {
                        <div class="actions">
                          <button
                            type="button"
                            class="btn btn-secondary btn-sm"
                            (click)="decide(s, 'accept')"
                            [disabled]="busy()"
                            [attr.aria-label]="
                              'Accept ' + fieldLabel(s.field) + ' ' + s.proposedValue
                            "
                          >
                            <app-icon name="check" [size]="16" /> Accept
                          </button>
                          <button
                            type="button"
                            class="btn btn-ghost btn-sm"
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
                      <p class="decided">
                        <app-status [value]="s.status" />
                        <span>by {{ s.decidedBy?.displayName }}</span>
                      </p>
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
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .intro {
      margin: 0 0 12px;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .suggestions {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    li {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
    }
    li.muted {
      opacity: 0.65;
    }
    .head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }
    .field,
    .conf {
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .value {
      font-weight: 600;
      overflow-wrap: anywhere;
    }
    .snippet {
      margin: 2px 0;
      padding: 6px 8px;
      border-radius: 4px;
      background: var(--surface-subtle);
      font-family: var(--font-mono);
      font-size: var(--fs-12);
      color: var(--text-2);
      overflow-wrap: anywhere;
    }
    .meta {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .meta .link-btn {
      font-size: var(--fs-12);
    }
    .actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .decided {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 4px 0 0;
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .alert {
      margin-bottom: 0;
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
