import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Comment, Member, RfiAction, RfiDetail, RfiState } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { TourStep, WalkthroughService } from '../../core/walkthrough.service';
import { TopbarComponent } from '../../layout/topbar.component';
import {
  AssignDialogComponent,
  AssignDialogData,
  AssignResult,
  ReasonDialogComponent,
  ReasonDialogData,
  isoDay,
} from '../../shared/action-dialogs';
import { CommentsComponent, TimelineComponent } from '../../shared/activity.components';
import { openDialog } from '../../shared/dialog';
import {
  AvatarComponent,
  EmptyStateComponent,
  IconComponent,
  LongDateTimePipe,
  PersonComponent,
  RelativeTimePipe,
  ShortDatePipe,
  StatusChipComponent,
} from '../../shared/ui';

const ENDPOINT: Record<RfiAction, string> = {
  Submit: 'submit',
  Assign: 'assign',
  Answer: 'answer',
  ApproveAnswer: 'approve-answer',
  RejectAnswer: 'reject-answer',
  Close: 'close',
  Reopen: 'reopen',
};

const TOUR: Partial<Record<RfiAction, TourStep>> = {
  Assign: 'assign',
  Answer: 'answer',
  ApproveAnswer: 'approve',
  Close: 'close',
};

/** Who can move an RFI forward in each state (used to explain why nothing is actionable). */
const WAITING_ON: Record<RfiState, string> = {
  Draft: 'The author submits this draft.',
  Submitted: 'A project manager assigns a reviewer next.',
  Assigned: 'The assigned reviewer answers next.',
  Answered: 'A project manager approves or returns the answer next.',
  Closed: 'This RFI is closed. A project manager can reopen it.',
  Reopened: 'A project manager reassigns it next.',
};

@Component({
  selector: 'app-rfi-detail',
  imports: [
    FormsModule,
    RouterLink,
    MatTooltipModule,
    TopbarComponent,
    IconComponent,
    StatusChipComponent,
    AvatarComponent,
    PersonComponent,
    EmptyStateComponent,
    RelativeTimePipe,
    ShortDatePipe,
    LongDateTimePipe,
    CommentsComponent,
    TimelineComponent,
  ],
  templateUrl: './rfi-detail.page.html',
  styleUrl: './rfi-detail.page.scss',
})
export class RfiDetailPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly tour = inject(WalkthroughService);
  private readonly dialog = inject(MatDialog);
  protected readonly session = inject(SessionService);
  readonly id = input.required<string>();

  protected readonly label = label;
  protected readonly rfi = signal<RfiDetail | null>(null);
  protected readonly members = signal<Member[]>([]);
  protected readonly reviewers = computed(() =>
    this.members().filter((m) => m.role === 'Reviewer'),
  );
  protected readonly loading = signal(true);
  protected readonly notFound = signal(false);
  protected readonly error = signal('');
  protected readonly actionError = signal('');
  protected readonly busy = signal<RfiAction | null>(null);
  protected readonly tab = signal<'comments' | 'activity'>('comments');

  protected answer = '';

  protected readonly pending = computed(
    () => this.rfi()?.responses.find((r) => r.status === 'Pending') ?? null,
  );
  protected readonly waitingOn = computed(() => {
    const r = this.rfi();
    return r ? `${WAITING_ON[r.state]} Switch persona from the profile menu to act.` : '';
  });

  constructor() {
    effect(() => {
      const id = this.id();
      this.session.version();
      untracked(() => this.load(id));
    });
  }

  /** Affordance only: the server re-checks every action and returns 403/409 if it is not allowed. */
  can(action: RfiAction): boolean {
    return this.rfi()?.availableActions.includes(action) ?? false;
  }

  protected load(id: string): void {
    this.loading.set(true);
    this.notFound.set(false);
    this.error.set('');
    this.api.rfi(id).subscribe({
      next: (r) => {
        this.rfi.set(r);
        this.loading.set(false);
        this.api.members(r.projectId).subscribe((m) => this.members.set(m));
      },
      error: (e: unknown) => {
        this.loading.set(false);
        if (e instanceof HttpErrorResponse && e.status === 404) {
          this.notFound.set(true);
        } else {
          this.error.set(problemMessage(e, 'The RFI could not be loaded.'));
        }
      },
    });
  }

  protected openAssign(): void {
    const r = this.rfi();
    if (!r) {
      return;
    }
    const reviewers = this.reviewers();
    const data: AssignDialogData = {
      title: r.state === 'Assigned' ? 'Reassign reviewer' : 'Assign reviewer',
      subtitle: `${r.referenceNumber} · ${r.subject}`,
      reviewers,
      assigneeId: r.assignee?.id ?? reviewers[0]?.userId ?? '',
      dueDate: r.dueAt ? r.dueAt.slice(0, 10) : isoDay(5),
      confirm: r.state === 'Assigned' ? 'Reassign' : 'Assign',
    };
    openDialog<AssignDialogComponent, AssignDialogData, AssignResult>(
      this.dialog,
      AssignDialogComponent,
      data,
    )
      .afterClosed()
      .subscribe((res) => {
        if (res) {
          this.run('Assign', { assigneeId: res.assigneeId, dueAt: res.dueAt });
        }
      });
  }

  protected openReason(action: 'RejectAnswer' | 'Reopen'): void {
    const r = this.rfi();
    if (!r) {
      return;
    }
    const data: ReasonDialogData =
      action === 'RejectAnswer'
        ? {
            title: 'Return to reviewer',
            subtitle: 'The reviewer is asked for a new answer.',
            label: 'What is missing?',
            confirm: 'Return to reviewer',
            danger: true,
          }
        : {
            title: 'Reopen RFI',
            subtitle: `${r.referenceNumber} goes back to the project manager for reassignment.`,
            label: 'Why reopen it?',
            confirm: 'Reopen RFI',
          };
    openDialog<ReasonDialogComponent, ReasonDialogData, string>(
      this.dialog,
      ReasonDialogComponent,
      data,
    )
      .afterClosed()
      .subscribe((reason) => {
        if (reason) {
          this.run(action, { reason });
        }
      });
  }

  protected postAnswer(): void {
    if (this.answer.trim().length < 5) {
      this.actionError.set('Write an answer (at least 5 characters).');
      return;
    }
    this.run('Answer', { answer: this.answer.trim() });
  }

  protected run(action: RfiAction, extra: Record<string, unknown> = {}): void {
    const r = this.rfi();
    if (!r || this.busy()) {
      return;
    }
    this.busy.set(action);
    this.actionError.set('');
    this.api.rfiAction(r.id, ENDPOINT[action], { rowVersion: r.rowVersion, ...extra }).subscribe({
      next: (updated) => {
        this.rfi.set(updated);
        this.busy.set(null);
        this.answer = '';
        this.toast.success(`${updated.referenceNumber}: ${label(action).toLowerCase()} done.`);
        const step = TOUR[action];
        if (step) {
          this.tour.mark(step, updated.id);
        }
      },
      error: (e: unknown) => {
        this.busy.set(null);
        this.actionError.set(problemMessage(e, 'The action failed.'));
        if (e instanceof HttpErrorResponse && e.status === 409) {
          this.load(r.id);
        }
      },
    });
  }

  protected onComment(c: Comment): void {
    this.rfi.update((r) => (r ? { ...r, comments: [...r.comments, c] } : r));
  }

  protected moveTab(): void {
    const next = this.tab() === 'comments' ? 'activity' : 'comments';
    this.tab.set(next);
    document.getElementById('rfi-tab-' + next)?.focus();
  }
}
