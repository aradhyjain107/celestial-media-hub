(function () {
  try {
    if (typeof window === 'undefined') return;
    window.__nativeFetch = window.fetch;
    var isExt = function (err, evt) {
      var s = (err && (err.stack || err.message)) || (evt && (evt.message || evt.filename)) || '';
      if (typeof s !== 'string') s = String(s || '');
      return (
        s.indexOf('chrome-extension://') !== -1 ||
        s.indexOf('moz-extension://') !== -1 ||
        s.indexOf('safari-web-extension://') !== -1 ||
        s.indexOf('activeContentBlocker') !== -1 ||
        s.indexOf('eiimnmioipafcokbfikbljfdeojpcgbh') !== -1
      );
    };
    window.addEventListener(
      'unhandledrejection',
      function (e) {
        if (isExt(e.reason, e)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          console.warn('[Extension Guard] Suppressed extension unhandled rejection:', e.reason);
        }
      },
      true
    );
    window.addEventListener(
      'error',
      function (e) {
        if (isExt(e.error, e)) {
          e.stopImmediatePropagation();
          e.preventDefault();
          console.warn('[Extension Guard] Suppressed extension runtime error:', e.message || e.error);
        }
      },
      true
    );
  } catch (_) {}
})();
