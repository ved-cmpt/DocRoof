import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GITHUB_URL } from './site';

/** DocRoof mark: a roof chevron over a document with a revision tab. */
@Component({
  selector: 'app-logo',
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="32" height="32" rx="7" fill="#1b2a3d" />
      <path
        d="M5 14 16 6l11 8"
        fill="none"
        stroke="#f5a524"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M10 14.5h12v11.5H10z" fill="#ffffff" />
      <path
        d="M12.5 18h7M12.5 21h7M12.5 24h4"
        stroke="#1b2a3d"
        stroke-width="1.4"
        stroke-linecap="round"
      />
    </svg>
  `,
  styles: ':host { display: inline-flex; }',
})
export class LogoComponent {
  readonly size = input(28);
}

@Component({
  selector: 'app-public-header',
  imports: [RouterLink, LogoComponent],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="public-header">
      <div class="inner">
        <a routerLink="/" class="brand" aria-label="DocRoof home">
          <app-logo [size]="30" />
          <span>DocRoof</span>
        </a>
        <nav aria-label="Primary">
          <a routerLink="/" fragment="workflows">Workflows</a>
          <a routerLink="/case-study">Case study</a>
          <a routerLink="/login">Sign in</a>
          <a routerLink="/demo" class="cta">Try the demo</a>
        </nav>
      </div>
    </header>
  `,
  styles: `
    .public-header {
      background: var(--ink);
      color: #fff;
      border-bottom: 4px solid transparent;
      border-image: var(--hazard) 4;
    }
    .inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      color: #fff;
      text-decoration: none;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.35rem;
      letter-spacing: 0.01em;
    }
    nav {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    nav a {
      color: #dbe3ec;
      text-decoration: none;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 500;
    }
    nav a:hover {
      color: #fff;
      background: rgb(255 255 255 / 8%);
    }
    nav a.cta {
      background: var(--amber);
      color: var(--ink);
      font-weight: 700;
    }
    nav a.cta:hover {
      background: #ffb93d;
    }
    @media (max-width: 560px) {
      nav a:not(.cta) {
        padding: 6px 8px;
        font-size: 0.9rem;
      }
    }
  `,
})
export class PublicHeaderComponent {}

@Component({
  selector: 'app-public-footer',
  imports: [RouterLink, LogoComponent],
  template: `
    <footer class="public-footer">
      <div class="inner">
        <div class="col brand-col">
          <div class="brand"><app-logo [size]="26" /> <span>DocRoof</span></div>
          <p>Every document, decision, and revision stays traceable.</p>
          <p class="disclaimer">
            Independent portfolio project. Not affiliated with, endorsed by, or a recreation of any
            company's systems. All people, projects and documents are fictitious.
          </p>
        </div>
        <nav class="col" aria-label="Footer">
          <h2>Explore</h2>
          <a routerLink="/demo">Try the demo</a>
          <a routerLink="/case-study">Case study</a>
          <a routerLink="/login">Sign in</a>
          <a [href]="githubUrl" rel="noopener" target="_blank">Source on GitHub</a>
        </nav>
        <div class="col">
          <h2>Built with</h2>
          <p>
            Angular · TypeScript · ASP.NET Core (.NET 10) · EF Core · SQL Server 2022 · Playwright ·
            xUnit
          </p>
          <p class="small">
            MIT licensed source. Synthetic sample PDFs generated with PdfPig (Apache-2.0).
          </p>
        </div>
      </div>
    </footer>
  `,
  styles: `
    .public-footer {
      background: var(--ink);
      color: #c6d0db;
      margin-top: 64px;
    }
    .inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 40px 24px;
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr;
      gap: 32px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #fff;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 1.2rem;
      margin-bottom: 8px;
    }
    h2 {
      color: #fff;
      font-size: 0.85rem;
      letter-spacing: 0.1em;
      text-transform: uppercase;
    }
    nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    a {
      color: #e7edf4;
    }
    .disclaimer {
      font-size: 0.85rem;
      color: #aab6c3;
      border-left: 3px solid var(--amber);
      padding-left: 10px;
    }
    @media (max-width: 800px) {
      .inner {
        grid-template-columns: 1fr;
      }
    }
  `,
})
export class PublicFooterComponent {
  protected readonly githubUrl = GITHUB_URL;
}
