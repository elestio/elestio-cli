import { describe, it, expect } from 'vitest';
import { resolveLogMode, formatAudit } from '../src/commands/access.js';

describe('logs', () => {
  // The backend whitelists its modes; "docker" is rejected with "Invalid mode parameter".
  it('maps readable modes to the ones the API accepts', () => {
    expect(resolveLogMode()).toBe('syslog');
    expect(resolveLogMode('install')).toBe('');
    expect(resolveLogMode('resyncLog')).toBe('resyncLog');
    expect(() => resolveLogMode('docker')).toThrow(/app, install/);
  });
});

describe('audits', () => {
  // Shape returned by /api/servers/getAudits on a live service.
  it('formats a live audit entry', () => {
    expect(formatAudit({
      time: '2026-09-22T13:56:33.740Z', event_category: 'Firewall', event_type: 'Update',
      event_details: '', email: 'me@example.com'
    })).toEqual({ when: '2026-09-22 13:56:33', event: 'Firewall / Update', user: 'me@example.com', details: '' });
  });
});
