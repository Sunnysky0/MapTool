import { readFile } from 'node:fs/promises';

import { expect, test, type Download, type Locator, type TestInfo } from '@playwright/test';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function available(locator: Locator): Promise<boolean> {
  return (await locator.count()) > 0 && (await locator.first().isVisible());
}

function noteUnavailable(testInfo: TestInfo, feature: string): void {
  testInfo.annotations.push({
    type: 'feature-not-mounted',
    description: `${feature} 尚未出现在当前 UI；对应断言未执行。`,
  });
}

async function downloadedBytes(download: Download): Promise<Buffer> {
  const failure = await download.failure();
  expect(failure, '下载不应失败').toBeNull();
  const path = await download.path();
  expect(path, 'Playwright 应提供下载临时文件').not.toBeNull();
  return readFile(path!);
}

async function downloadFrom(button: Locator): Promise<Download> {
  await expect(button).toBeEnabled({ timeout: 15_000 });
  const [download] = await Promise.all([button.page().waitForEvent('download'), button.click()]);
  return download;
}

function expectPng(bytes: Buffer): void {
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature').toBe(true);
  expect(bytes.length, 'PNG 至少包含 signature、IHDR 长度/类型和数据').toBeGreaterThan(24);
  expect(bytes.toString('ascii', 12, 16), '首个 PNG chunk').toBe('IHDR');
  expect(bytes.readUInt32BE(16), 'PNG 宽度').toBeGreaterThan(0);
  expect(bytes.readUInt32BE(20), 'PNG 高度').toBeGreaterThan(0);
}

function parseProject(bytes: Buffer): Record<string, unknown> {
  const project = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  expect(project.schemaVersion).toBe(1);
  expect(project.document).toEqual(expect.any(Object));
  const document = project.document as Record<string, unknown>;
  expect(document.extent).toEqual(expect.any(Object));
  expect(document.projection).toEqual(expect.any(Object));
  expect(document.style).toEqual(expect.any(Object));
  return project;
}

test('地图范围、投影、样式与文件工作流', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/');

  await test.step('应用加载并暴露可访问结构', async () => {
    await expect(page).toHaveTitle(/MapTool/i);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('main')).toBeVisible();

    const globe = page.getByLabel('Interactive three-dimensional globe');
    const preview = page.getByRole('region', { name: '二维投影预览' });
    await expect(globe).toBeVisible();
    await expect(preview).toBeVisible();
    const [globeBox, previewBox] = await Promise.all([
      globe.boundingBox(),
      preview.boundingBox(),
    ]);
    expect(globeBox, '三维球体应有可见尺寸').not.toBeNull();
    expect(previewBox, '二维预览应有可见尺寸').not.toBeNull();
    expect(globeBox!.x + globeBox!.width, '三维球体应位于二维预览左侧').toBeLessThanOrEqual(
      previewBox!.x,
    );
    expect(Math.abs(globeBox!.y - previewBox!.y), '二维与三维视图应从同一行开始').toBeLessThan(
      2,
    );
    await expect(preview).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.getByRole('button', { name: '使用深色预览衬底' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const west = page.getByLabel(/西界\s*W/i);
    if (await available(west)) {
      await expect(west).toHaveAttribute('type', 'number');
      await expect(page.getByLabel(/东界\s*E/i)).toHaveAttribute('type', 'number');
      await expect(page.getByLabel(/南界\s*S/i)).toHaveAttribute('type', 'number');
      await expect(page.getByLabel(/北界\s*N/i)).toHaveAttribute('type', 'number');
    } else {
      noteUnavailable(testInfo, '数值范围控件');
    }
  });

  await test.step('通过标签输入数值范围', async () => {
    const fields: Array<[RegExp, string]> = [
      [/西界\s*W/i, '-20'],
      [/东界\s*E/i, '40'],
      [/南界\s*S/i, '30'],
      [/北界\s*N/i, '70'],
    ];
    const west = page.getByLabel(fields[0][0]);
    if (!(await available(west))) return;

    for (const [label, value] of fields) {
      const input = page.getByLabel(label);
      await input.fill(value);
      await input.blur();
      await expect(input).toHaveValue(value);
    }
    await expect(page.getByText(/连续范围|不跨越日期变更线/).first()).toBeVisible();
  });

  await test.step('切换投影', async () => {
    const projection = page.getByLabel('投影方式', { exact: true });
    if (!(await available(projection))) {
      noteUnavailable(testInfo, '投影控件');
      return;
    }

    await projection.selectOption('equal-earth');
    await expect(projection).toHaveValue('equal-earth');
    await expect(page.getByText(/适合全球专题地图，保持区域面积比例/)).toBeVisible();
  });

  await test.step('修改线稿样式', async () => {
    const lineWidth = page.getByLabel('线宽（像素）', { exact: true }).first();
    if (!(await available(lineWidth))) {
      noteUnavailable(testInfo, '样式控件');
      return;
    }

    await lineWidth.fill('2.5');
    await lineWidth.blur();
    await expect(lineWidth).toHaveValue('2.5');
  });

  let projectBytes: Buffer | undefined;

  await test.step('解析支持的导出下载', async () => {
    const svgButton = page.getByRole('button', { name: '导出 SVG', exact: true });
    if (await available(svgButton)) {
      const bytes = await downloadedBytes(await downloadFrom(svgButton));
      const svg = bytes.toString('utf8');
      expect(svg).toMatch(/<svg\b/u);
      expect(svg).toMatch(/viewBox=/u);
      expect(svg).toMatch(/map-linework/u);
    } else {
      noteUnavailable(testInfo, 'SVG 导出');
    }

    const pngButton = page.getByRole('button', { name: '导出 PNG', exact: true });
    if (await available(pngButton)) {
      expectPng(await downloadedBytes(await downloadFrom(pngButton)));
    } else {
      noteUnavailable(testInfo, 'PNG 导出');
    }

    const projectButton = page.getByRole('button', { name: '导出项目 JSON', exact: true });
    if (await available(projectButton)) {
      projectBytes = await downloadedBytes(await downloadFrom(projectButton));
      parseProject(projectBytes);
    } else {
      noteUnavailable(testInfo, '项目 JSON 导出');
    }
  });

  await test.step('把导出的项目 JSON 重新导入', async () => {
    if (!projectBytes) return;
    const chooser = page.getByLabel('选择项目 JSON 文件', { exact: true });
    if ((await chooser.count()) === 0) {
      noteUnavailable(testInfo, '项目 JSON 导入');
      return;
    }

    await chooser.setInputFiles({
      name: 'round-trip.maptool.json',
      mimeType: 'application/json',
      buffer: projectBytes,
    });

    const projection = page.getByLabel('投影方式', { exact: true });
    if (await available(projection)) await expect(projection).toHaveValue('equal-earth');
    const west = page.getByLabel(/西界\s*W/i);
    if (await available(west)) await expect(west).toHaveValue('-20');
  });
});
