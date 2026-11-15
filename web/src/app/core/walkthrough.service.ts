import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SessionService } from './session.service';

export type TourStep =
  'open-spec' | 'history' | 'create-rfi' | 'assign' | 'answer' | 'approve' | 'close' | 'audit';

export interface TourStepInfo {
  key: TourStep;
  title: string;
  persona: string;
  hint: string;
}

export const TOUR_STEPS: TourStepInfo[] = [
  {
    key: 'open-spec',
    title: 'Open the HVAC specification',
    persona: 'requester',
    hint: 'Open MCC-M-23 05 00 from the Midtown register.',
  },
  {
    key: 'history',
    title: 'Inspect its version history',
    persona: 'requester',
    hint: 'Select the superseded R0 revision or compare R0 with R1.',
  },
  {
    key: 'create-rfi',
    title: 'Raise an RFI citing revision and page',
    persona: 'requester',
    hint: 'On R1, go to page 3 and choose "Raise RFI on this page", then submit it.',
  },
  {
    key: 'assign',
    title: 'Switch to the Project Manager and assign it',
    persona: 'manager',
    hint: 'Switch persona to Priya Raman from the profile menu, then assign Marcus Lindqvist.',
  },
  {
    key: 'answer',
    title: 'Switch to the Reviewer and answer',
    persona: 'reviewer',
    hint: 'Switch to Marcus Lindqvist and post an answer.',
  },
  {
    key: 'approve',
    title: 'Switch to the Project Manager and approve',
    persona: 'manager',
    hint: 'Switch back to Priya Raman and approve the answer.',
  },
  {
    key: 'close',
    title: 'Close the RFI',
    persona: 'manager',
    hint: 'Close the RFI as Priya Raman.',
  },
  {
    key: 'audit',
    title: 'Verify the audit trail',
    persona: 'manager',
    hint: 'Open Audit to see every step with actor and timestamp.',
  },
];

interface TourState {
  done: TourStep[];
  rfiId: string | null;
  /** The compact tour popover is shown (opt-in; hidden by default). */
  open: boolean;
  minimized: boolean;
  /** The one-time welcome toast was shown for this workspace. */
  welcomed: boolean;
}

const EMPTY: TourState = { done: [], rfiId: null, open: false, minimized: false, welcomed: false };

/** Progress of the optional guided tour, stored per guest workspace in this browser only. */
@Injectable({ providedIn: 'root' })
export class WalkthroughService {
  private readonly session = inject(SessionService);
  private readonly state = signal<TourState>({ ...EMPTY });
  private loadedFor: string | null = null;

  readonly steps = TOUR_STEPS;
  readonly done = computed(() => this.state().done);
  readonly rfiId = computed(() => this.state().rfiId);
  readonly open = computed(() => this.active() && this.state().open);
  readonly minimized = computed(() => this.state().minimized);
  readonly welcomed = computed(() => this.state().welcomed);
  readonly current = computed(
    () => TOUR_STEPS.find((s) => !this.state().done.includes(s.key)) ?? null,
  );
  readonly progress = computed(() => this.state().done.length);
  readonly active = computed(() => this.session.isGuest());

  constructor() {
    effect(() => {
      const tenant = this.session.me()?.tenantId ?? null;
      if (tenant && tenant !== this.loadedFor) {
        this.loadedFor = tenant;
        this.state.set(this.read(tenant));
      }
    });
  }

  mark(step: TourStep, rfiId?: string): void {
    if (!this.active()) {
      return;
    }
    const s = this.state();
    if (step !== 'create-rfi' && step !== 'open-spec' && step !== 'history' && step !== 'audit') {
      // Workflow steps only count for the RFI created during the tour.
      if (!s.rfiId || (rfiId && rfiId !== s.rfiId)) {
        return;
      }
    }
    const done = s.done.includes(step) ? s.done : [...s.done, step];
    this.update({ ...s, done, rfiId: step === 'create-rfi' && rfiId ? rfiId : s.rfiId });
  }

  /** Opens the tour popover ("Take the tour"). */
  start(): void {
    this.update({ ...this.state(), open: true, minimized: false, welcomed: true });
  }

  close(): void {
    this.update({ ...this.state(), open: false });
  }

  setMinimized(minimized: boolean): void {
    this.update({ ...this.state(), minimized });
  }

  markWelcomed(): void {
    this.update({ ...this.state(), welcomed: true });
  }

  /** Starts the steps over and shows the popover. */
  restart(): void {
    this.update({ ...this.state(), done: [], rfiId: null, open: true, minimized: false });
  }

  /** After "Reset my demo": progress is cleared, visibility is kept. */
  reset(): void {
    this.update({ ...this.state(), done: [], rfiId: null });
  }

  private update(next: TourState): void {
    this.state.set(next);
    try {
      if (this.loadedFor) {
        localStorage.setItem(`docroof.tour.${this.loadedFor}`, JSON.stringify(next));
      }
    } catch {
      /* storage unavailable: progress lasts for this page view */
    }
  }

  private read(tenant: string): TourState {
    try {
      const raw = localStorage.getItem(`docroof.tour.${tenant}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<TourState>;
        return {
          done: parsed.done ?? [],
          rfiId: parsed.rfiId ?? null,
          open: !!parsed.open,
          minimized: !!parsed.minimized,
          welcomed: !!parsed.welcomed,
        };
      }
    } catch {
      /* ignore corrupt or unavailable storage */
    }
    return { ...EMPTY };
  }
}
