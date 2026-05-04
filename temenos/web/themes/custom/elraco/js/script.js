jQuery(document).ready(function () {
  // Flexslider init
  if (jQuery().flexslider) {
    jQuery('.flexslider').flexslider({
      animation: "fade",
      controlNav: false
    });
  }

  // Scroll Animation Observer
  const observerOptions = {
    root: null,
    rootMargin: '0px',
    threshold: 0.1
  };

  const observer = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target); // Only animate once
      }
    });
  }, observerOptions);

  // Target elements to animate
  // We add the class to common containers if they don't have it
  const animatedElements = document.querySelectorAll('.card, .node--view-mode-teaser, .node--view-mode-full, .comment-wrapper > article, .views-row article, #main .views-row, #highlighted .row, .views-view-responsive-grid__item');

  animatedElements.forEach(el => {
    el.classList.add('fade-in-section');
    observer.observe(el);
  });

});
