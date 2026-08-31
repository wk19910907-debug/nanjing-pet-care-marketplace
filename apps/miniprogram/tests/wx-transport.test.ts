import { expect, it, vi } from 'vitest';
import { createWxTransport } from '../services/wx-transport.js';
it('keeps development cookies in memory for same-origin API calls, never uploads', async () => {
  const request = vi.fn((options) => options.success({ statusCode: 201, data: {}, cookies: ['petcare_pilot_session=test-session; HttpOnly; Path=/'] }));
  const transport = createWxTransport({ request }, 'http://127.0.0.1:51800', true);
  await transport({ method: 'POST', url: 'http://127.0.0.1:51800/api/v1/pilot/local-sessions', headers: {} });
  await transport({ method: 'GET', url: 'http://127.0.0.1:51800/api/v1/pilot/orders', headers: {} });
  expect(request.mock.calls[1]![0].header.Cookie).toBe('petcare_pilot_session=test-session');
  await transport({ method: 'PUT', url: 'http://127.0.0.1:51800/api/v1/pilot/local-evidence?token=capability', headers: {}, data: new ArrayBuffer(8) });
  expect(request.mock.calls[2]![0].header.Cookie).toBeUndefined();
  await transport({ method: 'PUT', url: 'https://objects.example.com/photo', headers: {}, data: new ArrayBuffer(8) });
  expect(request.mock.calls[3]![0].header.Cookie).toBeUndefined();
});
it('does not adopt cookie sessions in production', async () => {
  const request = vi.fn((options) => options.success({ statusCode: 200, data: {}, cookies: ['petcare_pilot_session=test-session; Path=/'] }));
  const transport = createWxTransport({ request }, 'https://api.example.com', false);
  await transport({ method: 'POST', url: 'https://api.example.com/api/v1/pilot/local-sessions', headers: {} });
  await transport({ method: 'GET', url: 'https://api.example.com/api/v1/pilot/orders', headers: { Authorization: 'Bearer test-token' } });
  expect(request.mock.calls[1]![0].header).toEqual({ Authorization: 'Bearer test-token' });
});
