import { test, expect } from 'vitest';
import http from 'http';

test('check connection to localhost:3000', () => {
  return new Promise<void>((resolve) => {
    console.log('--- START CONNECTION CHECK ---');
    
    let completed = 0;
    const urls = [
      'http://127.0.0.1:3000/',
      'http://[::1]:3000/',
      'http://localhost:3000/'
    ];

    urls.forEach((url) => {
      const req = http.get(url, (res) => {
        console.log(`[CONN SUCCESS] ${url} -> Status ${res.statusCode}`);
        res.resume();
        completed++;
        if (completed === urls.length) resolve();
      });

      req.on('error', (err) => {
        console.log(`[CONN ERROR] ${url} -> Error: ${err.message}`);
        completed++;
        if (completed === urls.length) resolve();
      });
    });
  });
});
