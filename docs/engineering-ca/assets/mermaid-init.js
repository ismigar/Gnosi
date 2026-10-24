(() => {
  if (typeof mermaid === "undefined") return;

  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const themeVariables = isDark
    ? {
        primaryColor: "#27272a",
        primaryTextColor: "#f4f4f5",
        primaryBorderColor: "#52525b",
        lineColor: "#a1a1aa",
        secondaryColor: "#18181b",
        tertiaryColor: "#111113",
      }
    : {
        primaryColor: "#f3f4f6",
        primaryTextColor: "#111827",
        primaryBorderColor: "#d1d5db",
        lineColor: "#6b7280",
        secondaryColor: "#f9fafb",
        tertiaryColor: "#ffffff",
      };

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables,
  });

  const renderDiagrams = async () => {
    document.querySelectorAll("pre.mermaid").forEach((preformatted) => {
      const container = document.createElement("div");
      container.className = "mermaid";
      container.textContent = preformatted.textContent;
      preformatted.replaceWith(container);
    });

    const nodes = document.querySelectorAll(".mermaid:not([data-processed='true'])");
    if (nodes.length === 0) return;
    await mermaid.run({ nodes });
  };

  if (typeof document$ !== "undefined") {
    document$.subscribe(() => void renderDiagrams());
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void renderDiagrams(), { once: true });
  } else {
    void renderDiagrams();
  }
})();
