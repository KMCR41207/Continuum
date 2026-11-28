import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const script = await readFile(new URL('../../apps/browser-extension/src/content/capture.js', import.meta.url), 'utf8');

test('page capture reads turn fallback and automatically captures existing and changed messages', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Test chat - ChatGPT</title><main><article data-turn="user" data-testid="conversation-turn-1"><div data-testid="user-message">Question</div></article><article data-turn="assistant" data-testid="conversation-turn-2"><div class="markdown">Answer</div></article></main>' }));
    await page.addInitScript(() => {
      window.captures = [];
      window.chrome.runtime = {
        sendMessage(message, callback) {
          if (message.type === 'status') callback({ connected: true, active: true, auto: true, tokenStale: true });
          else { window.captures.push(message); callback({ status: 'Saved' }); }
        },
        onMessage: { addListener() {} },
      };
    });
    await page.goto('https://chatgpt.com/c/test');
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => window.captures.length === 1, null, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => window.captures[0].messages.map(({ role, content }) => ({ role, content }))), [
      { role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' },
    ]);
    await page.locator('.markdown').evaluate(el => { el.textContent = 'Updated answer'; });
    await page.waitForFunction(() => window.captures.length === 2, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.captures[1].messages[1].content), 'Updated answer');
  } finally { await browser.close(); }
});

test('inspector close control stays available and Escape dismisses it', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<main><p>Example message</p></main>' }));
    await page.addInitScript(() => {
      window.chrome.runtime = {
        sendMessage(_message, callback) { callback({ connected: true, active: true, auto: false }); },
        onMessage: { addListener(fn) { window.inspectorListener = fn; } },
      };
    });
    await page.goto('https://chatgpt.com/c/test');
    await page.addScriptTag({ content: script });
    async function openInspector() {
      await page.evaluate(() => window.inspectorListener({ type: 'identify_message' }, {}, () => {}));
      await page.locator('main p').click();
    }
    await openInspector();
    const panel = page.locator('#continuum-inspector');
    await panel.locator('pre').evaluate(el => { el.textContent = 'line\n'.repeat(300); el.scrollTop = el.scrollHeight; });
    assert.equal(await panel.getByRole('button', { name: 'Close' }).isVisible(), true);
    await panel.getByRole('button', { name: 'Close' }).click();
    assert.equal(await panel.count(), 0);
    await openInspector();
    await page.keyboard.press('Escape');
    assert.equal(await panel.count(), 0);
  } finally { await browser.close(); }
});

test('new ChatGPT layout captures users and responses in order and updates automatically', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Chat</title><main><div data-user-message-bubble><div class="text-size-chat whitespace-pre-wrap">Question</div></div><div data-dil-response><div data-testid="chatgpt-writing-block"><div data-markdown-copy-content>Answer</div></div></div></main>' }));
    await page.addInitScript(() => {
      window.captures = [];
      window.chrome.runtime = {
        sendMessage(message, callback) {
          if (message.type === 'status') callback({ connected: true, active: true, auto: true });
          else { window.captures.push(message); callback({ status: 'Saved' }); }
        },
        onMessage: { addListener() {} },
      };
    });
    await page.goto('https://chatgpt.com/c/test');
    await page.addScriptTag({ content: script });
    await page.waitForFunction(() => window.captures.length === 1, null, { timeout: 8000 });
    assert.deepEqual(await page.evaluate(() => window.captures[0].messages.map(({role, content}) => ({role, content}))), [
      { role: 'user', content: 'Question' }, { role: 'assistant', content: 'Answer' },
    ]);
    await page.locator('[data-markdown-copy-content]').evaluate(el => { el.textContent = 'Updated answer'; });
    await page.waitForFunction(() => window.captures.length === 2, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.captures[1].messages[1].content), 'Updated answer');
  } finally { await browser.close(); }
});
