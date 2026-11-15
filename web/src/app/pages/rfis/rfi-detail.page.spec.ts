import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RfiAction, RfiDetail, RfiState } from '../../core/api.models';
import { RfiDetailPage } from './rfi-detail.page';

function rfi(state: RfiState, actions: RfiAction[]): RfiDetail {
  return {
    id: 'r1',
    projectId: 'p1',
    projectCode: 'MCC',
    referenceNumber: 'RFI-010',
    subject: 'Clarify RTU-2 trunk test pressure',
    question: 'Which pressure applies?',
    state,
    discipline: 'Mechanical',
    assignee: { id: 'u-rev', displayName: 'Marcus Lindqvist' },
    dueAt: '2030-01-01T00:00:00Z',
    isOverdue: false,
    createdBy: { id: 'u-req', displayName: 'Theo Brandt' },
    createdAt: '2026-11-01T00:00:00Z',
    submittedAt: null,
    answeredAt: null,
    closedAt: null,
    reopenReason: null,
    approvedResponseId: null,
    citation: {
      documentId: 'd1',
      documentNumber: 'MCC-M-23 05 00',
      documentTitle: 'Common Work Results for HVAC',
      revisionId: 'rev1',
      versionLabel: 'R0',
      page: 3,
      pageCount: 3,
      newerRevisionExists: true,
      currentVersionLabel: 'R1',
    },
    responses: [],
    timeline: [],
    comments: [],
    availableActions: actions,
    myRole: 'ProjectManager',
    rowVersion: 'AAAAAAAAB9E=',
  };
}

describe('RfiDetailPage action visibility', () => {
  let http: HttpTestingController;

  async function render(detail: RfiDetail): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [RfiDetailPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(RfiDetailPage);
    fixture.componentRef.setInput('id', 'r1');
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne('/api/rfis/r1').flush(detail);
    http.expectOne('/api/projects/p1/members').flush([
      {
        userId: 'u-rev',
        displayName: 'Marcus Lindqvist',
        jobTitle: 'Mechanical Reviewer',
        role: 'Reviewer',
      },
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  const buttons = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '');

  afterEach(() => http.verify());

  it('shows only approve and return actions for a project manager on an answered RFI', async () => {
    const el = await render(rfi('Answered', ['ApproveAnswer', 'RejectAnswer']));
    const labels = buttons(el);
    expect(labels).toContain('Approve answer');
    expect(labels).toContain('Return to reviewer');
    expect(labels).not.toContain('Close RFI');
    expect(labels).not.toContain('Post answer');
    expect(labels).not.toContain('Assign');
  });

  it('shows the answer form only to the assignee', async () => {
    const el = await render(rfi('Assigned', ['Answer']));
    expect(buttons(el)).toContain('Post answer');
    expect(buttons(el)).not.toContain('Approve answer');
  });

  it('shows no actions and an explanation when the server allows none', async () => {
    const el = await render(rfi('Closed', []));
    expect(el.querySelector('[data-testid="no-actions"]')).not.toBeNull();
    expect(buttons(el).some((b) => /Approve|Close|Assign|Reopen/.test(b))).toBe(false);
  });

  it('flags that a newer revision exists while keeping the pinned citation', async () => {
    const el = await render(rfi('Closed', ['Reopen']));
    expect(el.textContent).toContain('A newer revision (R1) exists');
    expect(el.textContent).toContain('R0, page 3');
    expect(buttons(el)).toContain('Reopen RFI');
  });
});
