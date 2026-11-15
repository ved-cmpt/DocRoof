import { Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { problemMessage } from '../../core/http';
import { SessionService } from '../../core/session.service';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';

/** One click → isolated guest workspace. Starts automatically; the button is the retry path. */
@Component({
  selector: 'app-demo-page',
  imports: [MatButtonModule, RouterLink, PublicHeaderComponent, PublicFooterComponent],
  template: `
    <app-public-header />
    <main id="main" class="demo-wrap">
      <section class="panel demo-card" aria-labelledby="demo-title" aria-live="polite">
        <p class="eyebrow">Guest demo</p>
        <h1 id="demo-title">Your private DocRoof workspace</h1>
        @if (busy()) {
          <div class="progress" role="status">
            <span class="bar" aria-hidden="true"></span>
            <p>
              Building your workspace from the seed template: 2 fictional projects, 15 documents,
              RFIs and submittals…
            </p>
          </div>
        } @else if (error()) {
          <div class="error-box" role="alert">{{ error() }}</div>
          <div class="row actions">
            <button mat-flat-button (click)="start()">Try again</button>
            <a mat-button routerLink="/">Back to home</a>
          </div>
        } @else {
          <p>Opening your workspace…</p>
        }
        <ul class="facts">
          <li>No sign-up and no shared data: every visitor gets an isolated tenant.</li>
          <li>Switch between five fictional personas to see each role's permissions.</li>
          <li>The workspace and its files are deleted automatically after 24 hours.</li>
        </ul>
      </section>
    </main>
    <app-public-footer />
  `,
  styles: `
    .demo-wrap {
      display: grid;
      place-items: center;
      padding: 56px 16px 0;
    }
    .demo-card {
      width: min(560px, 100%);
      padding: 28px;
    }
    .progress .bar {
      display: block;
      height: 6px;
      border-radius: 3px;
      background: var(--hazard);
      background-size: 28px 28px;
      animation: slide 1s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes slide {
      to {
        background-position: 28px 0;
      }
    }
    .actions {
      margin-top: 12px;
    }
    .facts {
      margin: 20px 0 0;
      padding-left: 18px;
      color: var(--muted);
    }
  `,
})
export class DemoPage implements OnInit {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  ngOnInit(): void {
    void this.start();
  }

  protected async start(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.session.startDemo();
      await this.router.navigateByUrl('/app/documents?tour=1');
    } catch (e) {
      this.error.set(problemMessage(e, 'The demo could not be started.'));
    } finally {
      this.busy.set(false);
    }
  }
}
