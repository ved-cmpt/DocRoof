import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiService, SILENT_ERRORS, toParams } from './api.service';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('drops empty filters from query parameters', () => {
    const params = toParams({ search: 'HVAC', discipline: '', status: undefined, page: 2 });
    expect(params.keys()).toEqual(['search', 'page']);
    expect(params.get('page')).toBe('2');
  });

  it('requests a project register with server-side paging and filters', () => {
    api
      .documents('p1', { search: '23 05', discipline: 'Mechanical', page: 1, pageSize: 20 })
      .subscribe((r) => {
        expect(r.totalCount).toBe(1);
      });
    const req = http.expectOne((r) => r.url === '/api/projects/p1/documents');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('search')).toBe('23 05');
    expect(req.request.params.get('discipline')).toBe('Mechanical');
    expect(req.request.params.get('pageSize')).toBe('20');
    req.flush({ items: [], page: 1, pageSize: 20, totalCount: 1, totalPages: 1 });
  });

  it('marks auth and upload calls as silent so pages render their own errors', () => {
    api.me().subscribe({ error: () => undefined });
    const me = http.expectOne('/api/auth/me');
    expect(me.request.context.get(SILENT_ERRORS)).toBe(true);
    me.flush({ title: 'Not signed in' }, { status: 401, statusText: 'Unauthorized' });

    api.addRevision('d1', new FormData()).subscribe();
    const upload = http.expectOne('/api/documents/d1/revisions');
    expect(upload.request.method).toBe('POST');
    expect(upload.request.context.get(SILENT_ERRORS)).toBe(true);
    upload.flush({});
  });

  it('switches persona with a JSON body', () => {
    api.switchPersona('manager').subscribe();
    const req = http.expectOne('/api/demo/persona');
    expect(req.request.body).toEqual({ persona: 'manager' });
    req.flush({ tenantId: 't', expiresAt: null, persona: 'manager', reused: true });
  });

  it('builds download URLs that the server authorizes per revision', () => {
    expect(api.downloadUrl('abc')).toBe('/api/document-revisions/abc/download');
  });
});
