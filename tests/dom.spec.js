import { test, expect } from '@playwright/test';
import { captureDOM } from '../extension/dom.js';

test('captures short math and orders nested answer tiles visually', async ({ page }) => {
  await page.setContent(`<style>.answers{display:grid;grid-template-columns:1fr 1fr}.answerContainer{height:90px}</style>
    <div class="styles_questionText_123">3x9</div><div class="answers">
    <button class="answerContainer"><span class="answerText">32</span></button>
    <button class="answerContainer"><span class="answerText">44</span></button>
    <button class="answerContainer"><span class="answerText">27</span></button>
    <button class="answerContainer"><span class="answerText">28</span></button></div>`);
  expect(await page.evaluate(captureDOM)).toMatchObject({ question: '3x9', options: ['32', '44', '27', '28'] });
});

test('reads wrapped question and answers without hidden or private content', async ({ page }) => {
  await page.setContent(`<nav><button>Home</button><button>Account</button></nav>
    <div data-question>What is <span>encrypted output</span> called?<span hidden>secret</span><input value="private"></div>
    <div data-answer>Cipher<span>text</span></div><div data-answer>Plaintext</div>
    <div data-answer style="display:none">Hidden</div><div style="opacity:0"><div data-answer>Invisible parent</div></div><div data-answer style="position:absolute;top:3000px">Offscreen</div>
    <button>Press Anywhere to Continue</button>`);
  const result = await page.evaluate(captureDOM);
  expect(result).toMatchObject({ question: 'What is encrypted output called?', options: ['Ciphertext', 'Plaintext'] });
  expect(result.raw_text).not.toMatch(/secret|private|Home|Hidden|Offscreen|Invisible/);
});

test('fallback recognizes arithmetic and visible buttons while ignoring navigation', async ({ page }) => {
  await page.setContent('<nav><button>Home</button></nav><p>6 × 4</p><button>24</button><button>18</button><button>21</button><button>14</button><button>Continue</button>');
  expect(await page.evaluate(captureDOM)).toMatchObject({ question: '6 × 4', options: ['24', '18', '21', '14'] });
});

test('reads open shadow-root question and choices', async ({ page }) => {
  await page.setContent('<div id="quiz"></div>');
  await page.evaluate(() => { document.querySelector('#quiz').attachShadow({ mode: 'open' }).innerHTML = '<h2>Output of encryption?</h2><button>Ciphertext</button><button>Plaintext</button>'; });
  expect(await page.evaluate(captureDOM)).toMatchObject({ question: 'Output of encryption?', options: ['Ciphertext', 'Plaintext'] });
});

test('answer labels follow visual order when CSS reorders DOM nodes', async ({ page }) => {
  await page.setContent(`<style>.choices{display:grid;grid-template-columns:1fr 1fr}.choice{height:80px}</style>
    <h2>Which is correct?</h2><div class="choices">
    <button class="choice" style="order:3">Third</button>
    <button class="choice" style="order:1">First</button>
    <button class="choice" style="order:4">Fourth</button>
    <button class="choice" style="order:2">Second</button></div>`);
  expect((await page.evaluate(captureDOM)).options).toEqual(['First', 'Second', 'Third', 'Fourth']);
});

test('canvas and missing or duplicate choices require manual correction', async ({ page }) => {
  for (const html of ['<canvas width="600" height="400"></canvas>', '<h2>Question?</h2><button>one</button>', '<h2>Question?</h2><button>one</button><button>one</button>']) {
    await page.setContent(html);
    expect(await page.evaluate(captureDOM)).toMatchObject({ question: '', options: [], error: expect.stringContaining('Image mode') });
  }
});
