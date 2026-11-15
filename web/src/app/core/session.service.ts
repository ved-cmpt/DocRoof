import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { Me, MeProject } from './api.models';

const PROJECT_KEY = 'docroof.project';

function readStoredProject(): string | null {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
}

/**
 * Client-side session state. It only drives navigation and UI affordances; every API call is still authorized by
 * the server from the auth cookie.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly me = signal<Me | null>(null);
  readonly loaded = signal(false);
  readonly projectId = signal<string | null>(readStoredProject());
  /** Incremented whenever the signed-in identity changes, so pages can reload their data. */
  readonly version = signal(0);

  readonly isAuthenticated = computed(() => this.me() !== null);
  readonly isGuest = computed(() => this.me()?.isGuest ?? false);
  readonly projects = computed(() => this.me()?.projects ?? []);
  readonly project = computed<MeProject | null>(() => {
    const projects = this.projects();
    return projects.find((p) => p.id === this.projectId()) ?? projects[0] ?? null;
  });
  readonly role = computed(() => this.project()?.role ?? null);

  async refresh(): Promise<Me | null> {
    try {
      await firstValueFrom(this.api.antiforgery());
      const me = await firstValueFrom(this.api.me());
      this.me.set(me);
    } catch {
      this.me.set(null);
    } finally {
      this.loaded.set(true);
    }
    return this.me();
  }

  async ensureLoaded(): Promise<Me | null> {
    return this.loaded() ? this.me() : this.refresh();
  }

  selectProject(id: string): void {
    this.projectId.set(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      /* storage unavailable: selection lasts for this page view only */
    }
  }

  async login(email: string, password: string): Promise<void> {
    await firstValueFrom(this.api.antiforgery());
    await firstValueFrom(this.api.login(email, password));
    await this.afterIdentityChange();
  }

  async startDemo(): Promise<void> {
    await firstValueFrom(this.api.antiforgery());
    await firstValueFrom(this.api.startDemo());
    await this.afterIdentityChange();
  }

  async switchPersona(key: string): Promise<void> {
    await firstValueFrom(this.api.switchPersona(key));
    await this.afterIdentityChange();
  }

  async resetDemo(): Promise<void> {
    await firstValueFrom(this.api.resetDemo());
    await this.afterIdentityChange();
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.logout());
    } finally {
      this.me.set(null);
      await firstValueFrom(this.api.antiforgery()).catch(() => undefined);
      await this.router.navigateByUrl('/');
    }
  }

  private async afterIdentityChange(): Promise<void> {
    // Antiforgery tokens are bound to the identity, so a fresh one is required after sign-in or persona switch.
    await this.refresh();
    const projects = this.projects();
    if (!projects.some((p) => p.id === this.projectId()) && projects.length > 0) {
      this.selectProject(projects[0].id);
    }
    this.version.update((v) => v + 1);
  }
}
