import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SessionService } from '../core/session.service';
import { WalkthroughService } from '../core/walkthrough.service';
import { IconComponent } from '../shared/ui';

/** The optional guided tour as a compact stepper popover (bottom right). */
@Component({
  selector: 'app-tour',
  imports: [RouterLink, IconComponent],
  template: `
    @if (tour.open()) {
      @if (tour.minimized()) {
        <button
          type="button"
          class="tour-pill"
          (click)="tour.setMinimized(false)"
          [attr.aria-label]="'Show guided tour, ' + tour.progress() + ' of ' + total + ' done'"
        >
          <app-icon name="signpost" [size]="16" />
          Tour {{ tour.progress() }}/{{ total }}
        </button>
      } @else {
        <section class="tour" aria-label="Guided demo task">
          <header>
            <span class="step-label">
              Guided tour ·
              {{ tour.current() ? 'step ' + (tour.progress() + 1) + ' of ' + total : 'complete' }}
            </span>
            <button
              type="button"
              class="btn btn-icon"
              (click)="tour.setMinimized(true)"
              aria-label="Minimize tour"
            >
              <app-icon name="minus" [size]="16" />
            </button>
            <button
              type="button"
              class="btn btn-icon"
              (click)="tour.close()"
              aria-label="Close tour"
            >
              <app-icon name="x" [size]="16" />
            </button>
          </header>
          <ol class="segments" aria-hidden="true">
            @for (s of tour.steps; track s.key) {
              <li
                [class.done]="tour.done().includes(s.key)"
                [class.now]="tour.current()?.key === s.key"
              ></li>
            }
          </ol>
          @if (tour.current(); as step) {
            <h2>{{ step.title }}</h2>
            <p>{{ step.hint }}</p>
            @if (needsPersona()) {
              <p class="persona">You are {{ session.me()?.displayName }} right now.</p>
            }
            <div class="actions">
              @if (
                step.key === 'open-spec' || step.key === 'history' || step.key === 'create-rfi'
              ) {
                <a
                  class="btn btn-secondary btn-sm"
                  [routerLink]="['/app/documents']"
                  [queryParams]="{ search: 'MCC-M-23 05 00' }"
                  >Open the register</a
                >
              } @else if (step.key === 'audit') {
                <a class="btn btn-secondary btn-sm" routerLink="/app/audit">Open audit trail</a>
              } @else if (tour.rfiId()) {
                <a class="btn btn-secondary btn-sm" [routerLink]="['/app/rfis', tour.rfiId()]"
                  >Open your RFI</a
                >
              }
            </div>
          } @else {
            <h2>Done!</h2>
            <p>You followed an RFI from page citation to approval and checked its audit trail.</p>
            <div class="actions">
              <button type="button" class="btn btn-secondary btn-sm" (click)="tour.restart()">
                Start again
              </button>
            </div>
          }
        </section>
      }
    }
  `,
  styles: `
    .tour,
    .tour-pill {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 60;
    }
    .tour {
      width: 340px;
      max-width: calc(100vw - 32px);
      padding: 12px 14px 14px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-pop);
    }
    header {
      display: flex;
      align-items: center;
      gap: 2px;
      margin: -4px -6px 8px 0;
    }
    .step-label {
      flex: 1;
      color: var(--text-2);
      font-size: var(--fs-12);
      font-weight: 500;
    }
    .segments {
      display: grid;
      grid-auto-flow: column;
      gap: 4px;
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    .segments li {
      height: 4px;
      border-radius: 2px;
      background: var(--surface-subtle);
    }
    .segments li.done {
      background: var(--brand);
    }
    .segments li.now {
      background: color-mix(in srgb, var(--brand) 35%, var(--surface));
    }
    h2 {
      font-family: var(--font-ui);
      font-size: var(--fs-14);
      font-weight: 600;
      letter-spacing: 0;
      margin-bottom: 4px;
    }
    p {
      margin: 0 0 8px;
      color: var(--text-2);
      font-size: var(--fs-13);
    }
    .persona {
      color: var(--text);
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .tour-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 36px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: var(--r-sm);
      background: var(--surface);
      box-shadow: var(--shadow-pop);
      color: var(--text);
      font-weight: 500;
      cursor: pointer;
    }
    @media (max-width: 600px) {
      .tour {
        right: 16px;
        left: 16px;
        bottom: 16px;
        width: auto;
      }
    }
  `,
})
export class TourComponent {
  protected readonly tour = inject(WalkthroughService);
  protected readonly session = inject(SessionService);
  protected readonly total = this.tour.steps.length;
  protected readonly needsPersona = computed(() => {
    const step = this.tour.current();
    return !!step && step.persona !== this.session.me()?.persona;
  });
}
