// A command-line driver for the app on a connected Android phone, for agent
// sessions and quick manual checks (docs/11-verification.md §3.5b). Elements are
// found over the WebView devtools protocol; touches go through real Android
// input (`adb shell input`), so they arrive as touch pointers exactly like a
// finger — mouse clicks over CDP would hide touch-only bugs.
//
//   node scripts/device.mjs start [--clear]   launch (or relaunch) the app
//   node scripts/device.mjs ui [filter]        visible controls with @refs
//   node scripts/device.mjs tap <target>       tap the center of a target
//   node scripts/device.mjs long <target>      long-press (700 ms)
//   node scripts/device.mjs drag <from> <to> [ms]  touch drag
//   node scripts/device.mjs type <text>        insert text into the focus
//   node scripts/device.mjs key back|enter|del press a hardware/IME key
//   node scripts/device.mjs shot [name] [width]  screenshot of the whole phone
//                                              screen, scaled (default 540 px)
//   node scripts/device.mjs eval <js>          evaluate in the page, print JSON
//
// A target is `@N` (a ref printed by `ui`), `x,y` (CSS pixels), `text=…`
// (visible text), `role=button[name]`, or any CSS selector.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';

const ADB =
  process.env.ADB ??
  `${process.env.LOCALAPPDATA}\\Android\\Sdk\\platform-tools\\adb.exe`;
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const PACKAGE = 'com.chayote.app';
const PORT = 9222;

const adb = (...args) =>
  execFileSync(ADB, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const [command, ...args] = process.argv.slice(2);

function appPid() {
  try {
    return adb('shell', 'pidof', PACKAGE).split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function launch(clear) {
  if (clear) {
    adb('shell', 'pm', 'clear', PACKAGE);
  } else {
    adb('shell', 'am', 'force-stop', PACKAGE);
  }
  adb('shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1');
  for (let attempt = 0; attempt < 30 && !appPid(); attempt += 1) {
    await sleep(200);
  }
  await sleep(1500);
}

async function connect() {
  let pid = appPid();
  if (!pid) {
    await launch(false);
    pid = appPid();
  }
  if (!pid) {
    throw new Error(`${PACKAGE} is not running and did not start`);
  }
  adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
      const page = browser.contexts()[0]?.pages()[0];
      if (page) {
        return { browser, page };
      }
      await browser.close();
    } catch {
      // The socket comes up a moment after the process.
    }
    await sleep(300);
  }
  throw new Error('the WebView devtools socket did not come up');
}

/** CSS pixel → device pixel (the WebView fills the screen edge to edge). */
async function scaleOf(page) {
  return page.evaluate(() => window.devicePixelRatio);
}

async function resolve(page, target) {
  const coords = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(target);
  if (coords) {
    return { x: Number(coords[1]), y: Number(coords[2]) };
  }
  let locator;
  if (target.startsWith('@')) {
    locator = page.locator(`[data-agent-ref="${target.slice(1)}"]`);
  } else if (target.startsWith('text=')) {
    locator = page.getByText(target.slice(5), { exact: false });
  } else if (target.startsWith('role=')) {
    const match = /^role=([a-z]+)(?:\[(.*)\])?$/.exec(target);
    if (!match) {
      throw new Error(`bad role target: ${target}`);
    }
    locator = page.getByRole(match[1], match[2] ? { name: match[2] } : {});
  } else {
    locator = page.locator(target);
  }
  const count = await locator.count();
  if (count === 0) {
    throw new Error(`no element for ${target} (run \`ui\` again: refs go stale)`);
  }
  const box = await locator.last().boundingBox();
  if (!box) {
    throw new Error(`${target} is not visible`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function touch(page, ...points) {
  const scale = await scaleOf(page);
  return points.map(({ x, y }) => [Math.round(x * scale), Math.round(y * scale)]);
}

/** The visible controls and text of the page, one line each, with refs. */
async function dump(page, filter) {
  const lines = await page.evaluate((needle) => {
    const out = [];
    let ref = 0;
    document.querySelectorAll('[data-agent-ref]').forEach((node) => {
      node.removeAttribute('data-agent-ref');
    });
    const interactive =
      'button, a[href], input, textarea, select, [role="button"], [role="menuitem"], [role="option"], [role="treeitem"], [role="dialog"], [role="status"], [tabindex]:not([tabindex="-1"])';
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) {
        return null;
      }
      if (box.bottom < 0 || box.top > innerHeight || box.right < 0 || box.left > innerWidth) {
        return null;
      }
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.opacity === '0') {
        return null;
      }
      return box;
    };
    for (const node of document.querySelectorAll(interactive)) {
      const box = visible(node);
      if (!box) {
        continue;
      }
      const role = node.getAttribute('role') ?? node.tagName.toLowerCase();
      const label =
        node.getAttribute('aria-label') ??
        (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
          ? `${node.placeholder ? `[${node.placeholder}] ` : ''}${JSON.stringify(node.value)}`
          : (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70));
      const state = [
        node.getAttribute('aria-selected') === 'true' ? 'selected' : '',
        node.getAttribute('aria-expanded') === 'true' ? 'expanded' : '',
        node.hasAttribute('disabled') ? 'disabled' : '',
        document.activeElement === node ? 'focused' : '',
      ]
        .filter(Boolean)
        .join(',');
      const line = `${role} "${label}"${state ? ` (${state})` : ''} @${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
      if (needle && !line.toLowerCase().includes(needle.toLowerCase())) {
        continue;
      }
      ref += 1;
      node.setAttribute('data-agent-ref', String(ref));
      out.push(`@${ref} ${line}`);
    }
    return [`viewport ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} theme ${document.documentElement.dataset.theme}`, ...out];
  }, filter ?? '');
  return lines.join('\n');
}

async function screenshot(name = 'device', width = 540) {
  mkdirSync('shots', { recursive: true });
  const raw = `shots/${name}.raw.png`;
  const out = `shots/${name}.jpg`;
  const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(raw, png);
  execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-i', raw, '-vf', `scale=${width}:-1`, '-q:v', '4', out]);
  rmSync(raw);
  return out;
}

async function main() {
  if (command === 'start') {
    await launch(args.includes('--clear'));
    console.log(`started ${PACKAGE} (pid ${appPid()})`);
    return;
  }
  if (command === 'shot') {
    console.log(await screenshot(args[0], args[1] ? Number(args[1]) : undefined));
    return;
  }
  if (command === 'key') {
    const codes = { back: 4, enter: 66, del: 67, tab: 61, escape: 111, home: 3 };
    const code = codes[args[0]] ?? args[0];
    adb('shell', 'input', 'keyevent', String(code));
    await sleep(400);
    console.log(`key ${args[0]}`);
    return;
  }

  const { browser, page } = await connect();
  try {
    switch (command) {
      case 'ui':
        console.log(await dump(page, args[0]));
        break;
      case 'tap': {
        const [[x, y]] = await touch(page, await resolve(page, args[0]));
        adb('shell', 'input', 'tap', String(x), String(y));
        await sleep(350);
        console.log(`tap ${args[0]} → ${x},${y}`);
        break;
      }
      case 'long': {
        const [[x, y]] = await touch(page, await resolve(page, args[0]));
        adb('shell', 'input', 'swipe', String(x), String(y), String(x), String(y), '700');
        await sleep(400);
        console.log(`long-press ${args[0]} → ${x},${y}`);
        break;
      }
      case 'drag': {
        const from = await resolve(page, args[0]);
        const to = await resolve(page, args[1]);
        const [[x1, y1], [x2, y2]] = await touch(page, from, to);
        adb('shell', 'input', 'swipe', `${x1}`, `${y1}`, `${x2}`, `${y2}`, args[2] ?? '400');
        await sleep(400);
        console.log(`drag ${x1},${y1} → ${x2},${y2}`);
        break;
      }
      case 'type': {
        const session = await page.context().newCDPSession(page);
        await session.send('Input.insertText', { text: args.join(' ') });
        await sleep(200);
        console.log('typed');
        break;
      }
      case 'eval': {
        const value = await page.evaluate(`(async () => (${args.join(' ')}))()`);
        console.log(JSON.stringify(value, null, 2));
        break;
      }
      default:
        console.log('usage: node scripts/device.mjs start|ui|tap|long|drag|type|key|shot|eval …');
        process.exitCode = 2;
    }
  } finally {
    // Disconnect only: closing would not kill the app, but be explicit.
    await browser.close().catch(() => undefined);
  }
}

await main();
