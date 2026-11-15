import { Component, ElementRef, HostListener, inject, input, viewChild } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { SessionService } from '../core/session.service';
import { IconComponent, RelativeTimePipe } from '../shared/ui';
import { NotificationCenter, ShellState, WorkspaceActions } from './shell.state';

export interface Crumb {
  label: string;
  link: string | unknown[];
}

@Component({
  selector: 'app-notification-bell',
  imports: [MatMenuModule, IconComponent, RelativeTimePipe],
  template: `
    <button
      type="button"
      class="btn btn-icon bell"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="'Notifications, ' + center.unread() + ' unread'"
      (menuOpened)="center.refresh()"
    >
      <app-icon name="bell" />
      @if (center.unread() > 0) {
        <span class="badge" aria-hidden="true">{{
          center.unread() > 99 ? '99+' : center.unread()
        }}</span>
      }
    </button>
    <mat-menu #menu="matMenu" xPosition="before" class="dr-menu notif-menu">
      <div class="head" role="presentation">
        <strong>Notifications</strong>
        @if (center.unread() > 0) {
          <button type="button" class="link-btn small" (click)="markAll($event)">
            Mark all read
          </button>
        }
      </div>
      @if (center.items().length === 0) {
        <p class="none">You're all caught up.</p>
      }
      @for (n of center.items().slice(0, 8); track n.id) {
        <button mat-menu-item class="item" [class.unread]="!n.isRead" (click)="center.open(n)">
          <span class="dot" aria-hidden="true"></span>
          <span class="text">
            <span class="msg">{{ n.message }}</span>
            <span class="when">{{ n.createdAt | relTime }}</span>
          </span>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    .bell {
      position: relative;
    }
    .badge {
      position: absolute;
      top: 2px;
      right: 1px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: var(--r-sm);
      background: var(--brand);
      color: var(--on-brand);
      font-size: 10px;
      font-weight: 600;
      line-height: 16px;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 320px;
      padding: 8px 10px;
    }
    .none {
      margin: 0;
      padding: 8px 10px 12px;
      color: var(--text-2);
    }
    .item {
      height: auto !important;
      min-height: 52px !important;
      padding-top: 8px !important;
      padding-bottom: 8px !important;
      align-items: flex-start !important;
      white-space: normal;
      max-width: 360px;
    }
    .dot {
      flex: none;
      width: 6px;
      height: 6px;
      margin-top: 7px;
      border-radius: var(--r-full);
      background: transparent;
    }
    .item.unread .dot {
      background: var(--brand);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      line-height: 1.35;
    }
    .msg {
      font-size: var(--fs-13);
    }
    .when {
      font-size: var(--fs-12);
      color: var(--text-2);
    }
  `,
})
export class NotificationBellComponent {
  protected readonly center = inject(NotificationCenter);

  protected markAll(event: Event): void {
    event.stopPropagation();
    this.center.markAll();
  }
}

/** Slim top bar inside the content area: breadcrumb + page title left; demo pill, search, page action, bell right. */
@Component({
  selector: 'app-topbar',
  imports: [RouterLink, IconComponent, NotificationBellComponent],
  template: `
    <header class="topbar">
      <button
        type="button"
        class="btn btn-icon menu-btn"
        (click)="shell.openDrawer()"
        aria-label="Open navigation"
      >
        <app-icon name="menu" />
      </button>
      <div class="title-area">
        @if (crumbs().length > 0) {
          <nav aria-label="Breadcrumb" class="crumbs">
            <ol>
              @for (c of crumbs(); track c.label) {
                <li>
                  <a [routerLink]="c.link">{{ c.label }}</a>
                  <app-icon name="chevron-right" [size]="14" />
                </li>
              }
            </ol>
          </nav>
        }
        <h1 class="title" [class.mono-title]="monoTitle()">{{ title() }}</h1>
      </div>
      <div class="right">
        @if (session.isGuest() && !shell.demoPillDismissed()) {
          <div class="demo-pill" role="status">
            <span class="pill-dot" aria-hidden="true"></span>
            <span class="pill-text"
              >Demo workspace<span class="pill-extra"> · resets in {{ actions.expiresIn() }}</span></span
            >
            <button
              type="button"
              class="pill-btn"
              (click)="actions.resetDemo()"
              [disabled]="actions.busy()"
              aria-label="Reset my demo"
            >
              Reset
            </button>
            <button
              type="button"
              class="pill-x"
              (click)="shell.dismissDemoPill()"
              aria-label="Dismiss demo notice"
            >
              <app-icon name="x" [size]="14" />
            </button>
          </div>
        }
        <form class="search-box global-search" role="search" (submit)="search($event)">
          <app-icon name="search" [size]="16" />
          <input
            #searchInput
            class="input input-sm"
            type="search"
            name="q"
            placeholder="Search documents"
            aria-label="Search documents"
            autocomplete="off"
          />
          <kbd aria-hidden="true">/</kbd>
        </form>
        <ng-content />
        <app-notification-bell />
      </div>
    </header>
  `,
  styleUrl: './topbar.component.scss',
})
export class TopbarComponent {
  protected readonly session = inject(SessionService);
  protected readonly shell = inject(ShellState);
  protected readonly actions = inject(WorkspaceActions);
  private readonly router = inject(Router);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  readonly title = input.required<string>();
  readonly crumbs = input<Crumb[]>([]);
  /** Render the title in the monospace face (document numbers, references). */
  readonly monoTitle = input(false);

  @HostListener('document:keydown', ['$event'])
  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      !!target &&
      (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey) {
      const el = this.searchInput()?.nativeElement;
      if (el && el.offsetParent !== null) {
        event.preventDefault();
        el.focus();
      }
    }
  }

  protected search(event: Event): void {
    event.preventDefault();
    const el = this.searchInput()?.nativeElement;
    const q = el?.value.trim() ?? '';
    void this.router.navigate(['/app/documents'], { queryParams: { search: q || null } });
    el?.blur();
  }
}
