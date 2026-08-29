// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PilotApiError, type PilotApi } from './api.js';
import { OperationsSettingsPanel } from './OperationsSettingsPanel.js';

const catalog = {
  version: 4,
  updatedAt: '2026-08-29T08:00:00.000Z',
  services: {
    CAT_FEEDING: { enabled: true, basePriceFen: 3_200 },
    DOG_WALKING: { enabled: true, basePriceFen: 3_700 },
  },
  openDistricts: ['JIANYE', 'GULOU'] as Array<'JIANYE' | 'GULOU'>,
  announcement: '',
};

function setup(overrides: Partial<PilotApi> = {}) {
  const api = {
    getAdminCatalog: vi.fn().mockResolvedValue(catalog),
    updateAdminCatalog: vi.fn().mockImplementation(async (input) => ({
      ...input,
      version: input.expectedVersion + 1,
      updatedAt: '2026-08-29T09:00:00.000Z',
    })),
    ...overrides,
  } as PilotApi;
  render(<OperationsSettingsPanel api={api} onError={(error) => (
    error instanceof Error ? error.message : '保存失败'
  )}/>);
  return api;
}

describe('OperationsSettingsPanel', () => {
  afterEach(cleanup);

  it('loads the versioned catalog into concise operating controls', async () => {
    setup();
    expect(screen.getByText('正在读取运营配置…')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: '运营配置' })).toBeTruthy();
    expect((screen.getByRole('checkbox', { name: '开放上门喂猫' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('spinbutton', { name: '上门喂猫起步价' }) as HTMLInputElement).value).toBe('32');
    expect((screen.getByRole('checkbox', { name: '建邺区' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: '玄武区' }) as HTMLInputElement).checked).toBe(false);
  });

  it('saves service switches, prices, districts, and announcement as one versioned update', async () => {
    const api = setup();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '运营配置' });

    await user.click(screen.getByRole('checkbox', { name: '开放上门遛狗' }));
    const catPrice = screen.getByRole('spinbutton', { name: '上门喂猫起步价' });
    await user.clear(catPrice);
    await user.type(catPrice, '35');
    await user.click(screen.getByRole('checkbox', { name: '玄武区' }));
    await user.type(screen.getByRole('textbox', { name: '运营公告' }), '周末正常接单');
    await user.click(screen.getByRole('button', { name: '保存运营配置' }));

    await waitFor(() => expect(api.updateAdminCatalog).toHaveBeenCalledWith({
      expectedVersion: 4,
      services: {
        CAT_FEEDING: { enabled: true, basePriceFen: 3_500 },
        DOG_WALKING: { enabled: false, basePriceFen: 3_700 },
      },
      openDistricts: ['JIANYE', 'GULOU', 'XUANWU'],
      announcement: '周末正常接单',
    }));
    expect(await screen.findByText('运营配置已保存')).toBeTruthy();
  });

  it('keeps at least one district and valid prices before saving', async () => {
    const api = setup();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '运营配置' });
    await user.click(screen.getByRole('checkbox', { name: '建邺区' }));
    await user.click(screen.getByRole('checkbox', { name: '鼓楼区' }));
    await user.click(screen.getByRole('button', { name: '保存运营配置' }));
    expect(screen.getByRole('alert').textContent).toContain('至少保留一个开放区域');
    expect(api.updateAdminCatalog).not.toHaveBeenCalled();
  });

  it('accepts valid two-decimal prices despite floating-point representation', async () => {
    const api = setup();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '运营配置' });
    const catPrice = screen.getByRole('spinbutton', { name: '上门喂猫起步价' });
    await user.clear(catPrice);
    await user.type(catPrice, '34.55');
    await user.click(screen.getByRole('button', { name: '保存运营配置' }));
    await waitFor(() => expect(api.updateAdminCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ services: expect.objectContaining({ CAT_FEEDING: { enabled: true, basePriceFen: 3455 } }) }),
    ));
  });

  it('shows conflict guidance and can reload the latest version', async () => {
    const getAdminCatalog = vi.fn().mockResolvedValue(catalog);
    setup({
      getAdminCatalog,
      updateAdminCatalog: vi.fn().mockRejectedValue(
        new PilotApiError(409, 'OPERATIONS_CATALOG_CONFLICT'),
      ),
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: '运营配置' });
    await user.click(screen.getByRole('button', { name: '保存运营配置' }));
    expect(await screen.findByRole('button', { name: '重新读取配置' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重新读取配置' }));
    await waitFor(() => expect(getAdminCatalog).toHaveBeenCalledTimes(2));
  });
});
