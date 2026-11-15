import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { NotificationItem, Persona } from '../core/api.models';
import { problemMessage } from '../core/http';
import { SessionService } from '../core/session.service';
import { ToastService } from '../core/toast.service';
import { WalkthroughService } from '../core/walkthrough.service';

const COLLAPSE_KEY = 'docroof.sidebar.collapsed';

function readFlag(key: string, storage: () => Storage): boolean {
  try {
    return storage().getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean, storage: () => Storage): void {
  try {
    storage().setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable: preference lasts for this page view */
  }
}

/** Sidebar collapse (desktop), drawer (mobile) and the dismissible demo pill. */
@Injectable({ providedIn: 'root' })
export class ShellState {
  readonly collapsed = signal(readFlag(COLLAPSE_KEY, () => localStorage));
  readonly drawerOpen = signal(false);
  readonly demoPillDismissed = signal(readFlag('docroof.demo-pill', () => sessionStorage));

  toggleCollapsed(): void {
    this.collapsed.update((c) => !c);
    writeFlag(COLLAPSE_KEY, this.collapsed(), () => localStorage);
  }

  openDrawer(): void {
    this.drawerOpen.set(true);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  dismissDemoPill(): void {
    this.demoPillDismissed.set(true);
    writeFlag('docroof.demo-pill', true, () => sessionStorage);
  }
}

/** Notification feed shared by the top-bar bell and the profile menu. */
@Injectable({ providedIn: 'root' })
export class NotificationCenter {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly session = inject(SessionService);
  readonly items = signal<NotificationItem[]>([]);
  readonly unread = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      this.session.version();
      if (this.session.isAuthenticated()) {
        this.refresh();
      }
    });
  }

  /** Polls once a minute while a workspace is open. */
  start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => this.refresh(), 60_000);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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

  markAll(): void {
    this.api.markAllNotificationsRead().subscribe(() => this.refresh());
  }

  open(n: NotificationItem): void {
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

/** Guest-workspace actions used from the profile menu and the demo pill. */
@Injectable({ providedIn: 'root' })
export class WorkspaceActions {
  private readonly api = inject(ApiService);
  private readonly session = inject(SessionService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly tour = inject(WalkthroughService);

  readonly personas = signal<Persona[]>([]);
  readonly busy = signal(false);
  readonly activePersona = computed(() => this.personas().find((p) => p.isActive) ?? null);
  readonly expiresIn = computed(() => {
    const exp = this.session.me()?.guestExpiresAt;
    if (!exp) {
      return '';
    }
    const hours = Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 3_600_000));
    return hours >= 1 ? `${hours} h` : '< 1 h';
  });

  constructor() {
    effect(() => {
      this.session.version();
      if (this.session.isGuest()) {
        this.api.personas().subscribe((p) => this.personas.set(p));
      } else {
        this.personas.set([]);
      }
    });
  }

  async switchPersona(p: Persona): Promise<void> {
    if (p.isActive || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.session.switchPersona(p.key);
      this.toast.success(`You are now ${p.displayName} (${p.jobTitle}).`);
    } catch (e) {
      this.toast.error(problemMessage(e, 'Could not switch persona.'));
    } finally {
      this.busy.set(false);
    }
  }

  async resetDemo(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.session.resetDemo();
      this.tour.reset();
      this.toast.success('Your demo workspace was rebuilt from the template.');
      await this.router.navigateByUrl('/app/documents');
    } catch (e) {
      this.toast.error(problemMessage(e, 'Reset failed.'));
    } finally {
      this.busy.set(false);
    }
  }
}
