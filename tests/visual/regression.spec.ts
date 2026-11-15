import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const SCREENS = [
  { name: 'dashboard', url: '/' },
  { name: 'media-inspector', url: '/tools/inspector' },
  { name: 'video-muter', url: '/tools/muter' },
  { name: 'hevc-compressor', url: '/tools/hevc' },
  { name: 'universal-converter', url: '/tools/converter' },
  { name: 'youtube-downloader', url: '/tools/youtube' },
  { name: 'audio-trimmer', url: '/tools/trimmer' },
  { name: 'spotify-converter', url: '/tools/spotify' }
];

test.describe('Visual Regression Suite', () => {
  for (const screen of SCREENS) {
    test(`baseline match for ${screen.name}`, async ({ page }, testInfo) => {
      const res = await page.goto(`http://localhost:3000${screen.url}`);
      if (res?.status() === 404) {
        test.skip();
        return;
      }

      const screenshot = await page.screenshot();
      const baselinePath = path.join(__dirname, `../screenshots/baseline/${screen.name}.png`);
      
      const shouldUpdate = testInfo.config.updateSnapshots === 'all' || process.env.UPDATE_SNAPSHOTS === 'true' || !!process.env.UPDATE_SNAPSHOTS;

      if (!fs.existsSync(baselinePath)) {
        fs.writeFileSync(baselinePath, screenshot);
        console.log(`Created new baseline for ${screen.name}`);
        return;
      }
      
      const baselineBuffer = fs.readFileSync(baselinePath);
      const baseline = PNG.sync.read(baselineBuffer);
      const current = PNG.sync.read(screenshot);
      
      const width = Math.min(baseline.width, current.width);
      const height = Math.min(baseline.height, current.height);
      const diff = new PNG({ width, height });
      
      if (baseline.width === current.width && baseline.height === current.height) {
        const numDiffPixels = pixelmatch(baseline.data, current.data, diff.data, width, height, { threshold: 0.1 });
        
        if (numDiffPixels > 0) {
          const diffPath = path.join(__dirname, `../screenshots/diff-${screen.name}.png`);
          fs.writeFileSync(diffPath, PNG.sync.write(diff));
          
          if (shouldUpdate) {
            fs.writeFileSync(baselinePath, screenshot);
            console.log(`Diff found for ${screen.name} (${numDiffPixels} pixels). Baseline updated.`);
          } else {
            console.log(`Diff found for ${screen.name} (${numDiffPixels} pixels). Baseline NOT updated.`);
            expect(numDiffPixels).toBe(0);
          }
        }
      } else {
        if (shouldUpdate) {
          fs.writeFileSync(baselinePath, screenshot); 
          console.log(`Dimension mismatch. Baseline updated.`);
        } else {
          expect(`${current.width}x${current.height}`).toBe(`${baseline.width}x${baseline.height}`);
        }
      }
    });
  }
});
