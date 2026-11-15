import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Insights } from '../../core/api.models';
import { InsightsService, formatDays, toBars } from './insights.service';

const sample: Insights = {
  generatedAt: '2026-11-15T09:00:00Z',
  rfiTurnaroundMedianDays: 6.5,
  closedRfiSample: 2,
  submittalReviewMedianDays: null,
  openRfis: 6,
  openSubmittals: 3,
  overdueItems: 2,
  rfiOpenVsClosed: [
    { weekStart: '2026-11-02T00:00:00Z', opened: 2, closed: 1, openAtEnd: 5 },
    { weekStart: '2026-11-09T00:00:00Z', opened: 3, closed: 0, openAtEnd: 8 },
  ],
  overdueByDiscipline: [
    { key: 'Mechanical', count: 2 },
    { key: 'Structural', count: 1 },
  ],
  documentsByDiscipline: [
    {
      discipline: 'Mechanical',
      total: 3,
      byStatus: [
        { key: 'Issued', count: 2 },
        { key: 'InReview', count: 1 },
      ],
    },
    { discipline: 'Civil', total: 1, byStatus: [{ key: 'Issued', count: 1 }] },
  ],
  rfisByState: [{ key: 'Assigned', count: 3 }],
  submittalsByStatus: [{ key: 'ReviseAndResubmit', count: 1 }],
};

describe('InsightsService', () => {
  it('fetches live insights for the project and shapes chart data', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const service = TestBed.inject(InsightsService);
    const http = TestBed.inject(HttpTestingController);
    let result: ReturnType<typeof InsightsService.toView> | undefined;
    service.load('p1').subscribe((v) => (result = v));
    http.expectOne('/api/projects/p1/insights').flush(sample);
    http.verify();

    expect(result!.kpis[0]).toEqual({
      label: 'RFI turnaround (median)',
      value: '6.5 d',
      note: '2 closed RFIs',
    });
    expect(result!.kpis[1].value).toBe('n/a');
    expect(result!.weekMax).toBe(8);
    expect(result!.weeks.map((w) => w.label)).toEqual(['Nov 2', 'Nov 9']);
    expect(result!.documentStatuses).toEqual(['InReview', 'Issued']);
    expect(result!.documents[0].label).toBe('Mechanical / HVAC');
    expect(result!.documents[0].segments.map((s) => s.value)).toEqual([1, 2]);
    expect(result!.submittalsByStatus[0].label).toBe('Revise & resubmit');
  });

  it('scales bars relative to the largest value', () => {
    expect(toBars(sample.overdueByDiscipline).map((b) => b.percent)).toEqual([100, 50]);
    expect(toBars([])).toEqual([]);
  });

  it('formats missing medians honestly', () => {
    expect(formatDays(null)).toBe('n/a');
    expect(formatDays(3)).toBe('3.0 d');
  });
});
