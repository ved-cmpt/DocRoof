import { HttpClient, HttpContext, HttpContextToken, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
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

  downloadUrl(revisionId: string): string {
    return `/api/document-revisions/${revisionId}/download`;
  }
}
