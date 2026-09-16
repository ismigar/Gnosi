import { describe, expect, it } from 'vitest';
import { isMicrosoftMailAddress, microsoftSignInPath } from './microsoft-auth';

describe('Microsoft mail sign-in', () => {
  it('recognizes UNED without matching lookalike domains', () => {
    expect(isMicrosoftMailAddress(' Student@alumno.uned.es ')).toBe(true);
    expect(isMicrosoftMailAddress('staff@uned.es')).toBe(true);
    expect(isMicrosoftMailAddress('student@alumno.uned.es.evil.test')).toBe(false);
    expect(isMicrosoftMailAddress('student@notuned.es')).toBe(false);
  });

  it('preserves the email as a single encoded login hint', () => {
    const email = 'student+alias&other=value@alumno.uned.es';
    const url = new URL(microsoftSignInPath(' ' + email + ' '), 'http://localhost');
    expect(url.pathname).toBe('/api/auth/microsoft/login');
    expect([...url.searchParams.entries()]).toEqual([['login_hint', email]]);
    expect(microsoftSignInPath(' ')).toBe('/api/auth/microsoft/login');
  });
});
