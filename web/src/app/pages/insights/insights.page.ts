import { DatePipe } from '@angular/common';
import { Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { BarDatum, InsightsService, InsightsView } from './insights.service';

/** Colour-blind-safe palette (steel, blueprint, amber, teal) with text labels on every mark. */
const STATUS_COLORS: Record<string, string> = {
  Draft: '#8796a7',
  InReview: '#1f5fbf',
  Issued: '#17703a',
  Archived: '#4a5d75',
};

@Component({
  selector: 'app-insights',
  imports: [DatePipe, MatButtonModule],
  templateUrl: './insights.page.html',
  styleUrl: './insights.page.scss',
})
export class InsightsPage {
  private readonly insights = inject(InsightsService);
  protected readonly session = inject(SessionService);
  protected readonly view = signal<InsightsView | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
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

  protected color(status: string): string {
    return STATUS_COLORS[status] ?? '#2c3e55';
  }

  protected barHeight(value: number, max: number): number {
    return (value / max) * 150;
  }

  protected linePoints(v: InsightsView): string {
    const step = 600 / Math.max(1, v.weeks.length);
    return v.weeks
      .map((w, i) => `${40 + i * step + step / 2},${180 - this.barHeight(w.openAtEnd, v.weekMax)}`)
      .join(' ');
  }

  protected step(v: InsightsView): number {
    return 600 / Math.max(1, v.weeks.length);
  }

  protected trackBar(b: BarDatum): string {
    return b.label;
  }
}
