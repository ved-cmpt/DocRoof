import { A11yModule } from '@angular/cdk/a11y';
import { BreakpointObserver } from '@angular/cdk/layout';
import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ApiService } from '../core/api.service';
import { label } from '../core/labels';
import { SessionService } from '../core/session.service';
import { ToastService } from '../core/toast.service';
import { WalkthroughService } from '../core/walkthrough.service';
import { IconName } from '../shared/icons.generated';
import { AvatarComponent, IconComponent, LogoComponent, RelativeTimePipe } from '../shared/ui';
import { NotificationCenter, ShellState, WorkspaceActions } from './shell.state';
import { TourComponent } from './tour.component';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

@Component({
  selector: 'app-shell',
  imports: [
    A11yModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatMenuModule,
    MatTooltipModule,
    LogoComponent,
    IconComponent,
    AvatarComponent,
    RelativeTimePipe,
    TourComponent,
  ],
  host: { '(document:keydown.escape)': 'onEscape()' },
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly session = inject(SessionService);
  protected readonly shell = inject(ShellState);
  protected readonly actions = inject(WorkspaceActions);
  protected readonly notifications = inject(NotificationCenter);
  protected readonly tour = inject(WalkthroughService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly label = label;

  protected readonly nav: NavItem[] = [
    { path: '/app/documents', label: 'Documents', icon: 'file-text' },
    { path: '/app/rfis', label: 'RFIs', icon: 'message-square-text' },
    { path: '/app/submittals', label: 'Submittals', icon: 'clipboard-check' },
    { path: '/app/review-queue', label: 'Review queue', icon: 'inbox' },
    { path: '/app/insights', label: 'Insights', icon: 'chart-column' },
    { path: '/app/audit', label: 'Audit', icon: 'scroll-text' },
  ];

  /** Below 900 px the sidebar becomes an off-canvas drawer. */
  protected readonly mobile = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 900px)')
      .pipe(map((s) => s.matches)),
    { initialValue: false },
  );
  protected readonly collapsed = computed(() => this.shell.collapsed() && !this.mobile());
  protected readonly queueCount = signal(0);
  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  constructor() {
    this.notifications.start();
    inject(DestroyRef).onDestroy(() => this.notifications.stop());

    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.shell.closeDrawer();
      this.refreshQueue();
    });

    // Move focus into the drawer when it opens on small screens.
    effect(() => {
      if (this.mobile() && this.shell.drawerOpen()) {
        setTimeout(() => this.closeBtn()?.nativeElement.focus(), 0);
      }
    });

    // Review-queue badge: items waiting on the signed-in person.
    effect(() => {
      this.session.project();
      this.session.version();
      untracked(() => this.refreshQueue());
    });

    // One-time welcome toast per guest workspace; the tour itself stays hidden until asked for.
    effect(() => {
      if (this.session.isGuest() && this.session.me() && !this.tour.welcomed()) {
        untracked(() => {
          this.tour.markWelcomed();
          setTimeout(() => {
            this.toast
              .offer('Welcome to your private demo workspace.', 'Take the tour')
              .subscribe(() => this.tour.start());
          }, 600);
        });
      }
    });
  }

  private refreshQueue(): void {
    const id = this.session.project()?.id;
    if (!id) {
      return;
    }
    this.api.reviewQueue(id, 'me').subscribe({
      next: (q) => this.queueCount.set(q.length),
      error: () => this.queueCount.set(0),
    });
  }

  protected onEscape(): void {
    if (this.shell.drawerOpen()) {
      this.shell.closeDrawer();
    }
  }

  protected onProject(id: string): void {
    this.session.selectProject(id);
    void this.router.navigateByUrl('/app/documents');
  }

  protected logout(): void {
    void this.session.logout();
  }

  protected roleLabel(): string {
    const role = this.session.role();
    return role ? label(role) : (this.session.me()?.jobTitle ?? '');
  }
}
