import { HttpErrorResponse } from '@angular/common/http';
import { isUnreachable } from './demo.page';

describe('demo start error handling', () => {
  it('treats network failures and proxy errors as an unreachable API', () => {
    expect(isUnreachable(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(isUnreachable(new HttpErrorResponse({ status: 504 }))).toBe(true);
    expect(
      isUnreachable(new HttpErrorResponse({ status: 500, error: 'Error occurred while proxying' })),
    ).toBe(true);
  });

  it('shows real API problems (for example the demo quota) as they are', () => {
    expect(
      isUnreachable(
        new HttpErrorResponse({ status: 429, error: { title: 'Too many demo workspaces' } }),
      ),
    ).toBe(false);
    expect(isUnreachable(new HttpErrorResponse({ status: 500, error: { title: 'Boom' } }))).toBe(
      false,
    );
    expect(isUnreachable(new Error('other'))).toBe(false);
  });
});
