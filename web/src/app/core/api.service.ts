import { HttpClient, HttpContext, HttpContextToken, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  AuditEvent,
  AuditQuery,
  Comment,
  CreateRfi,
  Insights,
  NotificationFeed,
  ReviewQueueItem,
  RfiDetail,
  RfiListItem,
  RfiQuery,
  SubmittalDetail,
  SubmittalListItem,
  SubmittalQuery,
  DemoSession,
  DocumentDetail,
  DocumentHistory,
  DocumentListItem,
  DocumentQuery,
  Me,
  Member,
  Paged,
  Persona,
  ProjectDetail,
  ProjectSummary,
  Revision,
  RevisionComparison,
} from './api.models';

/** Set on a request to suppress the global error toast (the caller renders the error itself). */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);

export const silent = () => ({ context: new HttpContext().set(SILENT_ERRORS, true) });

export function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/** Thin typed client for the DocRoof REST API. All authorization happens on the server. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  antiforgery(): Observable<{ token: string }> {
    return this.http.get<{ token: string }>('/api/auth/antiforgery', silent());
  }

  me(): Observable<Me> {
    return this.http.get<Me>('/api/auth/me', silent());
  }

  login(email: string, password: string): Observable<unknown> {
    return this.http.post('/api/auth/login', { email, password }, silent());
  }

  logout(): Observable<unknown> {
    return this.http.post('/api/auth/logout', {});
  }

  startDemo(): Observable<DemoSession> {
    return this.http.post<DemoSession>('/api/demo/start', {}, silent());
  }

  resetDemo(): Observable<DemoSession> {
    return this.http.post<DemoSession>('/api/demo/reset', {});
  }

  personas(): Observable<Persona[]> {
    return this.http.get<Persona[]>('/api/demo/personas');
  }

  switchPersona(persona: string): Observable<DemoSession> {
    return this.http.post<DemoSession>('/api/demo/persona', { persona });
  }

  projects(): Observable<ProjectSummary[]> {
    return this.http.get<ProjectSummary[]>('/api/projects');
  }

  project(id: string): Observable<ProjectDetail> {
    return this.http.get<ProjectDetail>(`/api/projects/${id}`);
  }

  members(projectId: string): Observable<Member[]> {
    return this.http.get<Member[]>(`/api/projects/${projectId}/members`);
  }

  documents(projectId: string, query: DocumentQuery): Observable<Paged<DocumentListItem>> {
    return this.http.get<Paged<DocumentListItem>>(`/api/projects/${projectId}/documents`, {
      params: toParams(query),
    });
  }

  document(id: string): Observable<DocumentDetail> {
    return this.http.get<DocumentDetail>(`/api/documents/${id}`, silent());
  }

  history(id: string): Observable<DocumentHistory> {
    return this.http.get<DocumentHistory>(`/api/documents/${id}/history`);
  }

  compare(id: string, from: string, to: string): Observable<RevisionComparison> {
    return this.http.get<RevisionComparison>(`/api/documents/${id}/compare`, {
      params: toParams({ from, to }),
    });
  }

  createDocument(projectId: string, form: FormData): Observable<DocumentDetail> {
    return this.http.post<DocumentDetail>(`/api/projects/${projectId}/documents`, form, silent());
  }

  addRevision(documentId: string, form: FormData): Observable<Revision> {
    return this.http.post<Revision>(`/api/documents/${documentId}/revisions`, form, silent());
  }

  previewBlob(revisionId: string): Observable<Blob> {
    return this.http.get(`/api/document-revisions/${revisionId}/preview`, {
      responseType: 'blob',
      ...silent(),
    });
  }

  // ---------- RFIs ----------
  rfis(projectId: string, query: RfiQuery): Observable<Paged<RfiListItem>> {
    return this.http.get<Paged<RfiListItem>>(`/api/projects/${projectId}/rfis`, {
      params: toParams(query),
    });
  }

  rfi(id: string): Observable<RfiDetail> {
    return this.http.get<RfiDetail>(`/api/rfis/${id}`, silent());
  }

  createRfi(projectId: string, body: CreateRfi): Observable<RfiDetail> {
    return this.http.post<RfiDetail>(`/api/projects/${projectId}/rfis`, body, silent());
  }

  /** Runs an RFI transition; the body always carries the rowversion the user last saw. */
  rfiAction(id: string, action: string, body: object): Observable<RfiDetail> {
    return this.http.post<RfiDetail>(`/api/rfis/${id}/${action}`, body, silent());
  }

  // ---------- Submittals ----------
  submittals(projectId: string, query: SubmittalQuery): Observable<Paged<SubmittalListItem>> {
    return this.http.get<Paged<SubmittalListItem>>(`/api/projects/${projectId}/submittals`, {
      params: toParams(query),
    });
  }

  submittal(id: string): Observable<SubmittalDetail> {
    return this.http.get<SubmittalDetail>(`/api/submittals/${id}`, silent());
  }

  createSubmittal(projectId: string, body: object): Observable<SubmittalDetail> {
    return this.http.post<SubmittalDetail>(`/api/projects/${projectId}/submittals`, body, silent());
  }

  submittalAction(id: string, action: string, body: object): Observable<SubmittalDetail> {
    return this.http.post<SubmittalDetail>(`/api/submittals/${id}/${action}`, body, silent());
  }

  // ---------- Activity ----------
  comments(resource: 'documents' | 'rfis' | 'submittals', id: string): Observable<Comment[]> {
    return this.http.get<Comment[]>(`/api/${resource}/${id}/comments`);
  }

  addComment(
    resource: 'documents' | 'rfis' | 'submittals',
    id: string,
    body: { body: string; page?: number | null; revisionId?: string | null },
  ): Observable<Comment> {
    return this.http.post<Comment>(`/api/${resource}/${id}/comments`, body, silent());
  }

  audit(projectId: string, query: AuditQuery): Observable<Paged<AuditEvent>> {
    return this.http.get<Paged<AuditEvent>>(`/api/projects/${projectId}/audit`, {
      params: toParams(query),
    });
  }

  reviewQueue(
    projectId: string,
    assignee?: string,
    overdueOnly = false,
  ): Observable<ReviewQueueItem[]> {
    return this.http.get<ReviewQueueItem[]>(`/api/projects/${projectId}/review-queue`, {
      params: toParams({ assignee, overdueOnly: overdueOnly || undefined }),
    });
  }

  insights(projectId: string): Observable<Insights> {
    return this.http.get<Insights>(`/api/projects/${projectId}/insights`);
  }

  notifications(): Observable<NotificationFeed> {
    return this.http.get<NotificationFeed>('/api/notifications', silent());
  }

  markNotificationRead(id: string): Observable<unknown> {
    return this.http.post(`/api/notifications/${id}/read`, {});
  }

  markAllNotificationsRead(): Observable<unknown> {
    return this.http.post('/api/notifications/read-all', {});
  }

  downloadUrl(revisionId: string): string {
    return `/api/document-revisions/${revisionId}/download`;
  }
}
