import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, inject, isDevMode, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { problemMessage } from '../../core/http';
import { SessionService } from '../../core/session.service';
import { IconComponent, LogoComponent } from '../../shared/ui';

const STEPS = [
  'Creating your private workspace…',
  'Copying fictional projects and documents…',
  'Signing you in…',
];

/** True when the API could not be reached at all (stopped API, dev proxy error, network). */
export function isUnreachable(e: unknown): boolean {
  if (!(e instanceof HttpErrorResponse)) {
    return false;
  }
  if (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504) {
    return true;
  }
  // The dev-server proxy answers 500 with plain text when the API is down.
  return e.status === 500 && typeof e.error === 'string';
}

/** One click → isolated guest workspace. Starts automatically; the button is the retry path. */
@Component({
  selector: 'app-demo-page',
  imports: [RouterLink, LogoComponent, IconComponent],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <main id="main" tabindex="-1" class="wrap">
      <a routerLink="/" class="home" aria-label="DocRoof home">
        <app-logo [size]="32" [wordmark]="true" />
      </a>
      <section class="card panel" aria-labelledby="demo-title" aria-live="polite">
        @if (error()) {
          <span class="err-icon"
            ><app-icon [name]="unreachable() ? 'server-off' : 'triangle-alert'" [size]="22"
          /></span>
          <h1 id="demo-title">
            {{ unreachable() ? 'The demo server is not responding' : 'The demo could not start' }}
          </h1>
          <p class="text">
            @if (unreachable()) {
              Your workspace is created by the DocRoof API, and it could not be reached. Try again
              in a moment.
            } @else {
              {{ error() }}
            }
          </p>
          @if (unreachable() && dev) {
            <div class="hint">
              <span class="hint-label">Running locally? Start the API, then retry:</span>
              <code>dotnet run --project api/src/DocRoof.Api --launch-profile http</code>
            </div>
          }
          <div class="actions">
            <button type="button" class="btn btn-primary" (click)="start()">
              <app-icon name="refresh-cw" [size]="16" /> Try again
            </button>
            <a class="btn btn-secondary" routerLink="/">Back to home</a>
          </div>
        } @else {
          <h1 id="demo-title">Setting up your demo</h1>
          <p class="text">A private workspace with fictional data, deleted after 24 hours.</p>
          <div
            class="progress"
            role="progressbar"
            aria-label="Creating workspace"
            aria-valuemin="0"
            aria-valuemax="3"
            [attr.aria-valuenow]="step()"
          >
            <span [style.width.%]="((step() + 1) / steps.length) * 100"></span>
          </div>
          <ol class="steps">
            @for (s of steps; track s; let i = $index) {
              <li [class.done]="i < step()" [class.now]="i === step()">
                <span class="mark" aria-hidden="true">
                  @if (i < step()) {
                    <app-icon name="check" [size]="14" [stroke]="2" />
                  }
                </span>
                {{ s }}
                @if (i < step()) {
                  <span class="visually-hidden">(done)</span>
                }
              </li>
            }
          </ol>
        }
      </section>
      <p class="foot">No sign-up · isolated tenant · five personas to switch between</p>
    </main>
  `,
  styles: `
    .wrap {
      min-height: 100dvh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      padding: 32px 16px;
      outline: none;
    }
    .home {
      border-radius: var(--r-sm);
    }
    .home:hover {
      text-decoration: none;
    }
    .panel {
      width: min(460px, 100%);
      padding: 28px;
    }
    h1 {
      font-size: var(--fs-20);
      margin-bottom: 6px;
    }
    .text {
      color: var(--text-2);
      margin-bottom: 20px;
    }
    .progress {
      height: 4px;
      border-radius: 2px;
      background: var(--surface-subtle);
      overflow: hidden;
      margin-bottom: 20px;
    }
    .progress span {
      display: block;
      height: 100%;
      background: var(--brand);
      border-radius: 2px;
      transition: width 0.6s ease;
    }
    .steps {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .steps li {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--text-2);
    }
    .steps li.now {
      color: var(--text);
      font-weight: 500;
    }
    .steps li.done {
      color: var(--text);
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: var(--r-full);
      border: 1.5px solid var(--border-strong);
      flex: none;
    }
    li.now .mark {
      border-color: var(--brand);
      border-top-color: transparent;
      animation: spin 0.9s linear infinite;
    }
    li.done .mark {
      border-color: var(--brand);
      background: var(--brand);
      color: var(--on-brand);
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    .err-icon {
      display: inline-grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: var(--r-md);
      background: var(--surface-subtle);
      color: var(--text-2);
      margin-bottom: 14px;
    }
    .hint {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      border-radius: var(--r-sm);
      background: var(--surface-subtle);
      margin-bottom: 20px;
    }
    .hint-label {
      font-size: var(--fs-13);
      color: var(--text-2);
    }
    .hint code {
      font-size: var(--fs-12);
      overflow-wrap: anywhere;
    }
    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    .foot {
      margin: 0;
      color: var(--text-2);
      font-size: var(--fs-13);
      text-align: center;
    }
  `,
})
export class DemoPage implements OnInit {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly steps = STEPS;
  protected readonly dev = isDevMode();
  protected readonly step = signal(0);
  protected readonly error = signal('');
  protected readonly unreachable = signal(false);
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimers());
  }

  ngOnInit(): void {
    void this.start();
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }

  protected async start(): Promise<void> {
    this.clearTimers();
    this.error.set('');
    this.unreachable.set(false);
    this.step.set(0);
    // The single API call does all three steps; the timeline only paces the display.
    this.timers.push(setTimeout(() => this.step.set(Math.max(this.step(), 1)), 700));
    try {
      await this.session.startDemo();
      this.clearTimers();
      this.step.set(2);
      await this.router.navigateByUrl('/app/documents');
    } catch (e) {
      this.clearTimers();
      this.unreachable.set(isUnreachable(e));
      this.error.set(problemMessage(e, 'The demo could not be started.'));
    }
  }
}
