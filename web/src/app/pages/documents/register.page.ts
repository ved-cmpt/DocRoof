import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
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
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { openDialog } from '../../shared/dialog';
import {
  EmptyStateComponent,
  FilterChipComponent,
  FilterOption,
  IconComponent,
  PagerComponent,
  ShortDatePipe,
  SkeletonRowsComponent,
  StatusChipComponent,
} from '../../shared/ui';
import { MatDialog } from '@angular/material/dialog';
import { UploadDialogComponent, UploadDialogData } from './upload-dialog.component';

const opts = (values: readonly string[]): FilterOption[] =>
  values.map((v) => ({ value: v, label: label(v) }));

@Component({
  selector: 'app-document-register',
  imports: [
    FormsModule,
    RouterLink,
    TopbarComponent,
    IconComponent,
    FilterChipComponent,
    PagerComponent,
    StatusChipComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    ShortDatePipe,
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
  protected readonly disciplineOptions = opts(DISCIPLINES);
  protected readonly statusOptions = opts(DOCUMENT_STATUSES);
  protected readonly categoryOptions = opts(CATEGORIES);
  protected readonly approvalOptions = opts([
    'NotReviewed',
    'Pending',
    'Approved',
    'ApprovedWithComments',
    'ReviseAndResubmit',
  ]);
  protected readonly revisionOptions = ['R0', 'R1', 'R2', 'R3'].map((v) => ({
    value: v,
    label: v,
  }));
  protected readonly sortOptions: FilterOption[] = [
    { value: 'number', label: 'Number A–Z' },
    { value: '-number', label: 'Number Z–A' },
    { value: 'title', label: 'Title A–Z' },
  ];

  protected readonly query = signal<DocumentQuery>({ page: 1, pageSize: 20, sort: '-updated' });
  protected readonly result = signal<Paged<DocumentListItem> | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly canUpload = computed(() => {
    const role = this.session.role();
    return role === 'DocumentController' || role === 'ProjectManager';
  });
  protected readonly activeFilters = computed(() => {
    const q = this.query();
    return [q.search, q.discipline, q.status, q.category, q.approvalStatus, q.revision].filter(
      (v) => !!v,
    ).length;
  });

  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private sub?: Subscription;

  /** Optional ?search= deep link (global search and the guided tour). */
  readonly search = input<string | undefined>();

  constructor() {
    effect(() => {
      const s = this.search();
      untracked(() => {
        if (s !== undefined && s !== this.query().search) {
          this.query.update((q) => ({ ...q, search: s, page: 1 }));
        }
      });
    });
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
    void this.router.navigate([], { queryParams: { search: null }, replaceUrl: true });
  }

  protected retry(): void {
    this.query.update((q) => ({ ...q }));
  }

  protected open(d: DocumentListItem, event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a, button')) {
      return;
    }
    void this.router.navigate(['/app/documents', d.id]);
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
    openDialog<UploadDialogComponent, UploadDialogData, DocumentDetail>(
      this.dialog,
      UploadDialogComponent,
      data,
    )
      .afterClosed()
      .subscribe((created) => {
        if (created) {
          this.toast.success(
            `${created.documentNumber} created with revision ${created.revisions[0]?.versionLabel}.`,
          );
          void this.router.navigate(['/app/documents', created.id]);
        }
      });
  }
}
