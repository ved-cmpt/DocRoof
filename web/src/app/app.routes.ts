import { Routes } from '@angular/router';
import { authGuard } from './core/http';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'DocRoof — Construction document control',
    loadComponent: () => import('./pages/landing/landing.page').then((m) => m.LandingPage),
  },
  {
    path: 'case-study',
    title: 'Case study — DocRoof',
    loadComponent: () => import('./pages/case-study/case-study.page').then((m) => m.CaseStudyPage),
  },
  {
    path: 'login',
    title: 'Sign in — DocRoof',
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'demo',
    title: 'Try the demo — DocRoof',
    loadComponent: () => import('./pages/demo/demo.page').then((m) => m.DemoPage),
  },
  {
    path: 'app',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'documents' },
      {
        path: 'documents',
        title: 'Document register — DocRoof',
        loadComponent: () =>
          import('./pages/documents/register.page').then((m) => m.DocumentRegisterPage),
      },
      {
        path: 'documents/:id',
        title: 'Document — DocRoof',
        loadComponent: () =>
          import('./pages/documents/document-detail.page').then((m) => m.DocumentDetailPage),
      },
      {
        path: 'rfis',
        title: 'RFIs — DocRoof',
        loadComponent: () => import('./pages/rfis/rfi-list.page').then((m) => m.RfiListPage),
      },
      {
        path: 'rfis/:id',
        title: 'RFI — DocRoof',
        loadComponent: () => import('./pages/rfis/rfi-detail.page').then((m) => m.RfiDetailPage),
      },
      {
        path: 'submittals',
        title: 'Submittals — DocRoof',
        loadComponent: () =>
          import('./pages/submittals/submittal-list.page').then((m) => m.SubmittalListPage),
      },
      {
        path: 'submittals/:id',
        title: 'Submittal — DocRoof',
        loadComponent: () =>
          import('./pages/submittals/submittal-detail.page').then((m) => m.SubmittalDetailPage),
      },
      {
        path: 'review-queue',
        title: 'Review queue — DocRoof',
        loadComponent: () =>
          import('./pages/review-queue/review-queue.page').then((m) => m.ReviewQueuePage),
      },
      {
        path: 'insights',
        title: 'Insights — DocRoof',
        loadComponent: () => import('./pages/insights/insights.page').then((m) => m.InsightsPage),
      },
      {
        path: 'audit',
        title: 'Audit trail — DocRoof',
        loadComponent: () => import('./pages/audit/audit.page').then((m) => m.AuditPage),
      },
      {
        path: 'forbidden',
        title: 'Access denied — DocRoof',
        loadComponent: () => import('./pages/errors/error.page').then((m) => m.ForbiddenPage),
      },
      {
        path: '**',
        title: 'Not found — DocRoof',
        loadComponent: () => import('./pages/errors/error.page').then((m) => m.NotFoundPage),
      },
    ],
  },
  {
    path: 'forbidden',
    title: 'Access denied — DocRoof',
    loadComponent: () => import('./pages/errors/error.page').then((m) => m.ForbiddenPage),
  },
  {
    path: '**',
    title: 'Not found — DocRoof',
    loadComponent: () => import('./pages/errors/error.page').then((m) => m.NotFoundPage),
  },
];
