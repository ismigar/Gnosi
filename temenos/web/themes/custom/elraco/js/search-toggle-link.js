(function (Drupal, once) {
  Drupal.behaviors.searchToggleLinkSetup = {
    attach: function (context) {
      // 1) Selecciona l'enllaç que vols reutilitzar com a disparador.
      //    Ajusta el selector al que realment tens: classe, id, ruta...
      once('search-toggle-link', 'a.mi-enllaç-de-cerca', context)
        .forEach(function (link) {
          // 2) Afegeix els atributs ARIA i d’identificació
          link.setAttribute('id', 'search-toggle-link');
          link.classList.add('search-toggle');
          link.setAttribute('aria-controls', 'search-form-wrapper');
          link.setAttribute('aria-expanded', 'false');
          link.setAttribute('aria-label', Drupal.t('Obrir cerca'));
        });
    }
  };
})(Drupal, once);
