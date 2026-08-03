/* Keep language routing static so the documentation works on GitHub Pages. */
(function () {
  const supported = new Set(["en", "ca", "es"]);
  const storageKey = "gnosi-engineering-language";

  function routeParts() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    const engineeringIndex = parts.lastIndexOf("engineering");
    if (engineeringIndex < 0) return null;
    const possibleLocale = parts[engineeringIndex + 1];
    const locale = supported.has(possibleLocale) ? possibleLocale : "en";
    const suffixStart = engineeringIndex + (locale === "en" ? 1 : 2);
    return { parts, engineeringIndex, locale, suffix: parts.slice(suffixStart) };
  }

  function languagePath(target) {
    const route = routeParts();
    if (!route) return window.location.pathname;
    const prefix = route.parts.slice(0, route.engineeringIndex + 1);
    const localized = target === "en" ? prefix : prefix.concat(target);
    const path = "/" + localized.concat(route.suffix).join("/");
    return window.location.pathname.endsWith("/") ? path + "/" : path;
  }

  function navigate(target) {
    window.localStorage.setItem(storageKey, target);
    window.location.assign(languagePath(target) + window.location.search + window.location.hash);
  }

  function preferredLanguage() {
    const stored = window.localStorage.getItem(storageKey);
    if (supported.has(stored)) return stored;
    const browserLanguage = (navigator.language || "en").toLowerCase().split("-")[0];
    return supported.has(browserLanguage) ? browserLanguage : "en";
  }

  function installSelector(locale) {
    const shellLanguages = document.querySelector(".lang-switch");
    if (shellLanguages) {
      shellLanguages.querySelectorAll("a[data-language]").forEach((link) => {
        link.addEventListener("click", (event) => {
          event.preventDefault();
          navigate(link.dataset.language);
        });
      });
      return;
    }

    const header = document.querySelector(".md-header__inner");
    if (!header || header.querySelector(".gnosi-language-switcher")) return;
    const label = document.createElement("label");
    label.className = "gnosi-language-switcher";
    label.setAttribute("aria-label", "Language");
    const select = document.createElement("select");
    select.setAttribute("aria-label", "Language");
    [["en", "EN"], ["ca", "CA"], ["es", "ES"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = value === locale;
      select.appendChild(option);
    });
    select.addEventListener("change", () => navigate(select.value));
    label.appendChild(select);
    header.appendChild(label);
  }

  const route = routeParts();
  if (!route) return;
  const preferred = preferredLanguage();
  if (route.locale === "en" && preferred !== "en") {
    navigate(preferred);
    return;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => installSelector(route.locale));
  } else {
    installSelector(route.locale);
  }
})();
