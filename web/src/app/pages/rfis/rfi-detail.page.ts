import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { Comment, Member, RfiAction, RfiDetail } from '../../core/api.models';
import { problemMessage } from '../../core/http';
import { label, tone } from '../../core/labels';
import { SessionService } from '../../core/session.service';
import { ToastService } from '../../core/toast.service';
import { TourStep, WalkthroughService } from '../../core/walkthrough.service';
import { CommentsComponent, TimelineComponent } from '../../shared/activity.components';

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

@Component({
  selector: 'app-rfi-detail',
  imports: [
    DatePipe,
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatInputModule,
    MatSelectModule,
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
  protected readonly session = inject(SessionService);
  readonly id = input.required<string>();

  protected readonly label = label;
  protected readonly tone = tone;
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

  // Action form fields
  protected assigneeId = '';
  protected dueDate = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  protected answer = '';
  protected reason = '';
  protected readonly minDue = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  protected readonly pending = computed(
    () => this.rfi()?.responses.find((r) => r.status === 'Pending') ?? null,
  );

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
        this.api.members(r.projectId).subscribe((m) => {
          this.members.set(m);
          if (!this.assigneeId) {
            this.assigneeId = r.assignee?.id ?? m.find((x) => x.role === 'Reviewer')?.userId ?? '';
          }
        });
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

  protected run(action: RfiAction): void {
    const r = this.rfi();
    if (!r || this.busy()) {
      return;
    }
    const body: Record<string, unknown> = { rowVersion: r.rowVersion };
    if (action === 'Assign') {
      if (!this.assigneeId || !this.dueDate) {
        this.actionError.set('Choose a reviewer and a due date.');
        return;
      }
      body['assigneeId'] = this.assigneeId;
      body['dueAt'] = new Date(`${this.dueDate}T17:00:00`).toISOString();
    }
    if (action === 'Answer') {
      if (this.answer.trim().length < 5) {
        this.actionError.set('Write an answer (at least 5 characters).');
        return;
      }
      body['answer'] = this.answer.trim();
    }
    if (action === 'RejectAnswer' || action === 'Reopen') {
      if (this.reason.trim().length < 5) {
        this.actionError.set('Give a reason (at least 5 characters).');
        return;
      }
      body['reason'] = this.reason.trim();
    }
    this.busy.set(action);
    this.actionError.set('');
    this.api.rfiAction(r.id, ENDPOINT[action], body).subscribe({
      next: (updated) => {
        this.rfi.set(updated);
        this.busy.set(null);
        this.answer = '';
        this.reason = '';
        this.toast.success(`${updated.referenceNumber}: ${label(action)} done.`);
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
}
