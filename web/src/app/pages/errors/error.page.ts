import { Component, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TopbarComponent } from '../../layout/topbar.component';
import { PublicFooterComponent, PublicHeaderComponent } from '../../shared/brand';
import { IconName } from '../../shared/icons.generated';
import { EmptyStateComponent } from '../../shared/ui';

/** Error state rendered inside the workspace shell (/app/...) or on the public site. */
@Component({
  selector: 'app-error-view',
  imports: [RouterLink, TopbarComponent, PublicHeaderComponent, PublicFooterComponent, EmptyStateComponent],
  template: `
    @if (inApp) {
      <app-topbar [title]="title()" />
      <div class="page">
        <section class="card" [attr.aria-label]="title()">
          <app-empty [icon]="icon()" [heading]="title()" [text]="text()">
            <a class="btn btn-secondary" routerLink="/app/documents">Go to documents</a>
          </app-empty>
        </section>
      </div>
    } @else {
      <app-public-header />
      <main id="main" tabindex="-1" class="public-error">
        <p class="code">Error {{ code() }}</p>
        <h1>{{ title() }}</h1>
        <p class="text">{{ text() }}</p>
        <div class="actions">
          <a class="btn btn-primary" routerLink="/">Back to home</a>
          <a class="btn btn-secondary" routerLink="/demo">Try the demo</a>
        </div>
      </main>
      <app-public-footer />
    }
  `,
  styles: `
    .public-error {
      max-width: 560px;
      margin: 0 auto;
      padding: 96px 24px;
      text-align: center;
      outline: none;
    }
    .code {
      color: var(--text-2);
      font-size: var(--fs-13);
      margin-bottom: 8px;
    }
    h1 {
      font-size: var(--fs-32);
      margin-bottom: 12px;
    }
    .text {
      color: var(--text-2);
      font-size: var(--fs-16);
    }
    .actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-top: 24px;
    }
  `,
})
export class ErrorViewComponent {
  protected readonly inApp = inject(Router).url.startsWith('/app');
  readonly code = input.required<number>();
  readonly title = input.required<string>();
  readonly text = input.required<string>();
  readonly icon = input<IconName>('circle-question-mark');
}

@Component({
  selector: 'app-not-found-page',
  imports: [ErrorViewComponent],
  template: `<app-error-view
    [code]="404"
    title="Not found"
    icon="circle-question-mark"
    text="This page or record does not exist, or it belongs to a project you are not a member of."
  />`,
})
export class NotFoundPage {}

@Component({
  selector: 'app-forbidden-page',
  imports: [ErrorViewComponent],
  template: `<app-error-view
    [code]="403"
    title="Access denied"
    icon="lock"
    text="Your project role does not allow this. In the guest demo, switch persona from the profile menu."
  />`,
})
export class ForbiddenPage {}
