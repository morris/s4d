import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { DevServer } from '../src';

const devServer = new DevServer({
  port: 3000,
  webroot: 'test/fixture',
  spa: true,
});

const getClientScriptOriginal = devServer.getClientScript;

Object.assign(devServer, {
  getClientScript() {
    return getClientScriptOriginal
      .call(this)
      .replace(/navigator.webdriver/g, 'false');
  },
});

const indexOriginal = readFileSync('test/fixture/index.html', 'utf-8');
const styleOriginal = readFileSync('test/fixture/style.css', 'utf-8');

test.beforeAll(async () => {
  await devServer.start();
});

test.afterEach(() => {
  writeFileSync('test/fixture/index.html', indexOriginal);
  writeFileSync('test/fixture/style.css', styleOriginal);
});

test.afterAll(async () => {
  await devServer.close();
});

test('Serves fixture', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await expect(page.locator('h1')).toHaveText('Hello, World!');
});

test('Serves index.html for non-existing paths', async ({ page }) => {
  await page.goto('http://localhost:3000/other');

  await expect(page.locator('h1')).toHaveText('Hello, World!');
});

test('Causes reload when index.html is modified', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await expect(page.locator('h1')).toHaveText('Hello, World!');
  await page.locator('[name=testInput]').fill('This clears because of reload');

  writeFileSync(
    'test/fixture/index.html',
    indexOriginal.replace(/Hello, World!/g, 'Hello, Test!'),
  );

  await expect(page.locator('h1')).toHaveText('Hello, Test!');
  await expect(page.locator('[name=testInput]')).toHaveValue('');
});

test('Causes reload for non-existing paths when index.html is modified', async ({
  page,
}) => {
  await page.goto('http://localhost:3000/other');

  await expect(page.locator('h1')).toHaveText('Hello, World!');
  await page.locator('[name=testInput]').fill('This clears because of reload');

  writeFileSync(
    'test/fixture/index.html',
    indexOriginal.replace(/Hello, World!/g, 'Hello, Test!'),
  );

  await expect(page.locator('h1')).toHaveText('Hello, Test!');
  await expect(page.locator('[name=testInput]')).toHaveValue('');
});

test('Hot reloads CSS when modified', async ({ page }) => {
  await page.goto('http://localhost:3000');

  await page.locator('[name=testInput]').fill('This stays');

  writeFileSync(
    'test/fixture/style.css',
    styleOriginal + '\nh1 { display: none }',
  );

  await expect(page.locator('h1')).toBeVisible({ visible: false });
  await expect(page.locator('[name=testInput]')).toHaveValue('This stays');
});
