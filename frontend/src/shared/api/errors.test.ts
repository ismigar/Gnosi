import { describe, expect, it } from 'vitest';

import { GnosiApiError } from './errors';


function validationResponse(): Response {
  return new Response(null, {
    status: 422,
    statusText: 'Unprocessable Entity',
  });
}


describe('GnosiApiError', () => {
  it('surfaces bounded Pydantic validation messages without exposing inputs', () => {
    const error = new GnosiApiError(validationResponse(), {
      detail: [
        {
          input: 'private@example.test',
          loc: ['body', 'email'],
          msg: '  Reserved email domains are not allowed  ',
          type: 'value_error',
        },
        {
          input: 'secret-password',
          loc: ['body', 'password'],
          msg: 'Password must contain\na number',
          type: 'value_error',
        },
      ],
    });

    expect(error.message).toBe(
      'Reserved email domains are not allowed; Password must contain a number',
    );
    expect(error.message).not.toContain('private@example.test');
    expect(error.message).not.toContain('secret-password');
  });

  it('bounds validation detail count, inspection and message length', () => {
    const longMessage = `Long ${'x'.repeat(200)} hidden-tail`;
    const error = new GnosiApiError(validationResponse(), {
      detail: [
        { msg: longMessage },
        { msg: 'Second validation error' },
        { msg: 'Third validation error' },
        { msg: 'Fourth validation error' },
      ],
    });
    const [firstMessage] = error.message.split('; ');

    expect(firstMessage).toHaveLength(160);
    expect(firstMessage).toMatch(/…$/u);
    expect(error.message).toContain('Third validation error');
    expect(error.message).not.toContain('Fourth validation error');
    expect(error.message).not.toContain('hidden-tail');

    const details: unknown[] = Array.from(
      { length: 13 },
      () => ({ input: 'raw' }),
    );
    details.push({ msg: 'Outside inspection boundary' });
    expect(new GnosiApiError(validationResponse(), { detail: details }).message)
      .toBe('Unprocessable Entity');
  });

  it('keeps the status fallback for malformed structured payloads', () => {
    const error = new GnosiApiError(validationResponse(), {
      body: 'raw-response-body',
      detail: [
        { input: 'private-input', loc: ['body', 'email'] },
        { msg: { raw: 'not-a-message' } },
        null,
      ],
    });

    expect(error.message).toBe('Unprocessable Entity');
    expect(error.message).not.toContain('raw-response-body');
    expect(error.message).not.toContain('private-input');
  });

  it('preserves established structured detail shapes', () => {
    expect(new GnosiApiError(validationResponse(), { detail: 'Try again' }).message)
      .toBe('Try again');
    expect(new GnosiApiError(
      validationResponse(),
      { detail: { message: 'The page changed' } },
    ).message).toBe('The page changed');
  });
});
