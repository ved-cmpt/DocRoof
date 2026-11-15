import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { EmptyStateComponent, IconComponent, LongDateTimePipe } from '../../shared/ui';
import { InsightsService, InsightsView } from './insights.service';

/** One brand colour plus neutral greys; status colour only where it means status (overdue). */
const STATUS_FILL: Record<string, string> = {
  Issued: 'var(--brand)',
  InReview: 'color-mix(in srgb, var(--brand) 45%, var(--surface))',
  Draft: 'var(--chart-grey)',
  Archived: 'var(--chart-grey-light)',
};

type ChartKey = 'weeks' | 'overdue' | 'documents' | 'rfis' | 'submittals';

@Component({
  selector: 'app-insights',
  imports: [
    DecimalPipe,
    NgTemplateOutlet,
    TopbarComponent,
    IconComponent,
    EmptyStateComponent,
    LongDateTimePipe,
  ],
  templateUrl: './insights.page.html',
  styleUrl: './insights.page.scss',
})
export class InsightsPage {
  private readonly insights = inject(InsightsService);
  protected readonly session = inject(SessionService);
  protected readonly view = signal<InsightsView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly tables = signal<Partial<Record<ChartKey, boolean>>>({});
  protected readonly label = label;

  constructor() {
    effect(() => {
      const project = this.session.project();
      this.session.version();
      untracked(() => this.load(project?.id ?? null));
    });
  }

  protected load(projectId: string | null): void {
    if (!projectId) {
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.insights.load(projectId).subscribe({
      next: (v) => {
        this.view.set(v);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'Insights could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected reload(): void {
    this.load(this.session.project()?.id ?? null);
  }

  protected toggle(key: ChartKey): void {
    this.tables.update((t) => ({ ...t, [key]: !t[key] }));
  }

  protected fill(status: string): string {
    return STATUS_FILL[status] ?? 'var(--chart-grey)';
  }

  protected pct(value: number, max: number): number {
    return max > 0 ? (value / max) * 100 : 0;
  }

  /** Polyline for "open at week end", in a 0–100 box stretched over the plot. */
  protected linePoints(v: InsightsView): string {
    const n = Math.max(1, v.weeks.length);
    return v.weeks
      .map((w, i) => `${((i + 0.5) / n) * 100},${100 - this.pct(w.openAtEnd, v.weekMax)}`)
      .join(' ');
  }

  protected dotLeft(i: number, v: InsightsView): number {
    return ((i + 0.5) / Math.max(1, v.weeks.length)) * 100;
  }
}
