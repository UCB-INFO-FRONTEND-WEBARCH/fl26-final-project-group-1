// Record the "take a rest" demo video: step the demo page one video frame at a time in headless Chrome on the GPU,
// and pipe the screenshots to ffmpeg (1920x1080, 30 fps, H.264). Start the dev server first (npm run dev).
//   node scripts/record_demo_rest.js --seed 11 [--out demo/qual/take-a-rest.mp4]
//   node scripts/record_demo_rest.js --seed 11 --stills 0,2,4,10 --out stills/   (PNGs at those seconds, no video)
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const seed = Number(option('seed', 1));
const out = option('out', 'demo/qual/take-a-rest.mp4');
const stills = option('stills', null)?.split(',').map(Number);
const url = `${option('url', 'http://127.0.0.1:5173/')}?demo=rest&seed=${seed}&record`;

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', error => console.error('page error:', error.message));
await page.goto(url);
await page.waitForFunction(() => window.rest_demo?.ready(), null, { timeout: 300_000, polling: 250 });
await page.evaluate(() => document.fonts.ready);
const fps = await page.evaluate(() => window.rest_demo.fps);

let encoder = null;
if (stills) await mkdir(out, { recursive: true });
else {
  encoder = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out],
  { stdio: ['pipe', 'inherit', 'inherit'] });
}
const last = stills ? Math.round(Math.max(...stills) * fps) : Infinity;
let report;
for (let index = 0; index <= last; index++) {
  report = await page.evaluate(frame => window.rest_demo.frame(frame), index);
  const wanted = stills?.find(time => Math.round(time * fps) === index);
  if (encoder) {
    if (!encoder.stdin.write(await page.screenshot({ type: 'png' }))) await new Promise(resolve => encoder.stdin.once('drain', resolve));
  } else if (wanted !== undefined) {
    await writeFile(`${out}/seed${seed}_${wanted.toFixed(1)}s.png`, await page.screenshot({ type: 'png' }));
  }
  if (index % (5 * fps) === 0) console.log(`${(index / fps).toFixed(0)} s · ${report.stage}`);
  if (report.stage === 'failed' || report.ended) break;
}
const frames = Math.round(report.time * fps) + 1;
if (encoder) {
  encoder.stdin.end();
  await new Promise((resolve, reject) => encoder.on('close', code => (code ? reject(new Error(`ffmpeg exited ${code}`)) : resolve())));
}
console.log(JSON.stringify({ seed, stage: report.stage, fell: report.stage === 'failed', frames, seconds: +(frames / fps).toFixed(2), out }));
await browser.close();
