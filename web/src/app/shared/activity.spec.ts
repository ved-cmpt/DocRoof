import { AuditEvent } from '../core/api.models';
import { describeEvent, eventSentence } from './activity';

function event(action: string, change: object, reference: string | null = 'RFI-004'): AuditEvent {
  return {
    id: 1,
    timestamp: '2026-11-10T09:00:00Z',
    actor: { id: 'u1', displayName: 'Priya Raman' },
    resource: 'Rfi',
    resourceId: 'r1',
    action,
    changeJson: JSON.stringify(change),
    reference,
  };
}

describe('activity sentences', () => {
  it('turns an assignment into a short sentence, not a field dump', () => {
    const e = event('rfi.assigned', {
      before: { state: 'Submitted' },
      after: {
        state: 'Assigned',
        assignee: 'Marcus Lindqvist',
        dueAt: `${new Date().getFullYear()}-11-12T12:00:00Z`,
      },
    });
    const sentence = eventSentence(e);
    expect(sentence).toBe('assigned Marcus Lindqvist · due Nov 12');
    expect(sentence).not.toContain('state:');
  });

  it('keeps the reason of a returned answer as a quote', () => {
    const t = describeEvent(
      event('rfi.answer-rejected', { after: { state: 'Assigned', reason: 'Cite the clause.' } }),
    );
    expect(t.verb).toBe('returned the answer');
    expect(t.quote).toBe('Cite the clause.');
  });

  it('labels submittal decisions and cycles', () => {
    const e = event('submittal.decided', {
      after: { status: 'ReviseAndResubmit', cycle: 2, comments: 'Add access doors.' },
    });
    expect(eventSentence(e)).toBe('decided Revise & resubmit · cycle 2');
  });

  it('describes a superseding upload', () => {
    const e = event('revision.superseded', {
      before: { versionLabel: 'R0' },
      after: { versionLabel: 'R1', sha256: 'abc', fileName: 'spec.pdf' },
    });
    expect(eventSentence(e)).toBe('uploaded R1 · supersedes R0');
  });

  it('falls back to the action verb for unknown or malformed events', () => {
    expect(eventSentence({ ...event('thing.happened-now', {}), changeJson: '{oops' })).toBe(
      'happened now',
    );
  });
});
