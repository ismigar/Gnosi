(() => {
  if (typeof mermaid === "undefined") return;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "default",
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
