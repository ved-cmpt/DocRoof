import { Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Persona } from '../core/api.models';
import { problemMessage } from '../core/http';
import { label } from '../core/labels';
import { SessionService } from '../core/session.service';
import { ToastService } from '../core/toast.service';
import { LogoComponent } from '../shared/brand';
import { WalkthroughService } from '../core/walkthrough.service';
import { NotificationBellComponent, WalkthroughBannerComponent } from './widgets';

interface NavItem {
  path: string;
  label: string;
}

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatMenuModule,
    MatSelectModule,
    LogoComponent,
    NotificationBellComponent,
    WalkthroughBannerComponent,
  ],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly session = inject(SessionService);
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly label = label;

  protected readonly tour = inject(WalkthroughService);

  protected readonly nav: NavItem[] = [
    { path: '/app/documents', label: 'Documents' },
    { path: '/app/rfis', label: 'RFIs' },
    { path: '/app/submittals', label: 'Submittals' },
    { path: '/app/insights', label: 'Insights' },
    { path: '/app/audit', label: 'Audit' },
  ];

  protected readonly personas = signal<Persona[]>([]);
  protected readonly busy = signal(false);
  protected readonly activePersona = computed(
    () => this.personas().find((p) => p.isActive) ?? null,
  );
  protected readonly expiresIn = computed(() => {
    const exp = this.session.me()?.guestExpiresAt;
    if (!exp) {
      return '';
    }
    const hours = Math.max(0, Math.round((new Date(exp).getTime() - Date.now()) / 3_600_000));
    return hours >= 1 ? `${hours} h` : 'less than an hour';
  });

  constructor() {
    effect(() => {
      this.session.version();
      if (this.session.isGuest()) {
        this.api.personas().subscribe((p) => this.personas.set(p));
      }
    });
  }

  protected onProject(id: string): void {
    this.session.selectProject(id);
    void this.router.navigateByUrl('/app/documents');
  }

  protected async switchPersona(p: Persona): Promise<void> {
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

  protected async resetDemo(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.session.resetDemo();
      this.tour.restart();
      this.toast.success('Your demo workspace was rebuilt from the template.');
      await this.router.navigateByUrl('/app/documents');
    } catch (e) {
      this.toast.error(problemMessage(e, 'Reset failed.'));
    } finally {
      this.busy.set(false);
    }
  }

  protected logout(): void {
    void this.session.logout();
  }
}
