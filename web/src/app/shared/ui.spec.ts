import { TestBed } from '@angular/core/testing';
import { StatusChipComponent, initials, relativeTime, shortDate } from './ui';

describe('relativeTime', () => {
  const now = Date.parse('2026-11-15T12:00:00Z');

  it('uses short relative phrases for recent times', () => {
    expect(relativeTime('2026-11-15T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-11-15T11:15:00Z', now)).toBe('45 min ago');
    expect(relativeTime('2026-11-15T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-14T10:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-11-11T12:00:00Z', now)).toBe('4 d ago');
  });

  it('switches to a date after a week', () => {
    expect(relativeTime('2026-10-28T12:00:00Z', now)).toBe(shortDate('2026-10-28T12:00:00Z', now));
    expect(shortDate('2025-03-02T12:00:00Z', now)).toContain('2025');
  });
});

describe('initials', () => {
  it('takes the first and last name initials', () => {
    expect(initials('Marcus Lindqvist')).toBe('ML');
    expect(initials('Dana')).toBe('D');
    expect(initials(null)).toBe('·');
  });
});

describe('StatusChipComponent', () => {
  function render(value: string, label?: string) {
    TestBed.configureTestingModule({ imports: [StatusChipComponent] });
    const fixture = TestBed.createComponent(StatusChipComponent);
    fixture.componentRef.setInput('value', value);
    if (label) {
      fixture.componentRef.setInput('label', label);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders one chip shape with a tone derived from the status', () => {
    const el = render('ReviseAndResubmit');
    expect(el.classList).toContain('chip');
    expect(el.classList).toContain('tone-warning');
    expect(el.textContent?.trim()).toBe('Revise & resubmit');
  });

  it('keeps neutral for non-status values and accepts a custom label', () => {
    TestBed.resetTestingModule();
    const el = render('Overdue', 'Overdue 3 d');
    expect(el.classList).toContain('tone-danger');
    expect(el.textContent?.trim()).toBe('Overdue 3 d');
  });
});
