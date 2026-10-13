import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/api.js', () => ({ apiRequest: vi.fn(async () => ({ status: 'OK' })) }));
vi.mock('../src/utils.js', async (orig) => ({ ...(await orig()), log: vi.fn() }));

const { apiRequest } = await import('../src/api.js');
const { setupAutoBackups, DEFAULT_BACKUP_PATH } = await import('../src/commands/backups.js');

describe('setupAutoBackups', () => {
  beforeEach(() => apiRequest.mockClear());

  // The backend runs `borg create` on backupPath. A path that does not exist
  // on the VM yields archives that are empty, so restores bring back nothing.
  it('backs up /opt by default, like the dashboard', async () => {
    await setupAutoBackups('848528');
    expect(DEFAULT_BACKUP_PATH).toBe('/opt');
    expect(apiRequest).toHaveBeenCalledWith('/api/backups/SetupAutoBackups', 'POST',
      expect.objectContaining({ serverID: '848528', backupPath: '/opt' }));
  });

  it('never sends the old /backup/ default', async () => {
    await setupAutoBackups('848528');
    expect(apiRequest.mock.calls[0][2].backupPath).not.toBe('/backup/');
  });

  it('passes an explicit --path through', async () => {
    await setupAutoBackups('848528', '/opt/app');
    expect(apiRequest.mock.calls[0][2].backupPath).toBe('/opt/app');
  });

  it('refuses a relative path before calling the API', async () => {
    await expect(setupAutoBackups('848528', 'opt/app')).rejects.toThrow(/absolute/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
