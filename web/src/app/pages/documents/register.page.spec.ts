import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DocumentListItem, Me, Paged } from '../../core/api.models';
import { SessionService } from '../../core/session.service';
import { DocumentRegisterPage } from './register.page';

function me(role: 'Requester' | 'DocumentController'): Me {
  return {
    userId: 'u1',
    displayName: 'Test User',
    email: null,
    jobTitle: 'Tester',
    tenantId: 't1',
    tenantName: 'Guest workspace',
    isGuest: true,
    guestExpiresAt: null,
    persona: 'requester',
    projects: [{ id: 'p1', code: 'MCC', title: 'Midtown Community Clinic', role }],
  };
}

const page: Paged<DocumentListItem> = {
  page: 1,
  pageSize: 20,
  totalCount: 1,
  totalPages: 1,
  items: [
    {
      id: 'd1',
      projectId: 'p1',
      documentNumber: 'MCC-M-23 05 00',
      title: 'Common Work Results for HVAC',
      category: 'Specification',
      discipline: 'Mechanical',
      status: 'Issued',
      currentRevisionId: 'r1',
      currentVersionLabel: 'R1',
      currentApprovalStatus: 'NotReviewed',
      currentMimeType: 'application/pdf',
      updatedAt: '2026-10-28T08:00:00Z',
      revisions: [
        { id: 'r0', versionLabel: 'R0', isCurrent: false, approvalStatus: 'NotReviewed' },
        { id: 'r1', versionLabel: 'R1', isCurrent: true, approvalStatus: 'NotReviewed' },
      ],
    },
  ],
};

describe('DocumentRegisterPage', () => {
  let http: HttpTestingController;

  async function render(role: 'Requester' | 'DocumentController', data: Paged<DocumentListItem>) {
    TestBed.configureTestingModule({
      imports: [DocumentRegisterPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    const session = TestBed.inject(SessionService);
    session.me.set(me(role));
    session.projectId.set('p1');
    const fixture = TestBed.createComponent(DocumentRegisterPage);
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/projects/p1/documents').flush(data);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => http.verify());

  it('renders seeded documents with current and superseded revision chips', async () => {
    const el = await render('Requester', page);
    expect(el.querySelector('table')?.textContent).toContain('MCC-M-23 05 00');
    const chips = Array.from(el.querySelectorAll('.rev-chip'));
    expect(chips.map((c) => c.textContent?.trim().slice(0, 2))).toEqual(['R0', 'R1']);
    expect(chips[1].classList.contains('current')).toBe(true);
    expect(chips[0].classList.contains('current')).toBe(false);
    expect(el.textContent).toContain('Mechanical / HVAC');
  });

  it('hides the upload action from requesters (the server enforces it too)', async () => {
    const el = await render('Requester', page);
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).not.toContain('New document');
  });

  it('shows the upload action to document controllers', async () => {
    const el = await render('DocumentController', page);
    const buttons = Array.from(el.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(buttons).toContain('New document');
  });

  it('shows an empty state when nothing matches', async () => {
    const el = await render('Requester', { ...page, items: [], totalCount: 0, totalPages: 0 });
    expect(el.textContent).toContain('No documents match');
  });
});
