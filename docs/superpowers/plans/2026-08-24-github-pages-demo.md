# GitHub Pages Public Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the existing 南京安心宠 React demo at `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/` without changing its local-only data model or Windows startup flow.

**Architecture:** A small pure function validates the Vite public base path, and `vite.config.ts` reads `VITE_PUBLIC_BASE` only for production deployment. A two-job GitHub Actions workflow validates and builds the app, uploads `apps/admin/dist` as the Pages artifact, and deploys it with GitHub's official Pages actions.

**Tech Stack:** React, TypeScript 5.9, Vite 8, Vitest 3, pnpm 10.15.0, Node.js 22, GitHub Actions, GitHub Pages

## Global Constraints

- The public site is a demo and must not accept real orders, payments, phone numbers, precise addresses, lock codes, or other sensitive data.
- Demo state remains in the visitor's browser `localStorage`; no remote data service is added.
- Local development remains available at `http://127.0.0.1:43123` through `start-local.cmd` and `pnpm dev`.
- The public base path is exactly `/nanjing-pet-care-marketplace/`.
- The deployment target is exactly `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/`.
- Use Node.js 22 and pnpm 10.15.0.
- Use only the minimum GitHub Pages permissions: `contents: read`, `pages: write`, and `id-token: write`.
- Do not add secrets, API keys, analytics, a database, payments, SMS, maps, or login.

---

### Task 1: Make the Vite base path explicit and testable

**Files:**
- Create: `apps/admin/src/config/publicBase.ts`
- Create: `apps/admin/src/config/publicBase.test.ts`
- Modify: `apps/admin/vite.config.ts`

**Interfaces:**
- Produces: `resolvePublicBase(value?: string): string`, returning `/` for an unset value and a validated leading-and-trailing-slash path for deployment.
- Consumes: `VITE_PUBLIC_BASE` from Vite's build environment; local development supplies no value and therefore keeps `/`.

- [ ] **Step 1: Write the failing public-base tests**

Create `apps/admin/src/config/publicBase.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolvePublicBase } from './publicBase';

describe('resolvePublicBase', () => {
  it('keeps local development at the site root', () => {
    expect(resolvePublicBase()).toBe('/');
    expect(resolvePublicBase('   ')).toBe('/');
  });

  it('accepts the GitHub Pages repository path', () => {
    expect(resolvePublicBase(' /nanjing-pet-care-marketplace/ ')).toBe(
      '/nanjing-pet-care-marketplace/',
    );
  });

  it.each(['nanjing-pet-care-marketplace/', '/nanjing-pet-care-marketplace'])(
    'rejects an unsafe base path: %s',
    (value) => {
      expect(() => resolvePublicBase(value)).toThrow(
        'VITE_PUBLIC_BASE must start and end with "/"',
      );
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/config/publicBase.test.ts
```

Expected: FAIL because `src/config/publicBase.ts` does not exist.

- [ ] **Step 3: Add the minimal base-path resolver**

Create `apps/admin/src/config/publicBase.ts`:

```ts
export function resolvePublicBase(value?: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    return '/';
  }

  if (!normalized.startsWith('/') || !normalized.endsWith('/')) {
    throw new Error('VITE_PUBLIC_BASE must start and end with "/"');
  }

  return normalized;
}
```

- [ ] **Step 4: Wire the resolver into Vite**

Replace `apps/admin/vite.config.ts` with:

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { resolvePublicBase } from './src/config/publicBase';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');

  return {
    base: resolvePublicBase(env.VITE_PUBLIC_BASE),
    plugins: [react()],
  };
});
```

- [ ] **Step 5: Run focused and type checks**

Run:

```powershell
pnpm --filter @pet/admin exec vitest run src/config/publicBase.test.ts
pnpm --filter @pet/admin typecheck
```

Expected: 4 resolver test cases pass and TypeScript exits with code 0.

- [ ] **Step 6: Commit the base-path change**

```powershell
git add apps/admin/src/config/publicBase.ts apps/admin/src/config/publicBase.test.ts apps/admin/vite.config.ts
git commit -m "feat: support GitHub Pages base path"
```

### Task 2: Add the validated GitHub Pages workflow

**Files:**
- Create: `.github/workflows/pages.yml`

**Interfaces:**
- Consumes: pushes to `main`, manual `workflow_dispatch`, the root `pnpm-lock.yaml`, and the root `packageManager` declaration.
- Produces: a `github-pages` artifact from `apps/admin/dist` and a deployment URL from `actions/deploy-pages`.

- [ ] **Step 1: Create the deployment workflow**

Create `.github/workflows/pages.yml`:

```yaml
name: Deploy public demo

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v6

      - name: Install pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.15.0
          run_install: false

      - name: Set up Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: pnpm-lock.yaml

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Type-check web app
        run: pnpm --filter @pet/admin typecheck

      - name: Test web app
        run: pnpm --filter @pet/admin test

      - name: Configure GitHub Pages
        uses: actions/configure-pages@v5

      - name: Build public demo
        run: pnpm build
        env:
          VITE_PUBLIC_BASE: /nanjing-pet-care-marketplace/

      - name: Upload GitHub Pages artifact
        uses: actions/upload-pages-artifact@v4
        with:
          path: apps/admin/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Check workflow structure locally**

Run:

```powershell
rg -n "actions/checkout@v6|pnpm/action-setup@v4|actions/setup-node@v7|actions/configure-pages@v5|actions/upload-pages-artifact@v4|actions/deploy-pages@v4|VITE_PUBLIC_BASE" .github/workflows/pages.yml
```

Expected: all seven required action/environment entries are printed once.

- [ ] **Step 3: Build with the Pages base and inspect the artifact**

Run:

```powershell
$env:VITE_PUBLIC_BASE='/nanjing-pet-care-marketplace/'
pnpm build
Remove-Item Env:VITE_PUBLIC_BASE
rg -n '/nanjing-pet-care-marketplace/assets/' apps/admin/dist/index.html
```

Expected: build exits with code 0 and `index.html` contains repository-prefixed CSS and JavaScript asset URLs.

- [ ] **Step 4: Commit the workflow**

```powershell
git add .github/workflows/pages.yml
git commit -m "ci: deploy public demo to GitHub Pages"
```

### Task 3: Document public use and re-run the product loop

**Files:**
- Modify: `README.md`
- Test: `apps/admin/e2e/service-loop.spec.ts`

**Interfaces:**
- Consumes: the fixed GitHub Pages URL and existing local startup instructions.
- Produces: one primary public-demo link plus explicit local-data and sensitive-information warnings.

- [ ] **Step 1: Add the public demo section above local instructions**

Insert this content after the README introduction and before `## 立即使用网页端`:

```markdown
## 在线体验

无需安装，直接打开：

<https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/>

在线页面是安全体验版：订单数据只保存在当前浏览器，不会提交到服务器。请勿填写真实手机号、精确住址、门锁密码、支付信息或其他敏感信息。
```

- [ ] **Step 2: Run the complete web verification**

Run:

```powershell
pnpm --filter @pet/admin typecheck
pnpm --filter @pet/admin test
pnpm build
pnpm --filter @pet/admin test:e2e
```

Expected: typecheck passes, all admin Vitest tests pass, the production build succeeds, and both Playwright flows pass.

- [ ] **Step 3: Confirm local startup remains unchanged**

Run:

```powershell
rg -n "43123|pnpm dev|start-local.cmd" README.md package.json start-local.cmd
```

Expected: the local URL, root development command, and Windows starter remain documented and configured.

- [ ] **Step 4: Commit the public documentation**

```powershell
git add README.md
git commit -m "docs: add public demo access"
```

### Task 4: Publish, enable Pages, and verify the live site

**Files:**
- Modify after successful publication: `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md` in the shared Obsidian Vault

**Interfaces:**
- Consumes: branch `feature/github-pages-demo`, GitHub repository settings, PR checks, and the Pages deployment workflow.
- Produces: a merged PR, an enabled GitHub Pages site, and a durable deployment record.

- [ ] **Step 1: Verify branch history and cleanliness**

Run:

```powershell
git diff --check origin/main...HEAD
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: no whitespace errors, no uncommitted files, and the design plus implementation commits appear above `origin/main`.

- [ ] **Step 2: Push the deployment branch**

Run:

```powershell
git push -u origin feature/github-pages-demo
```

Expected: GitHub reports the new branch and its compare URL.

- [ ] **Step 3: Create the deployment PR**

Create a PR from `feature/github-pages-demo` to `main` titled `ci: publish Nanjing pet care public demo`. The body must summarize the validated base path, Pages workflow, README link, and local-data safety boundary. Obtain action-time confirmation before creating the public PR.

Expected: the PR is open, reports no merge conflicts, and lists the design plus implementation commits.

- [ ] **Step 4: Enable GitHub Actions as the Pages source**

Open repository Settings → Pages and select GitHub Actions as the build and deployment source. Obtain action-time confirmation immediately before saving the repository setting.

Expected: the Pages settings page identifies GitHub Actions as the source.

- [ ] **Step 5: Merge the deployment PR**

Verify the PR remains conflict-free, then obtain action-time confirmation immediately before merging it into `main`.

Expected: the PR is merged and `origin/main` contains the merge commit.

- [ ] **Step 6: Verify the deployment workflow**

Open the `Deploy public demo` workflow run triggered by the merge and wait for both `build` and `deploy` jobs to succeed.

Expected: the run is green and reports the public Pages URL.

- [ ] **Step 7: Verify the public product in a browser**

Open `https://wk19910907-debug.github.io/nanjing-pet-care-marketplace/` and confirm:

```text
南京安心宠
宠主
平台运营
服务人员
提交订单
```

Complete one demo order through matching, service execution, report submission, and owner confirmation. Refresh once and verify the order remains available in that browser.

- [ ] **Step 8: Update the durable project record**

Add the public URL, merged PR URL, merge commit, deployment workflow result, and verification date to `01-Projects/pet-home-service-platform/2026-08-23-implementation-progress.md`. Do not store cookies, tokens, form data, or other secrets.

- [ ] **Step 9: Report the finished handoff**

Return the public URL, repository URL, PR URL, passing checks, and the local fallback URL `http://127.0.0.1:43123/`.
