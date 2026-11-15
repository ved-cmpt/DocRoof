import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { problemMessage } from '../../core/http';
import { SessionService } from '../../core/session.service';
import { IconComponent, LogoComponent } from '../../shared/ui';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule, RouterLink, LogoComponent, IconComponent],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <div class="split">
      <main id="main" tabindex="-1" class="form-side">
        <a routerLink="/" class="home" aria-label="DocRoof home">
          <app-logo [size]="28" [wordmark]="true" />
        </a>
        <section class="card auth" aria-labelledby="login-title">
          <h1 id="login-title">Sign in</h1>
          <p class="sub">Use a sample account, or skip this and open the demo.</p>
          @if (expired) {
            <div class="alert tone-info" role="status">
              <app-icon name="info" [size]="16" />
              <p>Your session ended. Sign in again or start a fresh demo.</p>
            </div>
          }
          <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="form-grid">
            <div class="field">
              <label class="field-label" for="login-email">Email</label>
              <input
                id="login-email"
                class="input"
                type="email"
                formControlName="email"
                autocomplete="username"
              />
              @if (invalid('email')) {
                <p class="field-error">
                  {{
                    form.controls.email.hasError('email')
                      ? 'Enter a valid email address.'
                      : 'Email is required.'
                  }}
                </p>
              }
            </div>
            <div class="field">
              <label class="field-label" for="login-password">Password</label>
              <input
                id="login-password"
                class="input"
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
              @if (invalid('password')) {
                <p class="field-error">Password is required.</p>
              }
            </div>
            @if (error()) {
              <div class="alert tone-danger" role="alert">
                <app-icon name="triangle-alert" [size]="16" />
                <p>{{ error() }}</p>
              </div>
            }
            <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">
              {{ busy() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>
          <div class="or" aria-hidden="true"><span>or</span></div>
          <a routerLink="/demo" class="btn btn-secondary btn-lg btn-block">
            Try the demo instead — no sign-up
          </a>
          <details class="dev">
            <summary>Developer sample accounts</summary>
            <p>
              Local development seeds accounts such as
              <code>controller.sample&#64;docroof.test</code>. Their intentionally public password
              is documented in SECURITY.md. Hosted visitors should use the guest demo.
            </p>
          </details>
        </section>
      </main>
      <aside class="brand-side" aria-hidden="true">
        <div class="brand-inner">
          <app-logo [size]="56" />
          <p><span>Every revision.</span> <span>Every answer.</span> <span>On record.</span></p>
        </div>
      </aside>
    </div>
  `,
  styles: `
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      min-height: 100dvh;
    }
    .form-side {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 24px;
      padding: 32px 24px;
      outline: none;
    }
    .home {
      border-radius: var(--r-sm);
    }
    .home:hover {
      text-decoration: none;
    }
    .auth {
      width: min(400px, 100%);
      padding: 28px;
    }
    h1 {
      font-size: var(--fs-24);
      margin-bottom: 4px;
    }
    .sub {
      color: var(--text-2);
      margin-bottom: 20px;
    }
    .alert {
      margin-bottom: 16px;
    }
    .or {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 20px 0;
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    .or::before,
    .or::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--border);
    }
    .dev {
      margin-top: 20px;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .dev summary {
      cursor: pointer;
      border-radius: var(--r-sm);
      width: fit-content;
    }
    .dev p {
      margin: 8px 0 0;
    }
    .brand-side {
      position: relative;
      overflow: hidden;
      background: var(--brand-tint);
      border-left: 1px solid var(--border);
    }
    .brand-side::after {
      content: '';
      position: absolute;
      right: -120px;
      bottom: -120px;
      width: 420px;
      height: 420px;
      border-radius: 40px;
      transform: rotate(45deg);
      border: 1px solid color-mix(in srgb, var(--brand) 18%, transparent);
    }
    .brand-inner {
      position: relative;
      z-index: 1;
      height: 100%;
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 64px;
      gap: 20px;
    }
    .brand-inner p span {
      display: block;
    }
    .brand-inner p {
      margin: 0;
      font-family: var(--font-display);
      font-size: var(--fs-32);
      font-weight: 700;
      line-height: 1.15;
      letter-spacing: -0.02em;
      color: var(--brand-hover);
    }
    @media (max-width: 860px) {
      .split {
        grid-template-columns: minmax(0, 1fr);
      }
      .brand-side {
        display: none;
      }
      .auth {
        padding: 20px;
      }
    }
  `,
})
export class LoginPage {
  private readonly fb = inject(FormBuilder);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly expired = this.route.snapshot.queryParamMap.has('expired');
  protected readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    const c = this.form.controls[name];
    return c.invalid && c.touched;
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const { email, password } = this.form.getRawValue();
      await this.session.login(email, password);
      const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
      await this.router.navigateByUrl(returnUrl?.startsWith('/app') ? returnUrl : '/app/documents');
    } catch (e) {
      this.error.set(problemMessage(e, 'Sign-in failed.'));
    } finally {
      this.busy.set(false);
    }
  }
}
