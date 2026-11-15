import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../core/api.service';
import {
  CATEGORIES,
  DISCIPLINES,
  DOCUMENT_STATUSES,
  DocumentDetail,
  DocumentListItem,
  DocumentQuery,
  Paged,
} from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { UploadDialogComponent, UploadDialogData } from './upload-dialog.component';

@Component({
  selector: 'app-document-register',
  imports: [
    FormsModule,
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatInputModule,
    MatSelectModule,
    MatPaginatorModule,
  ],
  templateUrl: './register.page.html',
  styleUrl: './register.page.scss',
})
export class DocumentRegisterPage {
  private readonly api = inject(ApiService);
  protected readonly session = inject(SessionService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  protected readonly label = label;
  protected readonly tone = tone;
  protected readonly disciplines = DISCIPLINES;
  protected readonly categories = CATEGORIES;
  protected readonly statuses = DOCUMENT_STATUSES;
  protected readonly approvals = [
    'NotReviewed',
    'Pending',
    'Approved',
    'ApprovedWithComments',
    'ReviseAndResubmit',
  ];

  protected readonly query = signal<DocumentQuery>({ page: 1, pageSize: 20, sort: '-updated' });
  protected readonly result = signal<Paged<DocumentListItem> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly canUpload = computed(() => {
    const role = this.session.role();
    return role === 'DocumentController' || role === 'ProjectManager';
  });
  protected readonly hasFilters = computed(() => {
    const q = this.query();
    return !!(q.search || q.discipline || q.status || q.category || q.approvalStatus || q.revision);
  });

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private sub?: Subscription;

  constructor() {
    effect(() => {
      const project = this.session.project();
      const q = this.query();
      this.session.version();
      untracked(() => this.load(project?.id ?? null, q));
    });
  }

  private load(projectId: string | null, q: DocumentQuery): void {
    this.sub?.unsubscribe();
    if (!projectId) {
      this.loading.set(false);
      this.result.set(null);
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sub = this.api.documents(projectId, q).subscribe({
      next: (r) => {
        this.result.set(r);
        this.loading.set(false);
      },
      error: (e) => {
        this.error.set(problemMessage(e, 'The register could not be loaded.'));
        this.loading.set(false);
      },
    });
  }

  protected set<K extends keyof DocumentQuery>(key: K, value: DocumentQuery[K]): void {
    this.query.update((q) => ({
      ...q,
      [key]: value,
      page: key === 'page' ? (value as number) : 1,
    }));
  }

  protected onSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.set('search', value.trim()), 300);
  }

  protected clearFilters(): void {
    this.query.set({ page: 1, pageSize: this.query().pageSize, sort: this.query().sort });
  }

  protected onPage(e: PageEvent): void {
    this.query.update((q) => ({ ...q, page: e.pageIndex + 1, pageSize: e.pageSize }));
  }

  protected retry(): void {
    this.query.update((q) => ({ ...q }));
  }

  protected newDocument(): void {
    const project = this.session.project();
    if (!project) {
      return;
    }
    const data: UploadDialogData = {
      mode: 'document',
      projectId: project.id,
      suggestedLabel: 'R0',
    };
    this.dialog
      .open(UploadDialogComponent, { data, autoFocus: 'first-tabbable' })
      .afterClosed()
      .subscribe((created?: DocumentDetail) => {
        if (created) {
          this.toast.success(
            `${created.documentNumber} created with revision ${created.revisions[0]?.versionLabel}.`,
          );
          void this.router.navigate(['/app/documents', created.id]);
        }
      });
  }
}
