import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-page',
  imports: [RouterLink, MatButtonModule],
  template: `
    <div class="page">
      <section class="panel state-box" aria-labelledby="nf-title">
        <p class="eyebrow">Error 404</p>
        <h1 id="nf-title">Not found</h1>
        <p>
          This page or record does not exist, or it belongs to a project you are not a member of.
        </p>
        <a mat-flat-button routerLink="/app/documents">Go to the document register</a>
      </section>
    </div>
  `,
})
export class NotFoundPage {}

@Component({
  selector: 'app-forbidden-page',
  imports: [RouterLink, MatButtonModule],
  template: `
    <div class="page">
      <section class="panel state-box" aria-labelledby="fb-title">
        <p class="eyebrow">Error 403</p>
        <h1 id="fb-title">Access denied</h1>
        <p>
          Your project role does not allow this action. In the guest demo you can switch persona
          from the top bar.
        </p>
        <a mat-flat-button routerLink="/app/documents">Back to documents</a>
      </section>
    </div>
  `,
})
export class ForbiddenPage {}
