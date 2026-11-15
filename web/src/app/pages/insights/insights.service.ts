import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CountItem, Insights } from '../../core/api.models';
import { label } from '../../core/labels';

export interface BarDatum {
  label: string;
  value: number;
  /** 0–100, relative to the largest value in the series. */
  percent: number;
}

export interface WeekDatum {
  label: string;
  opened: number;
  closed: number;
  openAtEnd: number;
}

export interface StackedDatum {
  label: string;
  total: number;
  segments: { key: string; value: number; percent: number }[];
}

export interface InsightsView {
  raw: Insights;
  kpis: { label: string; value: string; note: string }[];
  weeks: WeekDatum[];
  weekMax: number;
  overdueByDiscipline: BarDatum[];
  documents: StackedDatum[];
  documentStatuses: string[];
  rfisByState: BarDatum[];
  submittalsByStatus: BarDatum[];
}

export function toBars(items: CountItem[]): BarDatum[] {
  const max = Math.max(1, ...items.map((i) => i.count));
  return items.map((i) => ({
    label: label(i.key),
    value: i.count,
    percent: Math.round((i.count / max) * 100),
  }));
}

export function formatDays(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(1)} d`;
}

/** Fetches live project metrics and shapes them for accessible SVG charts and their data tables. */
@Injectable({ providedIn: 'root' })
export class InsightsService {
  private readonly api = inject(ApiService);

  load(projectId: string): Observable<InsightsView> {
    return this.api.insights(projectId).pipe(map((raw) => InsightsService.toView(raw)));
  }

  static toView(raw: Insights): InsightsView {
    const weeks = raw.rfiOpenVsClosed.map((p) => ({
      label: new Date(p.weekStart).toLocaleDateString('en-CA', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      opened: p.opened,
      closed: p.closed,
      openAtEnd: p.openAtEnd,
    }));
    const weekMax = Math.max(1, ...weeks.flatMap((w) => [w.opened, w.closed, w.openAtEnd]));
    const documentStatuses = Array.from(
      new Set(raw.documentsByDiscipline.flatMap((d) => d.byStatus.map((s) => s.key))),
    ).sort();
    const docMax = Math.max(1, ...raw.documentsByDiscipline.map((d) => d.total));
    return {
      raw,
      kpis: [
        {
          label: 'RFI turnaround (median)',
          value: formatDays(raw.rfiTurnaroundMedianDays),
          note: `${raw.closedRfiSample} closed RFIs`,
        },
        {
          label: 'Submittal review (median)',
          value: formatDays(raw.submittalReviewMedianDays),
          note: 'submission to decision',
        },
        {
          label: 'Open RFIs',
          value: String(raw.openRfis),
          note: 'submitted, assigned, answered or reopened',
        },
        {
          label: 'Open submittals',
          value: String(raw.openSubmittals),
          note: 'submitted or in review',
        },
        {
          label: 'Overdue items',
          value: String(raw.overdueItems),
          note: 'from the review-queue view',
        },
      ],
      weeks,
      weekMax,
      overdueByDiscipline: toBars(raw.overdueByDiscipline),
      documents: raw.documentsByDiscipline.map((d) => ({
        label: label(d.discipline),
        total: d.total,
        segments: documentStatuses.map((key) => {
          const value = d.byStatus.find((s) => s.key === key)?.count ?? 0;
          return { key, value, percent: (value / docMax) * 100 };
        }),
      })),
      documentStatuses,
      rfisByState: toBars(raw.rfisByState),
      submittalsByStatus: toBars(raw.submittalsByStatus),
    };
  }
}
