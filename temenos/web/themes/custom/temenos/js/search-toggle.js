 document.addEventListener('DOMContentLoaded', () => {
  const wrap  = document.getElementById('block-temenos-formularidecerca');
  const btn   = document.getElementById('button-search-toggle');
  const form  = document.getElementById('search-block-form');
  const input = document.getElementById('edit-keys');
  if (!wrap || !btn || !form) return;

  // 0) Normalitza l’estat inicial (neteja inline i sincronitza amb la classe)
  form.style.removeProperty('display'); // deixa que el CSS decideixi
  btn.setAttribute('aria-controls', 'search-block-form');
  btn.setAttribute('aria-expanded', wrap.classList.contains('form-visible') ? 'true' : 'false');

  const open = () => {
  wrap.classList.add('form-visible');
  form.style.removeProperty('display');            // que apliqui "flex" del CSS
  btn.setAttribute('aria-expanded', 'true');
  // focus suau al camp
  if (input) requestAnimationFrame(() => input.focus());
};
  const close = () => {
  wrap.classList.remove('form-visible');
  form.style.display = 'none';                     // queda amagat encara que falti el CSS
  btn.setAttribute('aria-expanded', 'false');
};
  const isOpen = () => wrap.classList.contains('form-visible');

  // 1) Toggle amb clic a la lupa
  btn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation(); // evita comportaments enganxats a .form-submit
  isOpen() ? close() : open();
});

  // 2) Tanca amb ESC
  document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && isOpen()) {
  e.preventDefault();
  close();
  btn.focus();
}
});

  // 3) Tanca si cliques fora
  document.addEventListener('click', (e) => {
  if (!wrap.contains(e.target) && isOpen()) close();
});

  // 4) Evita que el clic dins el formulari propagui i el tanqui
  form.addEventListener('click', (e) => e.stopPropagation());
});
