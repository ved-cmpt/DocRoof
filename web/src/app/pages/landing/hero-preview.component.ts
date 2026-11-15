import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { IconName } from '../../shared/icons.generated';
import { IconComponent, LogoComponent } from '../../shared/ui';

interface Row {
  num: string;
  title: string;
  status: 'Issued' | 'In review';
  revs: { label: string; current: boolean }[];
  review: { text: string; tone: string } | null;
}

const ROWS: Row[] = [
  {
    num: 'MCC-M-23 31 00',
    title: 'HVAC Ducts and Casings',
    status: 'Issued',
    revs: [{ label: 'R0', current: true }],
    review: { text: 'Approved with comments', tone: 'success' },
  },
  {
    num: 'MCC-P-22 11 16',
    title: 'Domestic Water Piping',
    status: 'In review',
    revs: [{ label: 'R0', current: true }],
    review: { text: 'Pending', tone: 'info' },
  },
  {
    num: 'MCC-FP-21 13 13',
    title: 'Wet-Pipe Sprinkler Systems',
    status: 'Issued',
    revs: [{ label: 'R0', current: true }],
    review: { text: 'Approved', tone: 'success' },
  },
  {
    num: 'MCC-E-26 05 19',
    title: 'Low-Voltage Power Conductors',
    status: 'Issued',
    revs: [{ label: 'R0', current: true }],
    review: { text: 'Pending', tone: 'info' },
  },
  {
    num: 'MCC-S-201',
    title: 'Foundation Plan and Details',
    status: 'Issued',
    revs: [{ label: 'R0', current: true }],
    review: null,
  },
];

const NAV: { icon: IconName; label: string }[] = [
  { icon: 'file-text', label: 'Documents' },
  { icon: 'message-square-text', label: 'RFIs' },
  { icon: 'clipboard-check', label: 'Submittals' },
  { icon: 'inbox', label: 'Review queue' },
  { icon: 'chart-column', label: 'Insights' },
  { icon: 'scroll-text', label: 'Audit' },
];

/**
 * A live-looking, HTML/CSS rendition of the document register (not a screenshot). It loops gently:
 * a new revision row slides in, then its review chip turns Approved. Reduced motion shows the end state.
 */
@Component({
  selector: 'app-hero-preview',
  imports: [IconComponent, LogoComponent],
  template: `
    <div class="window" aria-hidden="true">
      <aside class="side">
        <div class="side-brand"><app-logo [size]="18" [wordmark]="true" /></div>
        <div class="proj"><span class="badge">MCC</span> Midtown Community Clinic</div>
        @for (n of nav; track n.label; let i = $index) {
          <div class="nav" [class.active]="i === 0">
            <app-icon [name]="n.icon" [size]="14" /> {{ n.label }}
          </div>
        }
      </aside>
      <div class="main">
        <div class="bar">
          <span class="title">Document register</span>
          <span class="btn-mock"><app-icon name="upload" [size]="12" /> Upload document</span>
        </div>
        <div class="table">
          <div class="filters">
            <span class="search"
              ><app-icon name="search" [size]="12" /> Search number or title</span
            >
            <span class="fchip">Discipline</span><span class="fchip">Status</span
            ><span class="fchip">Review</span>
          </div>
          <div class="thead">
            <span>Number</span><span>Title</span><span>Status</span><span>Revisions</span
            ><span>Review</span>
          </div>
          <div class="row new" [class.shown]="phase() >= 1">
            <span class="num">MCC-M-23 05 00</span>
            <span class="t">Common Work Results for HVAC</span>
            <span><span class="chip tone-success">Issued</span></span>
            <span class="revs"><span class="rev">R1</span><span class="rev current">R2</span></span>
            <span>
              <span
                class="chip"
                [class.tone-info]="phase() < 2"
                [class.tone-success]="phase() >= 2"
                >{{ phase() >= 2 ? 'Approved' : 'Pending' }}</span
              >
            </span>
          </div>
          @for (r of rows; track r.num) {
            <div class="row">
              <span class="num">{{ r.num }}</span>
              <span class="t">{{ r.title }}</span>
              <span
                ><span
                  class="chip"
                  [class.tone-success]="r.status === 'Issued'"
                  [class.tone-info]="r.status !== 'Issued'"
                  >{{ r.status }}</span
                ></span
              >
              <span class="revs">
                @for (v of r.revs; track v.label) {
                  <span class="rev" [class.current]="v.current">{{ v.label }}</span>
                }
              </span>
              <span>
                @if (r.review; as rv) {
                  <span class="chip" [class]="'chip tone-' + rv.tone">{{ rv.text }}</span>
                } @else {
                  <span class="dash">—</span>
                }
              </span>
            </div>
          }
        </div>
        <div class="toast" [class.shown]="phase() === 1">
          <app-icon name="layers" [size]="14" /> R2 uploaded · R1 kept as superseded
        </div>
      </div>
    </div>
  `,
  styleUrl: './hero-preview.component.scss',
})
export class HeroPreviewComponent implements OnInit {
  protected readonly rows = ROWS;
  protected readonly nav = NAV;
  /** 0 = base, 1 = new revision arrives, 2 = review approved. */
  protected readonly phase = signal(0);
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  ngOnInit(): void {
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      this.phase.set(2);
      return;
    }
    this.loop();
  }

  private loop(): void {
    this.phase.set(0);
    this.timers = [
      setTimeout(() => this.phase.set(1), 1200),
      setTimeout(() => this.phase.set(2), 3600),
      setTimeout(() => this.loop(), 9000),
    ];
  }
}
