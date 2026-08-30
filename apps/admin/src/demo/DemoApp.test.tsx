// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DemoApp } from './DemoApp.js';

describe('DemoApp public framing', () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('keeps the official landing formal and labels only the workflow as a demo', () => {
    window.history.replaceState({}, '', '/?fixture=service-loop');
    render(<DemoApp/>);

    expect(screen.queryByText('安全体验版')).toBeNull();
    expect(screen.getByRole('heading', { name: '平台功能演示' })).toBeTruthy();
    expect(screen.getByText('演示数据仅保存在当前浏览器，不会形成真实订单。')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '功能演示角色' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清空演示数据' })).toBeTruthy();
  });
});
