import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExtractionResult, Revision } from '../../core/api.models';
import { ExtractionPanelComponent } from './extraction-panel.component';

const revision = { id: 'rev1', versionLabel: 'R0' } as Revision;

const ready: ExtractionResult = {
  revisionId: 'rev1',
  status: 'Ready',
  engineLabel: 'Rules-based extraction',
  message: '1 suggestions, each citing the page it came from.',
  canRun: false,
  suggestions: [
    {
      id: 's1',
      revisionId: 'rev1',
      field: 'SpecSection',
      proposedValue: '23 31 00',
      page: 1,
      snippet: 'SECTION 23 31 00 - HVAC DUCTS AND CASINGS',
      confidence: 'High',
      rule: 'heading: SECTION nn nn nn',
      engine: 'rules-v1',
      status: 'Pending',
      decidedBy: null,
      decidedAt: null,
      currentValue: null,
      rowVersion: 'AAAA',
    },
  ],
};

describe('ExtractionPanelComponent', () => {
  async function render(result: ExtractionResult, canDecide: boolean) {
    TestBed.configureTestingModule({
      imports: [ExtractionPanelComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ExtractionPanelComponent);
    fixture.componentRef.setInput('revision', revision);
    fixture.componentRef.setInput('canDecide', canDecide);
    const pages: number[] = [];
    fixture.componentInstance.viewPage.subscribe((p) => pages.push(p));
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne('/api/document-revisions/rev1/extract-suggestions').flush(result);
    fixture.detectChanges();
    await fixture.whenStable();
    http.verify();
    return { el: fixture.nativeElement as HTMLElement, pages };
  }

  it('labels the rules engine honestly and cites the source page', async () => {
    const { el, pages } = await render(ready, false);
    expect(el.querySelector('[data-testid="engine-label"]')?.textContent?.trim()).toBe(
      'Rules-based extraction',
    );
    expect(el.textContent).not.toMatch(/\bAI\b/);
    const view = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('View on page 1'),
    )!;
    view.click();
    expect(pages).toEqual([1]);
  });

  it('shows accept/reject only to people who may decide', async () => {
    const readOnly = await render(ready, false);
    expect(readOnly.el.textContent).not.toContain('Accept');
    TestBed.resetTestingModule();
    const editor = await render(ready, true);
    expect(editor.el.textContent).toContain('Accept');
    expect(editor.el.textContent).toContain('Reject');
  });

  it('explains the image-only limitation instead of offering extraction', async () => {
    const { el } = await render(
      {
        ...ready,
        status: 'NoTextLayer',
        message: 'No text layer detected — extraction unavailable (no OCR configured).',
        suggestions: [],
      },
      true,
    );
    expect(el.querySelector('[data-testid="extraction-limitation"]')?.textContent?.trim()).toBe(
      'No text layer detected — extraction unavailable (no OCR configured).',
    );
    expect(el.textContent).not.toContain('Suggest metadata');
  });
});
