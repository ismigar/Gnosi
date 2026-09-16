export const MICROSOFT_MAIL_DOMAINS: readonly string[] = [
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'uned.es', 'alumno.uned.es',
];

export function isMicrosoftMailAddress(email: string): boolean {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && !!parts[0] && MICROSOFT_MAIL_DOMAINS.includes(parts[1] ?? '');
}

export function microsoftSignInPath(email: string): string {
  const params = new URLSearchParams();
  if (email.trim()) params.set('login_hint', email.trim());
  return '/api/auth/microsoft/login' + (params.size ? '?' + params.toString() : '');
}
