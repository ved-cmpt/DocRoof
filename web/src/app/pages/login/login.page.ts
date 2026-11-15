import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { problemMessage } from '../../core/http';
import { SessionService } from '../../core/session.service';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';

@Component({
  selector: 'app-login-page',
  imports: [
    ReactiveFormsModule,
    MatInputModule,
    MatButtonModule,
    RouterLink,
    PublicHeaderComponent,
    PublicFooterComponent,
  ],
  template: `
    <app-public-header />
    <main id="main" class="auth-wrap">
      <section class="panel auth-card" aria-labelledby="login-title">
        <p class="eyebrow">Sample workspace</p>
        <h1 id="login-title">Sign in</h1>
        @if (expired) {
          <p class="notice info" role="status">
            Your session ended. Sign in again or start a fresh demo.
          </p>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput type="email" formControlName="email" autocomplete="username" required />
            @if (form.controls.email.hasError('email')) {
              <mat-error>Enter a valid email address.</mat-error>
            } @else if (form.controls.email.hasError('required')) {
              <mat-error>Email is required.</mat-error>
            }
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>Password</mat-label>
            <input
              matInput
              type="password"
              formControlName="password"
              autocomplete="current-password"
              required
            />
            @if (form.controls.password.hasError('required')) {
              <mat-error>Password is required.</mat-error>
            }
          </mat-form-field>
          @if (error()) {
            <div class="error-box" role="alert">{{ error() }}</div>
          }
          <button mat-flat-button type="submit" [disabled]="busy()">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>
        <p class="hint small muted">
          Local development seeds sample accounts such as
          <code>controller.sample&#64;docroof.test</code> with the intentionally public password
          documented in SECURITY.md. Hosted visitors should use the
          <a routerLink="/demo">one-click guest demo</a> instead — no sign-up needed.
        </p>
      </section>
    </main>
    <app-public-footer />
  `,
  styles: `
    .auth-wrap {
      display: grid;
      place-items: center;
      padding: 56px 16px 0;
    }
    .auth-card {
      width: min(440px, 100%);
      padding: 28px;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 12px;
    }
    .error-box {
      margin-bottom: 12px;
    }
    .hint {
      margin-top: 18px;
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
