import { apiRequest } from '../api.js';
import { doAction } from './actions.js';
import { log, colors, outputJson } from '../utils.js';

// ── Local Backups ──

async function templateAction(vmID, action, param1 = '', param2 = '', param3 = '') {
  const response = await apiRequest('/api/servers/templateAction', 'POST', {
    vmID: String(vmID), action, param1, param2, param3
  });
  if (response.status !== 'OK' && !response.data) throw new Error(response.message || `Action "${action}" failed`);
  return response;
}

export async function listLocalBackups(vmID, json = false) {
  let result;
  try { result = await templateAction(vmID, 'scriptBackupsList'); }
  catch { log('info', 'No local backups found'); return []; }

  const backups = result.data?.backups || result.backups || [];
  if (json) { outputJson(backups); return backups; }
  if (backups.length === 0) { log('info', 'No local backups found'); return []; }

  console.log(`\n${colors.bold}Local Backups${colors.reset}\n`);
  backups.forEach(b => console.log(`  ${b}`));
  console.log('');
  return backups;
}

export async function takeLocalBackup(vmID) {
  log('info', `Taking local backup on ${vmID}...`);
  const result = await templateAction(vmID, 'scriptBackup');
  log('success', 'Local backup initiated');
  return result;
}

export async function restoreLocalBackup(vmID, backupPath) {
  if (!backupPath) throw new Error('Backup path required');
  log('info', `Restoring local backup ${backupPath}...`);
  const result = await templateAction(vmID, 'scriptRestore', backupPath);
  log('success', 'Local backup restore initiated');
  return result;
}

export async function deleteLocalBackup(vmID, backupPath) {
  if (!backupPath) throw new Error('Backup path required');
  log('info', `Deleting local backup ${backupPath}...`);
  const result = await templateAction(vmID, 'scriptBackupDelete', backupPath);
  log('success', 'Local backup deleted');
  return result;
}

// ── Remote Backups ──

export async function listRemoteBackups(vmID, json = false) {
  const response = await apiRequest('/api/backups/GetBackupList', 'POST', { serverID: String(vmID) });
  if (response.status !== 'OK') { log('info', 'No remote backups found'); return []; }

  const backups = response.data?.backups || [];
  if (json) { outputJson(backups); return backups; }
  if (backups.length === 0) { log('info', 'No remote backups found'); return []; }

  console.log(`\n${colors.bold}Remote Backups${colors.reset}\n`);
  backups.forEach(b => console.log(`  ${b.snapshotName || b.name || b}`));
  console.log('');
  return backups;
}

export async function takeRemoteBackup(vmID) {
  log('info', `Taking remote backup for ${vmID}...`);
  const response = await apiRequest('/api/backups/StartManualBackup', 'POST', { serverID: String(vmID) });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed to start remote backup');
  log('success', 'Remote backup initiated');
  return response;
}

export async function restoreRemoteBackup(vmID, snapshotName) {
  if (!snapshotName) throw new Error('Snapshot name required');
  log('info', `Restoring remote backup ${snapshotName}...`);
  const response = await apiRequest('/api/backups/RestoreBackup', 'POST', { serverID: String(vmID), snapshotName });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed to restore');
  log('success', 'Remote backup restore initiated');
  return response;
}

export async function setupAutoBackups(vmID, backupPath = '/backup/', backupHour = '03:00') {
  log('info', `Setting up auto backups for ${vmID}...`);
  const response = await apiRequest('/api/backups/SetupAutoBackups', 'POST', { serverID: String(vmID), backupPath, backupHour });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed to setup');
  log('success', `Auto backups configured at ${backupHour}`);
  return response;
}

export async function disableAutoBackups(vmID) {
  log('info', `Disabling auto backups for ${vmID}...`);
  const response = await apiRequest('/api/backups/DisableAutoBackups', 'POST', { serverID: String(vmID) });
  if (response.status !== 'OK') throw new Error(response.message || 'Failed to disable');
  log('success', 'Auto backups disabled');
  return response;
}

// ── Snapshots ──

export async function listSnapshots(vmID, json = false) {
  const result = await doAction(vmID, 'listSnapshot');
  const snapshots = result.data?.snapshots || result.snapshots || [];
  if (json) { outputJson(snapshots); return snapshots; }
  if (snapshots.length === 0) { log('info', 'No snapshots found'); return []; }

  console.log(`\n${colors.bold}Snapshots${colors.reset}\n`);
  snapshots.forEach(s => console.log(`  ${s.id || s.orderID || 'N/A'}: ${s.description || s.name || s.id || s} ${s.created ? `(${s.created})` : ''}`));
  console.log('');
  return snapshots;
}

export async function takeSnapshot(vmID) {
  log('info', `Taking snapshot of ${vmID}...`);
  const result = await doAction(vmID, 'takeSnapshot');
  log('success', 'Snapshot initiated');
  return result;
}

export async function restoreSnapshot(vmID, snapshotOrderID) {
  if (snapshotOrderID === undefined) throw new Error('Snapshot order ID required (0 = most recent)');
  log('info', `Restoring snapshot ${snapshotOrderID}...`);
  const result = await doAction(vmID, 'restoreSnapshot', { snapshotOrderID: String(snapshotOrderID) });
  log('success', 'Snapshot restore initiated');
  return result;
}

export async function deleteSnapshot(vmID, snapshotID) {
  if (!snapshotID) throw new Error('Snapshot ID required');
  log('info', `Deleting snapshot ${snapshotID}...`);
  const result = await doAction(vmID, 'deleteSnapshot', { snapshotID: String(snapshotID) });
  log('success', 'Snapshot deleted');
  return result;
}

export async function enableAutoSnapshots(vmID) {
  log('info', `Enabling auto snapshots on ${vmID}...`);
  const result = await doAction(vmID, 'enableBackup');
  log('success', 'Auto snapshots enabled');
  return result;
}

export async function disableAutoSnapshots(vmID) {
  log('info', `Disabling auto snapshots on ${vmID}...`);
  const result = await doAction(vmID, 'disableBackup');
  log('success', 'Auto snapshots disabled');
  return result;
}

// ── S3 External Backups ──

export async function verifyS3Config(vmID, config) {
  const { apiKey, secretKey, bucketName, endPoint, prefix = '', providerType = 's3' } = config;
  if (!apiKey || !secretKey || !bucketName || !endPoint) throw new Error('Required: --key, --secret, --bucket, --endpoint');

  log('info', `Verifying S3 configuration for ${vmID}...`);
  const result = await doAction(vmID, 'verifyExternalBackupConfig', { apiKey, secretKey, bucketName, endPoint, prefix, providerType });
  log('success', 'S3 configuration verified');
  return result;
}

export async function enableS3Backup(vmID, config) {
  const { apiKey, secretKey, bucketName, endPoint, prefix = '', providerType = 's3' } = config;
  if (!apiKey || !secretKey || !bucketName || !endPoint) throw new Error('Required: --key, --secret, --bucket, --endpoint');

  log('info', `Enabling S3 backup for ${vmID}...`);
  const result = await doAction(vmID, 'enableExternalBackup', { apiKey, secretKey, bucketName, endPoint, prefix, providerType });
  log('success', 'S3 backup enabled');
  return result;
}

export async function disableS3Backup(vmID) {
  log('info', `Disabling S3 backup for ${vmID}...`);
  const result = await doAction(vmID, 'disableExternalBackup');
  log('success', 'S3 backup disabled');
  return result;
}

export async function takeS3Backup(vmID) {
  log('info', `Taking S3 backup for ${vmID}...`);
  const result = await doAction(vmID, 'takeExternalBackup');
  log('success', 'S3 backup initiated');
  return result;
}

export async function listS3Backups(vmID, json = false) {
  const result = await doAction(vmID, 'listExternalBackup');
  const backups = result.data?.backups || result.backups || [];
  if (json) { outputJson(backups); return backups; }
  if (backups.length === 0) { log('info', 'No S3 backups found'); return []; }

  console.log(`\n${colors.bold}S3 Backups${colors.reset}\n`);
  backups.forEach(b => console.log(`  ${b.key || b.name || b}`));
  console.log('');
  return backups;
}

export async function restoreS3Backup(vmID, restoreKey) {
  if (!restoreKey) throw new Error('Restore key required');
  log('info', `Restoring S3 backup ${restoreKey}...`);
  const result = await doAction(vmID, 'restoreExternalBackup', { restoreKey });
  log('success', 'S3 backup restore initiated');
  return result;
}

export async function deleteS3Backup(vmID, deleteKey) {
  if (!deleteKey) throw new Error('Delete key required');
  log('info', `Deleting S3 backup ${deleteKey}...`);
  const result = await doAction(vmID, 'deleteExternalBackup', { deleteKey });
  log('success', 'S3 backup deleted');
  return result;
}
