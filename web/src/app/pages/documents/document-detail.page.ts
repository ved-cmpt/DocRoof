import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuditEvent, DocumentDetail, Revision, RevisionComparison } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { auditLabel, fileSize, label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { WalkthroughService } from '../../core/walkthrough.service';
import { TopbarComponent } from '../../layout/topbar.component';
import { CommentsComponent, TimelineComponent } from '../../shared/activity.components';
import { openDialog } from '../../shared/dialog';
import { FilePreviewComponent } from '../../shared/file-preview.component';
import {
  EmptyStateComponent,
  IconComponent,
  LongDateTimePipe,
  ShortDatePipe,
  StatusChipComponent,
} from '../../shared/ui';
import { RfiCreateDialogComponent, RfiCreateData } from '../rfis/rfi-create-dialog.component';
import { UploadDialogComponent, UploadDialogData } from './upload-dialog.component';
import { ExtractionPanelComponent } from './extraction-panel.component';
import { Comment, RfiDetail } from '../../core/api.models';

/** Seeded HVAC specification used by the guided demo task. */
export const GUIDED_DOCUMENT = 'MCC-M-23 05 00';

@Component({
  selector: 'app-document-detail',
  imports: [
    RouterLink,
    FormsModule,
    MatTooltipModule,
    TopbarComponent,
    IconComponent,
    StatusChipComponent,
    EmptyStateComponent,
    ShortDatePipe,
    LongDateTimePipe,
    FilePreviewComponent,
    CommentsComponent,
    TimelineComponent,
    ExtractionPanelComponent,
  ],
  templateUrl: './document-detail.page.html',
  styleUrl: './document-detail.page.scss',
})
export class DocumentDetailPage {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly session = inject(SessionService);
  private readonly tour = inject(WalkthroughService);
  protected readonly comments = signal<Comment[]>([]);
  /** Page currently shown in the preview (used to pre-fill "Raise RFI on this page"). */
  protected readonly viewPage = signal(1);
  protected readonly canRaiseRfi = computed(() => {
    const role = this.doc()?.myRole;
    return role === 'Requester' || role === 'ProjectManager' || role === 'DocumentController';
  });

  /** Route param and optional query params (bound via withComponentInputBinding). */
  readonly id = input.required<string>();
  readonly rev = input<string | undefined>();
  readonly page = input<string | undefined>();

  protected readonly label = label;
  protected readonly tone = tone;
  protected readonly size = fileSize;
  protected readonly auditLabel = auditLabel;

  protected readonly doc = signal<DocumentDetail | null>(null);
  protected readonly events = signal<AuditEvent[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly notFound = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly previewPage = signal<number | null>(null);
  protected readonly compareFrom = signal<string | null>(null);
  protected readonly compareTo = signal<string | null>(null);
  protected readonly comparison = signal<RevisionComparison | null>(null);
  protected readonly tab = signal<'comments' | 'activity' | 'compare'>('comments');
  protected readonly tabs = computed(() => {
    const list: { key: 'comments' | 'activity' | 'compare'; label: string; count?: number }[] = [
      { key: 'comments', label: 'Comments', count: this.comments().length },
      { key: 'activity', label: 'Activity', count: this.events().length },
    ];
    if ((this.doc()?.revisions.length ?? 0) > 1) {
      list.push({ key: 'compare', label: 'Compare revisions' });
    }
    return list;
  });

  protected readonly selected = computed<Revision | null>(() => {
    const d = this.doc();
    if (!d) {
      return null;
    }
    return (
      d.revisions.find((r) => r.id === this.selectedId()) ??
      d.revisions.find((r) => r.isCurrent) ??
      d.revisions[0] ??
      null
    );
  });
  protected readonly current = computed(
    () => this.doc()?.revisions.find((r) => r.isCurrent) ?? null,
  );

  constructor() {
    effect(() => {
      const id = this.id();
      this.session.version();
      untracked(() => this.load(id));
    });
    effect(() => {
      const rev = this.rev();
      const page = Number(this.page());
      untracked(() => {
        if (rev) {
          this.selectedId.set(rev);
        }
        this.previewPage.set(Number.isFinite(page) && page > 0 ? page : null);
        if (Number.isFinite(page) && page > 0) {
          this.viewPage.set(page);
        }
      });
    });
  }

  protected load(id: string): void {
    this.loading.set(true);
    this.error.set('');
    this.notFound.set(false);
    this.api.document(id).subscribe({
      next: (d) => {
        this.doc.set(d);
        this.loading.set(false);
        const revs = d.revisions;
        if (revs.length > 1) {
          this.compareFrom.set(revs[1].id);
          this.compareTo.set(revs[0].id);
        }
        this.api.history(id).subscribe((h) => this.events.set(h.events));
        this.api.comments('documents', id).subscribe((c) => this.comments.set(c));
        if (d.documentNumber === GUIDED_DOCUMENT) {
          this.tour.mark('open-spec');
        }
      },
      error: (e: unknown) => {
        this.loading.set(false);
        if (e instanceof HttpErrorResponse && e.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(problemMessage(e, 'The document could not be loaded.'));
        }
      },
    });
  }

  protected select(r: Revision): void {
    this.selectedId.set(r.id);
    this.previewPage.set(null);
    this.viewPage.set(1);
    if (!r.isCurrent && this.doc()?.documentNumber === GUIDED_DOCUMENT) {
      this.tour.mark('history');
    }
    void this.router.navigate([], {
      queryParams: { rev: r.id, page: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected raiseRfi(): void {
    const d = this.doc();
    const r = this.selected();
    if (!d || !r) {
      return;
    }
    const data: RfiCreateData = {
      projectId: d.projectId,
      documentId: d.id,
      revisionId: r.id,
      page: this.viewPage(),
    };
    openDialog<RfiCreateDialogComponent, RfiCreateData, RfiDetail>(
      this.dialog,
      RfiCreateDialogComponent,
      data,
    )
      .afterClosed()
      .subscribe((rfi) => {
        if (rfi) {
          this.tour.mark('create-rfi', rfi.id);
          this.toast.success(
            `${rfi.referenceNumber} created, citing ${r.versionLabel} page ${rfi.citation.page}.`,
          );
          void this.router.navigate(['/app/rfis', rfi.id]);
        }
      });
  }

  /** "View on page N" from a suggestion: show that page of the cited revision in the preview. */
  protected showPage(page: number): void {
    const r = this.selected();
    this.previewPage.set(page);
    this.viewPage.set(page);
    void this.router.navigate([], {
      queryParams: { rev: r?.id, page },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    document.getElementById('preview')?.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  protected onComment(c: Comment): void {
    this.comments.update((list) => [...list, c]);
  }

  protected onPreviewPage(p: number): void {
    this.viewPage.set(p);
    void this.router.navigate([], {
      queryParams: { page: p },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected download(r: Revision): void {
    // A same-origin navigation: the auth cookie authorizes it and the server sends Content-Disposition: attachment.
    const a = document.createElement('a');
    a.href = this.api.downloadUrl(r.id);
    a.rel = 'noopener';
    a.click();
  }

  protected runCompare(): void {
    const d = this.doc();
    const from = this.compareFrom();
    const to = this.compareTo();
    if (!d || !from || !to || from === to) {
      this.comparison.set(null);
      return;
    }
    this.api.compare(d.id, from, to).subscribe((c) => this.comparison.set(c));
    if (d.documentNumber === GUIDED_DOCUMENT) {
      this.tour.mark('history');
    }
  }

  protected uploadRevision(): void {
    const d = this.doc();
    if (!d) {
      return;
    }
    const labels = d.revisions.map((r) => r.versionLabel);
    const max = labels
      .map((l) => /^R(\d+)$/i.exec(l))
      .filter((m) => m)
      .map((m) => Number(m![1]));
    const data: UploadDialogData = {
      mode: 'revision',
      documentId: d.id,
      documentNumber: d.documentNumber,
      suggestedLabel: `R${max.length ? Math.max(...max) + 1 : labels.length}`,
    };
    openDialog<UploadDialogComponent, UploadDialogData, Revision>(
      this.dialog,
      UploadDialogComponent,
      data,
    )
      .afterClosed()
      .subscribe((rev) => {
        if (rev) {
          this.toast.success(
            `Revision ${rev.versionLabel} uploaded. Previous revisions are unchanged.`,
          );
          this.selectedId.set(rev.id);
          this.load(d.id);
        }
      });
  }

  protected moveTab(delta: number): void {
    const list = this.tabs();
    const i = list.findIndex((t) => t.key === this.tab());
    const next = list[(i + delta + list.length) % list.length];
    this.tab.set(next.key);
    document.getElementById('doc-tab-' + next.key)?.focus();
  }
}
