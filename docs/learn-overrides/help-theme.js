(function () {
  const valid = value => ['light', 'dark', 'system'].includes(value);
  const requested = new URL(window.location.href).searchParams.get('theme');
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  function preference() {
    if (valid(requested)) return requested;
    try {
      const saved = window.localStorage.getItem('db-theme');
      if (valid(saved)) return saved;
    } catch (_) { /* Private browsing can make storage unavailable. */ }
    return 'system';
  }
  function apply() {
    const theme = preference();
    const dark = theme === 'dark' || (theme === 'system' && system.matches);
    document.body.setAttribute('data-md-color-scheme', dark ? 'slate' : 'default');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }
  function carryTheme(link) {
    if (!link || !link.href) return;
    const destination = new URL(link.href, window.location.href);
    if (destination.origin === window.location.origin && destination.pathname.startsWith('/Gnosi/learn/')) {
      destination.searchParams.set('theme', preference());
      link.href = destination.href;
    }
  }
  apply();
  system.addEventListener('change', apply);
  window.addEventListener('storage', function (event) {
    if (event.key === 'db-theme' || event.key === null) apply();
  });
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('a[href]').forEach(carryTheme);
  });
  document.addEventListener('click', function (event) {
    if (event.target instanceof Element) carryTheme(event.target.closest('a[href]'));
  });
})();
