/* The testing banner. Loud on purpose: anyone handed this build should never be
   in doubt about whether what they are looking at is real. */
export function mountBanner() {
  if (document.getElementById('demo-banner')) return;

  // Inside the testing hub the page is already framed by the hub's own amber
  // bar, so a second one is just noise. Opened full screen, this is the only
  // thing telling you the build is not real — so it must still appear there.
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  if (embedded) return;

  const bar = document.createElement('div');
  bar.id = 'demo-banner';
  bar.innerHTML = '';                                   // built with DOM, not markup

  const txt = document.createElement('span');
  txt.className = 'demo-banner-t';
  txt.textContent = 'TESTING BUILD — demo data. Nothing here is saved to the real system.';

  const reset = document.createElement('button');
  reset.className = 'demo-banner-btn';
  reset.textContent = 'Reset demo';
  reset.title = 'Clear the demo orders, basket and sign-in in this browser';
  reset.addEventListener('click', async () => {
    if (!confirm('Reset the demo? This clears the demo orders, your basket and the signed-in staff member in this browser.')) return;
    const d = await import('./adapter.js');
    d.resetDemo();
    location.reload();
  });

  const home = document.createElement('a');
  home.className = 'demo-banner-btn';
  home.href = 'index.html';
  home.textContent = 'All sections';

  bar.append(txt, home, reset);
  document.body.prepend(bar);
  document.documentElement.classList.add('has-demo-banner');
}
