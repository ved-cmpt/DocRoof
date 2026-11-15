import { Component, Pipe, PipeTransform, computed, inject, input, output } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { label, tone } from '../core/labels';
import { ICONS, IconName } from './icons.generated';

/** One icon set (Lucide outlines), 1.5 stroke, inherits the current text colour. */
@Component({
  selector: 'app-icon',
  template: `<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    [attr.width]="size()"
    [attr.height]="size()"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="stroke()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    [innerHTML]="markup()"
  ></svg>`,
  host: { class: 'icon' },
  styles: ':host { display: inline-flex; line-height: 0; }',
})
export class IconComponent {
  private readonly sanitizer = inject(DomSanitizer);
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly stroke = input(1.5);
  // The markup is a compile-time constant from icons.generated.ts, never user data.
  protected readonly markup = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(ICONS[this.name()]),
  );
}

/** DocRoof mark: a document sheet whose folded corner sets the angle of a roof-line chevron. */
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
      <path
        d="M9 2.5h10.6c.53 0 1.04.21 1.41.59l6.4 6.4c.38.37.59.88.59 1.41V27.5a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-23a2 2 0 0 1 2-2Z"
        fill="var(--brand)"
      />
      <path d="M20 2.6v5.9a2 2 0 0 0 2 2h5.9Z" fill="#9fcfc3" />
      <path
        d="m11.5 20 5-5 5 5"
        fill="none"
        stroke="#fff"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M12 24.5h9" stroke="#fff" stroke-opacity="0.65" stroke-width="2" stroke-linecap="round" />
    </svg>
    @if (wordmark()) {
      <span class="wordmark">DocRoof</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--text);
    }
    svg {
      flex: none;
    }
    .wordmark {
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 18px;
      letter-spacing: -0.02em;
      line-height: 1;
    }
  `,
})
export class LogoComponent {
  readonly size = input(28);
  readonly wordmark = input(false);
}

/** The one status chip used everywhere: soft tint, darker text, rounded-6. */
@Component({
  selector: 'app-status',
  template: `{{ textValue() }}`,
  host: { '[class]': "'chip tone-' + toneName()" },
})
export class StatusChipComponent {
  readonly value = input.required<string | null | undefined>();
  /** Overrides the derived label (e.g. "Overdue 3 d"). */
  readonly text = input<string | null>(null, { alias: 'label' });
  readonly tone = input<string | null>(null);
  protected readonly toneName = computed(() => this.tone() ?? tone(this.value()));
  protected readonly textValue = computed(() => this.text() ?? label(this.value()));
}

export function initials(name: string | null | undefined): string {
  if (!name) {
    return '·';
  }
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

@Component({
  selector: 'app-avatar',
  template: `{{ letters() }}`,
  host: { class: 'avatar', '[class.lg]': 'large()', 'aria-hidden': 'true' },
})
export class AvatarComponent {
  readonly name = input<string | null | undefined>('');
  readonly large = input(false);
  protected readonly letters = computed(() => initials(this.name()));
}

@Component({
  selector: 'app-person',
  imports: [AvatarComponent],
  template: `<app-avatar [name]="name()" /><span class="truncate">{{ name() || fallback() }}</span>`,
  host: { class: 'person' },
})
export class PersonComponent {
  readonly name = input<string | null | undefined>('');
  readonly fallback = input('—');
}

export interface FilterOption {
  value: string;
  label: string;
}

/** Compact dropdown filter chip (toolbar). Inactive: outline. Active: brand tint with the chosen value. */
@Component({
  selector: 'app-filter-chip',
  imports: [MatMenuModule, IconComponent],
  template: `
    <button
      type="button"
      class="filter-chip"
      [class.active]="!!value()"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="label() + ' filter: ' + display()"
    >
      <span>{{ label() }}</span>
      @if (value()) {
        <span class="val">{{ display() }}</span>
      }
      <app-icon name="chevron-down" [size]="14" />
    </button>
    <mat-menu #menu="matMenu" class="dr-menu">
      <button mat-menu-item (click)="pick('')" [attr.aria-checked]="!value()" role="menuitemradio">
        {{ allLabel() }}
        <span class="check-slot">
          @if (!value()) {
            <app-icon name="check" [size]="16" />
          }
        </span>
      </button>
      @for (o of options(); track o.value) {
        <button
          mat-menu-item
          (click)="pick(o.value)"
          role="menuitemradio"
          [attr.aria-checked]="value() === o.value"
        >
          {{ o.label }}
          <span class="check-slot">
            @if (value() === o.value) {
              <app-icon name="check" [size]="16" />
            }
          </span>
        </button>
      }
    </mat-menu>
  `,
  styles: `
    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 8px 0 10px;
      border: 1px solid var(--border-strong);
      border-radius: var(--r-sm);
      background: var(--surface);
      color: var(--text-2);
      font-size: var(--fs-13);
      font-weight: 500;
      white-space: nowrap;
      cursor: pointer;
    }
    .filter-chip:hover {
      background: var(--surface-subtle);
      color: var(--text);
    }
    .filter-chip.active {
      border-color: color-mix(in srgb, var(--brand) 40%, var(--surface));
      background: var(--brand-tint);
      color: var(--brand-hover);
    }
    .val {
      color: var(--text);
      font-weight: 500;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .val::before {
      content: '·';
      margin-right: 6px;
      color: var(--text-2);
    }
  `,
})
export class FilterChipComponent {
  readonly label = input.required<string>();
  readonly options = input.required<FilterOption[]>();
  readonly value = input<string | null | undefined>('');
  readonly allLabel = input('All');
  readonly valueChange = output<string>();
  protected readonly display = computed(
    () => this.options().find((o) => o.value === this.value())?.label ?? this.allLabel(),
  );

  protected pick(v: string): void {
    this.valueChange.emit(v);
  }
}

@Component({
  selector: 'app-pager',
  imports: [IconComponent],
  template: `
    <span>{{ from() }}–{{ to() }} of {{ total() }}</span>
    <button
      type="button"
      class="btn btn-icon"
      (click)="go(page() - 1)"
      [disabled]="page() <= 1"
      aria-label="Previous page"
    >
      <app-icon name="chevron-left" />
    </button>
    <button
      type="button"
      class="btn btn-icon"
      (click)="go(page() + 1)"
      [disabled]="page() >= pages()"
      aria-label="Next page"
    >
      <app-icon name="chevron-right" />
    </button>
  `,
  host: { class: 'pager', role: 'navigation', '[attr.aria-label]': 'ariaLabel()' },
})
export class PagerComponent {
  readonly page = input.required<number>();
  readonly pageSize = input.required<number>();
  readonly total = input.required<number>();
  readonly ariaLabel = input('Pages');
  readonly pageChange = output<number>();
  protected readonly pages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.pageSize())),
  );
  protected readonly from = computed(() =>
    this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize() + 1,
  );
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.pageSize()));

  protected go(p: number): void {
    if (p >= 1 && p <= this.pages()) {
      this.pageChange.emit(p);
    }
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 d ago", then a short date. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return '';
  }
  const t = new Date(iso).getTime();
  const diff = now - t;
  const future = diff < 0;
  const abs = Math.abs(diff);
  if (abs < MINUTE) {
    return 'just now';
  }
  if (abs < HOUR) {
    const m = Math.round(abs / MINUTE);
    return future ? `in ${m} min` : `${m} min ago`;
  }
  if (abs < DAY) {
    const h = Math.round(abs / HOUR);
    return future ? `in ${h} h` : `${h} h ago`;
  }
  const d = Math.round(abs / DAY);
  if (d === 1) {
    return future ? 'tomorrow' : 'yesterday';
  }
  if (d < 7) {
    return future ? `in ${d} d` : `${d} d ago`;
  }
  return shortDate(iso, now);
}

/** "Nov 12" this year, "Nov 12, 2025" otherwise. */
export function shortDate(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function longDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

@Pipe({ name: 'relTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return relativeTime(iso);
  }
}

@Pipe({ name: 'shortDate' })
export class ShortDatePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return shortDate(iso);
  }
}

@Pipe({ name: 'longDate' })
export class LongDateTimePipe implements PipeTransform {
  transform(iso: string | null | undefined): string {
    return longDateTime(iso);
  }
}

/** Table skeleton: N rows of shimmering cells. */
@Component({
  selector: 'app-skeleton-rows',
  template: `
    @for (r of rowsArray(); track r) {
      <div>
        @for (w of widths(); track $index) {
          <span class="skeleton" [style.width.%]="w"></span>
        }
      </div>
    }
  `,
  host: { class: 'skeleton-rows', role: 'status', '[attr.aria-label]': 'label()' },
})
export class SkeletonRowsComponent {
  readonly rows = input(6);
  readonly widths = input([14, 34, 12, 10, 10]);
  readonly label = input('Loading');
  protected readonly rowsArray = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
}

/** Empty / error state with icon, title, one line and an optional action (projected). */
@Component({
  selector: 'app-empty',
  imports: [IconComponent],
  template: `
    <span class="empty-icon"><app-icon [name]="icon()" [size]="20" /></span>
    <h3>{{ heading() }}</h3>
    @if (text()) {
      <p>{{ text() }}</p>
    }
    <ng-content />
  `,
  host: { class: 'empty' },
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('inbox');
  readonly heading = input.required<string>();
  readonly text = input('');
}
