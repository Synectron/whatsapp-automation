/* Dashboard behaviour: theme toggle, live status pill, cron preview, templates. */
(function () {
  'use strict';

  /* ── Dark mode ─────────────────────────────────────────────────────── */
  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var root = document.documentElement;
      var isDark = root.classList.toggle('dark');
      try {
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
      } catch (e) {}
    });
  }

  /* ── Mobile navigation ─────────────────────────────────────────────── */
  var navToggle = document.getElementById('nav-toggle');
  var navLinks = document.getElementById('nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', function () {
      navLinks.classList.toggle('hidden');
      navLinks.classList.toggle('flex');
    });
  }

  /* ── Template buttons fill the nearest textarea ────────────────────── */
  document.querySelectorAll('[data-template]').forEach(function (button) {
    button.addEventListener('click', function () {
      var form = button.closest('form') || document;
      var target = form.querySelector('textarea[name="message"]') || document.getElementById('send-message');
      if (target) {
        target.value = decodeURIComponent(button.getAttribute('data-template'));
        target.focus();
      }
    });
  });

  /* ── Live cron description ─────────────────────────────────────────── */
  var cronTimers = new WeakMap();
  var csrfField = document.querySelector('input[name="_csrf"]');
  document.querySelectorAll('[data-cron-input]').forEach(function (input) {
    var preview = input.parentElement.querySelector('[data-cron-preview]');
    if (!preview || !csrfField) return;
    input.addEventListener('input', function () {
      clearTimeout(cronTimers.get(input));
      cronTimers.set(
        input,
        setTimeout(function () {
          fetch('/api/schedule/validate-cron', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': csrfField.value,
            },
            body: JSON.stringify({ cron: input.value }),
          })
            .then(function (r) { return r.json(); })
            .then(function (payload) {
              var data = payload.data || {};
              preview.textContent = data.valid ? data.description : data.reason || 'Invalid cron expression';
              preview.className =
                'mt-1 block text-xs ' + (data.valid ? 'text-slate-500 dark:text-slate-400' : 'text-red-600');
            })
            .catch(function () {});
        }, 350),
      );
    });
  });

  /* ── Connection status pill (polls /api/status) ────────────────────── */
  var pill = document.getElementById('status-pill');
  if (!pill) return;

  var CLASSES = {
    ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    qr: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    reconnecting: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    initializing: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    authenticated: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
  };
  var FAILED = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';
  var lastStatus = null;

  function refresh() {
    fetch('/api/status', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        if (!payload || !payload.data) return;
        var status = payload.data.status;
        pill.textContent = status.replace('_', ' ');
        pill.className =
          'rounded-full px-2 py-0.5 text-xs font-medium sm:inline-block ' + (CLASSES[status] || FAILED);
        // Reload once when the connection state changes so the QR panel updates.
        if (lastStatus && lastStatus !== status && (status === 'ready' || status === 'qr')) {
          window.location.reload();
        }
        lastStatus = status;
      })
      .catch(function () {});
  }

  refresh();
  setInterval(refresh, 5000);
})();
