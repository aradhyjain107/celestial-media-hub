'use strict';

function runLoop(durationMs) {
  var start = performance.now();
  var acc = 1.0001;
  var intAcc = 0x12345678;
  var ops = 0;

  while (performance.now() - start < durationMs) {
    for (var i = 0; i < 50000; i++) {
      intAcc = (Math.imul(intAcc ^ (i + 1), 2654435761) >>> 0);
      acc = (acc * 1.0000001 + (intAcc & 255) * 0.0001) % 1000000;
    }
    ops += 50000;
  }

  return {
    ops: ops,
    durationMs: Math.max(1, performance.now() - start),
    checksum: acc + intAcc,
  };
}

// Warm up V8/SpiderMonkey/JavaScriptCore JIT before timed measurement starts.
runLoop(10);
self.postMessage({ type: 'ready' });

self.onmessage = function (event) {
  var data = event.data || {};
  if (data.type !== 'run') return;
  var durationMs = typeof data.durationMs === 'number' && data.durationMs > 0 ? data.durationMs : 60;
  var result = runLoop(durationMs);
  self.postMessage({
    type: 'done',
    ops: result.ops,
    durationMs: result.durationMs,
    checksum: result.checksum,
  });
};
