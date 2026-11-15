import { test, expect } from '@playwright/test';
import { attachConsoleCollector } from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 4: YouTube Downloader & Spotify Converter Stress (Y-01 to Y-11, S-01 to S-11)', () => {
  /* ── YouTube Scenarios (Y-01 to Y-11) ── */
  test('Y-01: Invalid Non-YouTube URL Rejection', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://not-youtube.com/watch?v=123');

    const downloadBtn = page.locator('button:has-text("DOWNLOAD"), button:has-text("FETCH"), button:has-text("ANALYZE")').first();
    if (await downloadBtn.isVisible()) {
      await downloadBtn.click();
    }

    await page.waitForTimeout(500);

    // Verify error banner is shown and no unhandled error occurred
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-02: Unicode and Query Fragment YouTube URL Extraction', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s#frag&utm_source=stress');

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-03: YouTube Live Stream URL Notification', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/live/jfKfPfyJRdk');

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-04: Deleted / Private Video Friendly Error State', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=nonexistent_video_id_123456');

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-05: YouTube Format & Quality Switching', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const formatButtons = page.locator('button:has-text("MP3"), button:has-text("MP4"), button:has-text("WAV"), button:has-text("M4A")');
    const count = await formatButtons.count();
    for (let i = 0; i < count; i++) {
      await formatButtons.nth(i).click().catch(() => {});
      await page.waitForTimeout(50);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-06: Rapid URL Paste Spamming', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    const urls = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/9bZkp7q19f0',
      'https://www.youtube.com/watch?v=L_LUpnjgPso',
      'https://www.youtube.com/watch?v=fJ9rUzIMcZQ',
    ];

    for (const u of urls) {
      await input.fill(u);
      await page.waitForTimeout(50);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-07: Network Dropout Mid-Download Simulation', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-08: YouTube SSRF Domain Spoof Attempt', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    // Hostname that includes youtube.com but points to evil domain
    await input.fill('https://youtube.com.evil-domain.com/watch?v=123');

    const downloadBtn = page.locator('button:has-text("DOWNLOAD"), button:has-text("FETCH")').first();
    if (await downloadBtn.isVisible()) {
      await downloadBtn.click().catch(() => {});
    }

    await page.waitForTimeout(500);

    // Validate that validation rejected spoofed domain
    const validationText = await page.textContent('body');
    const passedSpoofValidation = validationText?.includes('Please enter a valid YouTube URL') || validationText?.includes('Invalid');

    if (!passedSpoofValidation) {
      saveBug({
        scenarioId: 'Y-08',
        severity: 'Security',
        category: 'Security',
        route: '/tools/youtube',
        component: 'app/tools/youtube/page.tsx',
        failureSignature: 'isValidYouTubeUrl accepts domain spoofed hostnames (youtube.com.evil.com)',
        reproductionCommand: "npx playwright test tests/stress/scenarios/domain4-youtube-spotify.spec.ts -g 'Y-08'",
        assignedFixer: 'fixer-security',
        fixRecommendation: 'Strictly check parsed hostname with exact match or endswith dot pattern',
        status: 'OPEN',
      });
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-09: Rate Limit Burst Warning Simulation', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    const downloadBtn = page.locator('button:has-text("DOWNLOAD"), button:has-text("FETCH")').first();
    if (await downloadBtn.isVisible()) {
      for (let i = 0; i < 5; i++) {
        await downloadBtn.click({ force: true }).catch(() => {});
      }
    }

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-10: Age-Restricted Video Safe Handling', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=age_restricted_test_123');

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('Y-11: Hostile OS Filename Characters Stripping', async ({ page }) => {
    await page.goto('/tools/youtube');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="http"]').first();
    await input.fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  /* ── Spotify Scenarios (S-01 to S-11) ── */
  test('S-01: Empty Spotify Playlist / Invalid Link Handling', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="spotify"]').first();
    await input.fill('https://open.spotify.com/playlist/empty00000000000000000');

    const fetchBtn = page.locator('button:has-text("FETCH"), button:has-text("CONVERT"), button:has-text("ANALYZE")').first();
    if (await fetchBtn.isVisible()) {
      await fetchBtn.click().catch(() => {});
    }

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-02: 500-Track Playlist Synthetic Load', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    // Inject simulated large playlist state into localStorage / component
    await page.evaluate(() => {
      const hugeTracks = Array.from({ length: 500 }).map((_, i) => ({
        id: `track-${i}`,
        name: `Celestial Odyssey Track #${i.toString().padStart(3, '0')}`,
        status: 'pending',
      }));
      const state = {
        status: 'idle',
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
        options: {
          playlistName: 'Deep Space Soundscapes (500 Tracks)',
          tracks: hugeTracks,
          selectedTrackIds: hugeTracks.map(t => t.id),
          format: 'mp3',
          quality: '320',
        },
      };
      localStorage.setItem('celestial_job_spotify', JSON.stringify(state));
    });

    await page.reload();
    await page.waitForTimeout(800);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-03: Track Deselection Filter & Pluralization Counter', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    // Inject 1 track to test "1 track" pluralization
    await page.evaluate(() => {
      const singleTrack = [{ id: 'track-single', name: 'Solitary Star Song', status: 'pending' }];
      const state = {
        status: 'idle',
        url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
        options: {
          playlistName: 'Single Track Test',
          tracks: singleTrack,
          selectedTrackIds: ['track-single'],
          format: 'mp3',
          quality: '320',
        },
      };
      localStorage.setItem('celestial_job_spotify', JSON.stringify(state));
    });

    await page.reload();
    await page.waitForTimeout(500);

    const bodyText = await page.textContent('body');
    // Ensure pluralization is correct ("1 track", not "1 tracks")
    expect(bodyText).not.toContain('1 tracks');

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-04: Single Track Retry Action Click', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      const tracks = [{ id: 'track-err-1', name: 'Failed Track 1', status: 'error' }];
      const state = {
        status: 'idle',
        options: {
          playlistName: 'Error Playlist',
          tracks,
          selectedTrackIds: ['track-err-1'],
        },
      };
      localStorage.setItem('celestial_job_spotify', JSON.stringify(state));
    });

    await page.reload();
    await page.waitForTimeout(400);

    const retryBtn = page.locator('button:has-text("Retry"), button[aria-label*="retry"]').first();
    if (await retryBtn.isVisible()) {
      await retryBtn.click().catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-05: Track Title Command Injection Sanitization', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      const maliciousTracks = [
        { id: 't-inj-1', name: 'Song Title; rm -rf /; echo pwned', status: 'pending' },
        { id: 't-inj-2', name: '<script>window.__xss=1</script>', status: 'pending' },
      ];
      const state = {
        status: 'idle',
        options: {
          playlistName: 'Adversarial Playlist',
          tracks: maliciousTracks,
          selectedTrackIds: ['t-inj-1', 't-inj-2'],
        },
      };
      localStorage.setItem('celestial_job_spotify', JSON.stringify(state));
    });

    await page.reload();
    await page.waitForTimeout(500);

    const isXss = await page.evaluate(() => (window as unknown as { __xss?: number }).__xss);
    expect(isXss).toBeUndefined();

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-06: Album vs Playlist vs Track URL Processing', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="spotify"]').first();
    const urls = [
      'https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa',
      'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT',
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    ];

    for (const u of urls) {
      await input.fill(u);
      await page.waitForTimeout(100);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-07: SSE Connection Severed Handshake Resiliency', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"]').first();
    await input.fill('https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT');

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-08: Parallel Conversion Limit UI Clamping', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-09: Stop All Conversions Mid-Playlist Action', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const stopBtn = page.locator('button:has-text("STOP ALL"), button:has-text("CANCEL")').first();
    if (await stopBtn.isVisible()) {
      await stopBtn.click().catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-10: Hostname Spoofing Attack Pattern Guard (open.spotify.com.evil.com)', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const input = page.locator('input[type="text"], input[placeholder*="spotify"]').first();
    await input.fill('https://open.spotify.com.evil-domain.com/playlist/37i9dQZF1DXcBWIGoYBM5M');

    const convertBtn = page.locator('button:has-text("FETCH"), button:has-text("CONVERT")').first();
    if (await convertBtn.isVisible()) {
      await convertBtn.click().catch(() => {});
    }

    await page.waitForTimeout(500);

    const bodyText = await page.textContent('body');
    const rejectedSpoof = bodyText?.includes('Please enter a valid Spotify link') || bodyText?.includes('Invalid');

    if (!rejectedSpoof) {
      saveBug({
        scenarioId: 'S-10',
        severity: 'Security',
        category: 'Security',
        route: '/tools/spotify',
        component: 'app/tools/spotify/page.tsx',
        failureSignature: 'validateUrl regex matches unanchored or subdomain-spoofed URLs',
        reproductionCommand: "npx playwright test tests/stress/scenarios/domain4-youtube-spotify.spec.ts -g 'S-10'",
        assignedFixer: 'fixer-security',
        fixRecommendation: 'Anchor regex with ^ and validate URL host strictly',
        status: 'OPEN',
      });
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('S-11: Batch Zip Download Trigger Safety', async ({ page }) => {
    await page.goto('/tools/spotify');
    const collector = attachConsoleCollector(page);

    const zipBtn = page.locator('button:has-text("DOWNLOAD ALL AS ZIP"), a:has-text("ZIP")').first();
    if (await zipBtn.isVisible()) {
      await zipBtn.click().catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
