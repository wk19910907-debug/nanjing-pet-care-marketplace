import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ProviderWorkspace } from './ProviderWorkspace.js';
import { createInitialState } from './workflow.js';

test('shows an empty identity option when no verified provider resolves', () => {
  const state = { ...createInitialState(), providers: [] };

  const markup = renderToStaticMarkup(<ProviderWorkspace
    state={state}
    selectProvider={() => {}}
    submitApplication={() => false}
    start={() => {}}
    report={() => {}}
  />);

  expect(markup).toContain('<option value="" selected="">暂无可用的已认证体验身份</option>');
  expect(markup).toContain('暂无可用的已认证体验身份。');
});
