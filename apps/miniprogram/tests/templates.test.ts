import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync('app.json', 'utf8'));
it.each(manifest.pages as string[])('%s uses data bindings for dynamic control directives', (page) => {
  const template = readFileSync(path.join(process.cwd(), `${page}.wxml`), 'utf8');
  const directives = [...template.matchAll(/wx:(?:if|elif|for)="([^"]*)"/g)];
  for (const [, expression] of directives) expect(expression).toMatch(/^\{\{[\s\S]+\}\}$/);
});
