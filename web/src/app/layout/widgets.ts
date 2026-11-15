import { DatePipe } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { NotificationItem } from '../core/api.models';
import { SessionService } from '../core/session.service';
import { WalkthroughService } from '../core/walkthrough.service';

@Component({
  selector: 'app-notification-bell',
  imports: [MatButtonModule, MatMenuModule, DatePipe],
  template: `
    <button
      mat-icon-button
      class="bell"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="'Notifications, ' + unread() + ' unread'"
      (menuOpened)="refresh()"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path
          fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.71V3.5a2 2 0 0 0-4 0v.79A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"
        />
      </svg>
      @if (unread() > 0) {
        <span class="badge" aria-hidden="true">{{ unread() > 99 ? '99+' : unread() }}</span>
      }
    </button>
    <mat-menu #menu="matMenu" xPosition="before" class="notif-menu">
      <div class="head" role="presentation">
        <strong>Notifications</strong>
        @if (unread() > 0) {
          <button mat-button (click)="markAll($event)">Mark all read</button>
        }
      </div>
      @if (items().length === 0) {
        <div class="empty">You're all caught up.</div>
      }
      @for (n of items(); track n.id) {
        <button mat-menu-item class="item" [class.unread]="!n.isRead" (click)="open(n)">
          <span class="msg">{{ n.message }}</span>
          <span class="when">{{ n.kind }} · {{ n.createdAt | date: 'MMM d, HH:mm' }}</span>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    .bell {
      color: #fff;
      position: relative;
    }
    .badge {
      position: absolute;
      top: 4px;
      right: 2px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: var(--amber);
      color: var(--ink);
      font-size: 0.7rem;
      font-weight: 800;
      line-height: 18px;
    }
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px 4px 16px;
      min-width: 320px;
    }
    .empty {
      padding: 12px 16px;
      color: var(--muted);
    }
    .item {
      height: auto !important;
      min-height: 56px;
      line-height: 1.3;
      white-space: normal;
      padding-top: 8px;
      padding-bottom: 8px;
    }
    .item.unread {
      border-left: 3px solid var(--amber);
      background: #fffaf0;
    }
    .msg {
      display: block;
      font-size: 0.9rem;
    }
    .when {
      display: block;
      font-size: 0.75rem;
      color: var(--muted);
    }
  `,
})
export class NotificationBellComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  protected readonly items = signal<NotificationItem[]>([]);
  protected readonly unread = signal(0);

  constructor() {
    effect(() => {
      this.session.version();
      this.refresh();
    });
    const timer = setInterval(() => this.refresh(), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  refresh(): void {
    this.api.notifications().subscribe({
      next: (f) => {
        this.items.set(f.items);
        this.unread.set(f.unreadCount);
      },
      error: () => undefined,
    });
  }

  protected markAll(event: Event): void {
    event.stopPropagation();
    this.api.markAllNotificationsRead().subscribe(() => this.refresh());
  }

  protected open(n: NotificationItem): void {
    if (!n.isRead) {
      this.api.markNotificationRead(n.id).subscribe(() => this.refresh());
    }
    if (n.projectId !== this.session.project()?.id) {
      this.session.selectProject(n.projectId);
    }
    const path =
      n.resource === 'Rfi'
        ? '/app/rfis'
        : n.resource === 'Submittal'
          ? '/app/submittals'
          : '/app/documents';
    void this.router.navigate([path, n.resourceId]);
  }
}

@Component({
  selector: 'app-walkthrough-banner',
  imports: [MatButtonModule, RouterLink],
  template: `
    @if (tour.active()) {
      @if (tour.hidden()) {
        <div class="tour collapsed">
          <button mat-button (click)="tour.setHidden(false)">
            Show guided task ({{ tour.progress() }}/{{ total }})
          </button>
        </div>
      } @else {
        <section class="tour" aria-label="Guided demo task">
          <div class="head">
            <span class="eyebrow">Guided task · {{ tour.progress() }} of {{ total }} done</span>
            <span class="bar" aria-hidden="true"
              ><span [style.width.%]="(tour.progress() / total) * 100"></span
            ></span>
            <button mat-button (click)="tour.setHidden(true)">Hide</button>
          </div>
          @if (tour.current(); as step) {
            <p class="now">
              <strong>Next: {{ step.title }}.</strong> {{ step.hint }}
              @if (needsPersona()) {
                <span class="persona-hint"
                  >(you are currently {{ session.me()?.displayName }})</span
                >
              }
              @if (
                step.key === 'open-spec' || step.key === 'history' || step.key === 'create-rfi'
              ) {
                <a [routerLink]="['/app/documents']" [queryParams]="{ search: 'MCC-M-23 05 00' }"
                  >Open register</a
                >
              } @else if (step.key === 'audit') {
                <a routerLink="/app/audit">Open audit trail</a>
              } @else if (tour.rfiId()) {
                <a [routerLink]="['/app/rfis', tour.rfiId()]">Open your RFI</a>
              }
            </p>
          } @else {
            <p class="now">
              <strong>Done!</strong> You followed an RFI from page citation to approval and checked
              its audit trail.
              <button mat-button (click)="tour.restart()">Start again</button>
            </p>
          }
          <ol class="steps">
            @for (s of tour.steps; track s.key) {
              <li
                [class.done]="tour.done().includes(s.key)"
                [class.current]="tour.current()?.key === s.key"
              >
                {{ s.title }}
              </li>
            }
          </ol>
        </section>
      }
    }
  `,
  styles: `
    .tour {
      max-width: 1280px;
      margin: 16px auto 0;
      padding: 12px 16px;
      border: 1px solid #cfdcef;
      border-left: 5px solid var(--blueprint);
      border-radius: var(--radius-lg);
      background: #f7faff;
    }
    .tour.collapsed {
      border: 0;
      background: transparent;
      padding: 0 8px;
      text-align: right;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .bar {
      flex: 1;
      height: 6px;
      border-radius: 3px;
      background: #dbe6f6;
      overflow: hidden;
    }
    .bar span {
      display: block;
      height: 100%;
      background: var(--blueprint);
    }
    .now {
      margin: 6px 0;
    }
    .now a {
      margin-left: 6px;
      font-weight: 600;
    }
    .persona-hint {
      color: var(--muted);
    }
    .steps {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
      counter-reset: s;
    }
    .steps li {
      counter-increment: s;
      font-size: 0.78rem;
      padding: 2px 8px;
      border-radius: 999px;
      background: #e8eef7;
      color: var(--steel-3);
    }
    .steps li::before {
      content: counter(s) '. ';
    }
    .steps li.done {
      background: var(--success-soft);
      color: var(--success);
      text-decoration: line-through;
    }
    .steps li.current {
      background: var(--blueprint);
      color: #fff;
      font-weight: 600;
    }
    @media (max-width: 760px) {
      .tour {
        margin: 12px 12px 0;
      }
    }
  `,
})
export class WalkthroughBannerComponent {
  protected readonly tour = inject(WalkthroughService);
  protected readonly session = inject(SessionService);
  protected readonly total = this.tour.steps.length;
  protected readonly needsPersona = computed(() => {
    const step = this.tour.current();
    return !!step && step.persona !== this.session.me()?.persona;
  });
}
