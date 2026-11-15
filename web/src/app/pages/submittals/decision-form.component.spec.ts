import { TestBed } from '@angular/core/testing';
import { DecisionFormComponent, DecisionSubmit } from './decision-form.component';

describe('DecisionFormComponent validation', () => {
  function create() {
    TestBed.configureTestingModule({ imports: [DecisionFormComponent] });
    const fixture = TestBed.createComponent(DecisionFormComponent);
    fixture.detectChanges();
    const emitted: DecisionSubmit[] = [];
    fixture.componentInstance.decided.subscribe((d) => emitted.push(d));
    return { fixture, form: fixture.componentInstance.form, emitted };
  }

  it('requires a decision', () => {
    const { fixture, emitted } = create();
    fixture.componentInstance.submit();
    fixture.detectChanges();
    expect(emitted).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Choose a decision.');
  });

  it('accepts "Approved" without comments', () => {
    const { fixture, form, emitted } = create();
    form.setValue({ decision: 'Approved', comments: '' });
    fixture.componentInstance.submit();
    expect(emitted).toEqual([{ decision: 'Approved', comments: '' }]);
  });

  it.each(['ApprovedWithComments', 'ReviseAndResubmit'] as const)(
    'requires comments for %s',
    (decision) => {
      const { fixture, form, emitted } = create();
      form.setValue({ decision, comments: '   ' });
      expect(form.hasError('commentsRequired')).toBe(true);
      fixture.componentInstance.submit();
      fixture.detectChanges();
      expect(emitted).toEqual([]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain('Comments are required');

      form.setValue({ decision, comments: 'Add access doors at FD-3.' });
      fixture.componentInstance.submit();
      expect(emitted).toEqual([{ decision, comments: 'Add access doors at FD-3.' }]);
    },
  );
});
