import { Component, HostListener, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GITHUB_URL } from './site';
import { IconComponent, LogoComponent } from './ui';

export { LogoComponent } from './ui';

/** Marketing header: transparent over the hero, white with a hairline once the page scrolls. */
@Component({
  selector: 'app-public-header',
  imports: [RouterLink, LogoComponent, IconComponent],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="public-header" [class.scrolled]="scrolled() || menuOpen()">
      <div class="inner">
        <a routerLink="/" class="brand" aria-label="DocRoof home">
          <app-logo [size]="28" [wordmark]="true" />
        </a>
        <nav aria-label="Primary" class="links" [class.open]="menuOpen()" id="public-nav">
          <a routerLink="/" fragment="product" (click)="menuOpen.set(false)">Product</a>
          <a routerLink="/" fragment="how" (click)="menuOpen.set(false)">How it works</a>
          <a routerLink="/case-study" (click)="menuOpen.set(false)">Case study</a>
          <a [href]="githubUrl" rel="noopener" target="_blank"
            >GitHub <app-icon name="arrow-up-right" [size]="14"
          /></a>
          <a routerLink="/login" class="signin-mobile" (click)="menuOpen.set(false)">Sign in</a>
        </nav>
        <div class="cta">
          <a routerLink="/login" class="signin">Sign in</a>
          <a routerLink="/demo" class="btn btn-primary">Try the demo</a>
          <button
            type="button"
            class="btn btn-icon menu-toggle"
            (click)="menuOpen.set(!menuOpen())"
            [attr.aria-expanded]="menuOpen()"
            aria-controls="public-nav"
            aria-label="Menu"
          >
            <app-icon [name]="menuOpen() ? 'x' : 'menu'" />
          </button>
        </div>
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .public-header {
      border-bottom: 1px solid transparent;
      transition:
        background-color 0.2s ease,
        border-color 0.2s ease;
    }
    .public-header.scrolled {
      background: color-mix(in srgb, var(--surface) 94%, transparent);
      backdrop-filter: saturate(1.4) blur(10px);
      border-bottom-color: var(--border);
    }
    .inner {
      position: relative;
      max-width: var(--marketing-max);
      margin: 0 auto;
      padding: 0 24px;
      height: 64px;
      display: flex;
      align-items: center;
      gap: 24px;
    }
    .brand {
      display: inline-flex;
      border-radius: var(--r-sm);
    }
    .brand:hover {
      text-decoration: none;
    }
    .links {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-left: auto;
    }
    .links a,
    .signin {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 8px 10px;
      border-radius: var(--r-sm);
      color: var(--text-2);
      font-weight: 500;
    }
    .links a:hover,
    .signin:hover {
      color: var(--text);
      background: var(--hover);
      text-decoration: none;
    }
    .cta {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .links .signin-mobile,
    .menu-toggle {
      display: none;
    }
    @media (max-width: 860px) {
      .inner {
        padding: 0 16px;
        gap: 8px;
      }
      .cta {
        margin-left: auto;
      }
      .signin {
        display: none;
      }
      .menu-toggle,
      .links .signin-mobile {
        display: inline-flex;
      }
      .links {
        display: none;
        position: absolute;
        top: 64px;
        left: 0;
        right: 0;
        flex-direction: column;
        align-items: stretch;
        gap: 2px;
        padding: 8px 16px 16px;
        background: var(--surface);
        border-bottom: 1px solid var(--border);
        box-shadow: var(--shadow-pop);
      }
      .links.open {
        display: flex;
      }
      .links a {
        padding: 12px 10px;
      }
    }
  `,
})
export class PublicHeaderComponent {
  protected readonly githubUrl = GITHUB_URL;
  protected readonly scrolled = signal(false);
  protected readonly menuOpen = signal(false);

  @HostListener('window:scroll')
  protected onScroll(): void {
    this.scrolled.set(window.scrollY > 8);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.menuOpen.set(false);
  }
}

@Component({
  selector: 'app-public-footer',
  imports: [RouterLink, LogoComponent],
  template: `
    <footer class="public-footer">
      <div class="inner">
        <div class="brand-col">
          <app-logo [size]="24" [wordmark]="true" />
          <p>
            Independent portfolio project. Not affiliated with any company. All people, projects and
            documents are fictitious.
          </p>
        </div>
        <nav aria-label="Footer" class="links">
          <a routerLink="/demo">Try the demo</a>
          <a routerLink="/case-study">Case study</a>
          <a routerLink="/login">Sign in</a>
          <a [href]="githubUrl" rel="noopener" target="_blank">Source on GitHub</a>
        </nav>
        <p class="stack">
          Angular · ASP.NET Core (.NET 10) · SQL Server 2022 · MIT licence · sample PDFs generated
          with PdfPig
        </p>
      </div>
    </footer>
  `,
  styles: `
    .public-footer {
      border-top: 1px solid var(--border);
      background: var(--bg);
    }
    .inner {
      max-width: var(--marketing-max);
      margin: 0 auto;
      padding: 40px 24px;
      display: grid;
      grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr);
      gap: 24px 48px;
    }
    .brand-col p {
      margin: 12px 0 0;
      max-width: 46ch;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 24px;
      justify-content: flex-end;
      align-content: flex-start;
    }
    .links a {
      color: var(--text-2);
      font-weight: 500;
    }
    .links a:hover {
      color: var(--text);
    }
    .stack {
      grid-column: 1 / -1;
      margin: 0;
      padding-top: 20px;
      border-top: 1px solid var(--border);
      color: var(--text-2);
      font-size: var(--fs-12);
    }
    @media (max-width: 700px) {
      .inner {
        grid-template-columns: 1fr;
        padding: 32px 16px;
      }
      .links {
        justify-content: flex-start;
      }
    }
  `,
})
export class PublicFooterComponent {
  protected readonly githubUrl = GITHUB_URL;
}
