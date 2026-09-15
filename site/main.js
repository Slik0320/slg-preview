/* Sam's Liquor Group — site behavior */
(function () {
  'use strict';

  /* ============ AGE GATE ============ */
  var AGE_KEY = 'slg-age-verified';
  var gate = document.getElementById('agegate');
  if (gate) {
    var verified = false;
    try { verified = localStorage.getItem(AGE_KEY) === 'yes'; } catch (e) {}
    if (verified) {
      gate.hidden = true;
    } else {
      document.body.classList.add('gate-locked');
      document.getElementById('age-yes').addEventListener('click', function () {
        try { localStorage.setItem(AGE_KEY, 'yes'); } catch (e) {}
        gate.hidden = true;
        document.body.classList.remove('gate-locked');
      });
      document.getElementById('age-no').addEventListener('click', function () {
        document.getElementById('agegate-ask').hidden = true;
        document.getElementById('agegate-denied').hidden = false;
      });
    }
  }

  /* ============ HEADER SCROLL ============ */
  var header = document.querySelector('.site-header[data-scrollfx]');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 40);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ============ EDITORIAL HERO CAROUSEL ============ */
  var hero = document.getElementById('hero');
  if (hero) {
    var slides = hero.querySelectorAll('.hero-slide');
    var thumbs = hero.querySelectorAll('.hero-thumb');
    var kickerNum = document.getElementById('hero-num');
    var title = document.getElementById('hero-name');
    var tagline = document.getElementById('hero-tagline');
    var cta = document.getElementById('hero-cta');
    var ctaName = document.getElementById('hero-cta-name');

    var data = [
      { num: '01', name: 'Retail', tagline: 'Everyday-affordable liquor for every occasion.', target: '#retail' },
      { num: '02', name: 'Wholesale', tagline: 'Powering taverns, pubs, liquor stores and restaurants.', target: '#wholesale' },
      { num: '03', name: 'DC Partner', tagline: 'FMCG order fulfilment, warehousing and last-mile deliveries.', target: '#dc' },
      { num: '04', name: 'Event Partner', tagline: 'We bring the licensed, staffed and stocked bar. You run the event.', target: '#event' },
      { num: '05', name: 'Marketing Partner', tagline: 'Grow your brand with our content and wide, engaged audience.', target: '#marketing' }
    ];

    var current = 0;
    var timer = null;
    var INTERVAL = 5000;

    var show = function (i) {
      current = i;
      for (var k = 0; k < slides.length; k++) {
        slides[k].classList.toggle('active', k === i);
        thumbs[k].classList.toggle('active', k === i);
      }
      var d = data[i];
      kickerNum.textContent = d.num;
      title.textContent = d.name;
      tagline.textContent = d.tagline;
      ctaName.textContent = d.name;
      cta.setAttribute('href', d.target);
    };

    var start = function () {
      clearInterval(timer);
      timer = setInterval(function () { show((current + 1) % slides.length); }, INTERVAL);
    };

    thumbs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(i); start(); });
    });
    hero.addEventListener('mouseenter', function () { clearInterval(timer); });
    hero.addEventListener('mouseleave', start);

    show(0);
    start();
  }

  /* ============ CONTACT FORM ============ */
  var form = document.getElementById('contact-form');
  if (form) {
    var submitBtn = document.getElementById('form-submit');
    var errBox = document.getElementById('form-error');

    var topicSel = document.getElementById('cf-topic');
    var otherWrap = document.getElementById('cf-other-wrap');
    var otherInput = document.getElementById('cf-other');
    topicSel.addEventListener('change', function () {
      var isOther = topicSel.value === 'Other';
      otherWrap.style.display = isOther ? 'block' : 'none';
      otherInput.required = isOther;
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errBox.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending…';

      // EmailJS delivers to the address set in the template's "To Email"
      fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: 'service_1t7m9kj',
          template_id: 'template_b4re798',
          user_id: 'T1snCl6B35PImF38a',
          template_params: {
            name: document.getElementById('cf-name').value,
            email: document.getElementById('cf-email').value,
            topic: topicSel.value === 'Other'
              ? 'Other — ' + otherInput.value
              : topicSel.value,
            message: document.getElementById('cf-message').value
          }
        })
      })
        .then(function (r) {
          if (!r.ok) throw new Error('send failed: ' + r.status);
          form.style.display = 'none';
          document.getElementById('form-thanks').style.display = 'block';
        })
        .catch(function () {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send message';
          errBox.style.display = 'block';
        });
    });
  }
})();

/* ============ EVENT ENQUIRY FORM ============ */
/* Kept as its own IIFE so the event page's logic never runs on the other two
   pages, and so the transport can be swapped without touching anything above. */
(function () {
  'use strict';

  var form = document.getElementById('event-form');
  if (!form) return;

  var submitBtn = document.getElementById('event-form-submit');
  var errBox    = document.getElementById('event-form-error');
  var thanks    = document.getElementById('event-form-thanks');
  var licensed  = document.getElementById('ef-licensed');
  var outdoor   = document.getElementById('ef-outdoor');
  var routeIn   = document.getElementById('ef-route');
  var dateIn    = document.getElementById('ef-date');
  var leadNote  = document.getElementById('ef-leadtime');
  var sourceIn  = document.getElementById('ef-source');

  /* ---- UTM capture -------------------------------------------------------
     The page is the landing page for paid social. Read the tags once, keep
     them for the session so they survive the age gate and any navigation,
     and send them as one string with the enquiry. */
  var UTM_KEY = 'slg-utm';
  var source = '';
  try {
    var q = new URLSearchParams(window.location.search);
    var parts = [];
    ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) {
      var v = q.get(k);
      if (v) parts.push(k.replace('utm_', '') + '=' + v);
    });
    if (parts.length) sessionStorage.setItem(UTM_KEY, parts.join(' | '));
    source = sessionStorage.getItem(UTM_KEY) || '';
  } catch (e) { source = ''; }
  sourceIn.value = source;

  /* ---- Route classification ---------------------------------------------
     Which of the three service models the enquiry most likely needs. For our
     sales team only — deliberately never shown to the person filling it in. */
  function classify() {
    var lic = licensed.value;
    var out = outdoor.value;
    if (!lic) return '';
    if (lic.indexOf('No') === 0 || lic.indexOf("I don't know") === 0) return 'A — Full Bar Service';
    if (out === 'Yes') return 'C — Overflow & Outdoor';
    if (out) return 'B — Managed Bar Partnership';
    return '';
  }
  function refreshRoute() { routeIn.value = classify(); }
  licensed.addEventListener('change', refreshRoute);
  outdoor.addEventListener('change', refreshRoute);
  refreshRoute();

  /* ---- Lead-time notice --------------------------------------------------
     Under six weeks is tight for a permit application. Say so plainly rather
     than turning the enquiry away. */
  var LEAD_DAYS = 42;
  function checkLeadTime() {
    if (!dateIn.value) { leadNote.hidden = true; return; }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var picked = new Date(dateIn.value + 'T00:00:00');
    if (isNaN(picked.getTime())) { leadNote.hidden = true; return; }
    var days = Math.round((picked - today) / 86400000);
    leadNote.hidden = !(days >= 0 && days < LEAD_DAYS);
  }
  dateIn.addEventListener('change', checkLeadTime);
  dateIn.addEventListener('input', checkLeadTime);
  checkLeadTime();

  /* ---- Transport ---------------------------------------------------------
     The ONLY place that knows how an enquiry leaves the browser. Swapping
     EmailJS for a Supabase `event_enquiries` insert is a change to this
     function and nothing else. Returns a promise. */
  function sendEnquiry(payload) {
    // TODO: create EmailJS template for event enquiries
    var EVENT_TEMPLATE_ID = 'EVENT_TEMPLATE_ID';
    return fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: 'service_1t7m9kj',
        template_id: EVENT_TEMPLATE_ID,
        user_id: 'T1snCl6B35PImF38a',
        template_params: payload
      })
    }).then(function (r) {
      if (!r.ok) throw new Error('send failed: ' + r.status);
      return r;
    });
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    // novalidate is set so the notice and route can update freely; run the
    // browser's own validation explicitly instead of reimplementing it.
    if (!form.checkValidity()) { form.reportValidity(); return; }

    errBox.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    refreshRoute();

    sendEnquiry({
      name:            val('ef-name'),
      company:         val('ef-company'),
      email:           val('ef-email'),
      phone:           val('ef-phone'),
      event_name:      val('ef-event'),
      event_type:      val('ef-type'),
      venue:           val('ef-venue'),
      venue_address:   val('ef-address'),
      venue_licensed:  val('ef-licensed'),
      outdoor_areas:   val('ef-outdoor'),
      event_date:      val('ef-date'),
      days:            val('ef-days'),
      hours:           val('ef-hours'),
      attendance:      val('ef-attendance'),
      notes:           val('ef-notes'),
      route:           routeIn.value,
      source:          sourceIn.value
    })
      .then(function () {
        form.style.display = 'none';
        thanks.style.display = 'block';
        thanks.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send event enquiry';
        errBox.style.display = 'block';
      });
  });
})();
