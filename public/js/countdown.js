'use strict';
(function () {
  var box = document.getElementById('countdown');
  if (!box) return;
  var end = Date.parse(box.getAttribute('data-launch'));
  if (isNaN(end)) return;
  var parts = {};
  ['d', 'h', 'm', 's'].forEach(function (k) { parts[k] = box.querySelector('[data-u="' + k + '"]'); });
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function tick() {
    var left = Math.max(0, Math.floor((end - Date.now()) / 1000));
    parts.d.textContent = Math.floor(left / 86400);
    parts.h.textContent = pad(Math.floor(left / 3600) % 24);
    parts.m.textContent = pad(Math.floor(left / 60) % 60);
    parts.s.textContent = pad(left % 60);
    if (left > 0) setTimeout(tick, 1000);
  }
  tick();
})();
