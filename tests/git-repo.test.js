import { describe, it, expect, vi } from 'vitest';
import { gitApiRepoUrl, gitCloneUrl, repoPathFromUrl, completeGitData, isGitMode } from '../src/payloads/gitRepo.js';

describe('gitApiRepoUrl / gitCloneUrl', () => {
  it('GitHub: the API URL, taken from the provider answer when present', () => {
    expect(gitApiRepoUrl('GITHUB', 'acme/app')).toBe('https://api.github.com/repos/acme/app');
    expect(gitApiRepoUrl('GITHUB', 'acme/app', { url: 'https://api.github.com/repos/Acme/App' })).toBe('https://api.github.com/repos/Acme/App');
    expect(gitApiRepoUrl('GITHUB', 'acme/app', { url: 'https://evil.example/x' })).toBe('https://api.github.com/repos/acme/app');
    expect(gitCloneUrl('GITHUB', 'acme/app', { clone_url: 'https://github.com/Acme/App.git' })).toBe('https://github.com/Acme/App.git');
  });
  it('GitLab: the project API URL, by id', () => {
    expect(gitApiRepoUrl('GITLAB', 'grp/app', { id: 99 })).toBe('https://gitlab.com/api/v4/projects/99');
    expect(gitApiRepoUrl('GITLAB', 'grp/sub/app')).toBe('https://gitlab.com/api/v4/projects/grp%2Fsub%2Fapp');
    expect(gitApiRepoUrl('GITLAB', 'grp/app', { _links: { self: 'https://gitlab.com/api/v4/projects/7' } })).toBe('https://gitlab.com/api/v4/projects/7');
  });
});

describe('repoPathFromUrl', () => {
  it('reads owner/repo from web and API GitHub URLs', () => {
    expect(repoPathFromUrl('GITHUB', 'https://github.com/acme/app')).toBe('acme/app');
    expect(repoPathFromUrl('GITHUB', 'https://github.com/acme/app.git')).toBe('acme/app');
    expect(repoPathFromUrl('GITHUB', 'https://api.github.com/repos/acme/app/')).toBe('acme/app');
  });
  it('returns null for what it cannot name by path', () => {
    expect(repoPathFromUrl('GITHUB', 'https://evil.example/acme/app')).toBeNull();
    expect(repoPathFromUrl('GITLAB', 'https://gitlab.com/api/v4/projects/7')).toBeNull();
    expect(repoPathFromUrl('GITHUB', undefined)).toBeNull();
  });
});

describe('completeGitData (cicd create <file>)', () => {
  const file = (gitData, extra = {}) => ({ CICDMode: 'GITHUB', authID: '7', projectID: '1', gitData: { branch: 'main', ...gitData }, ...extra });
  const repo = { id: 4242, name: 'app', url: 'https://api.github.com/repos/acme/app', clone_url: 'https://github.com/acme/app.git' };

  it('a file with a web URL and no repoID is completed from the Git connection', async () => {
    const findRepo = vi.fn().mockResolvedValue(repo);
    const out = await completeGitData(file({ repoUrl: 'https://github.com/acme/app', repoID: 'REPLACE', repo: 'acme/app' }), findRepo);
    expect(findRepo).toHaveBeenCalledWith('GITHUB', '7', 'acme', 'app');
    expect(out.gitData).toMatchObject({ repoID: '4242', repo: 'app', repoUrl: 'https://api.github.com/repos/acme/app', cloneUrl: 'https://github.com/acme/app.git' });
  });
  it('a file that already has a repoID only gets its URL and repo name normalised, no lookup', async () => {
    const findRepo = vi.fn();
    const out = await completeGitData(file({ repoUrl: 'https://github.com/acme/app', repoID: 4242, repo: 'acme/app' }), findRepo);
    expect(findRepo).not.toHaveBeenCalled();
    expect(out.gitData).toMatchObject({ repoID: '4242', repo: 'app', repoUrl: 'https://api.github.com/repos/acme/app' });
  });
  it('a repository the connection cannot see is refused before anything is created', async () => {
    await expect(completeGitData(file({ repoUrl: 'https://github.com/victim/app' }), vi.fn().mockResolvedValue(null))).rejects.toThrow(/not found with this Git connection/);
  });
  it('no repoID and nothing to look it up with is refused', async () => {
    await expect(completeGitData(file({ repoUrl: 'https://github.com/acme/app' }, { authID: null }), vi.fn())).rejects.toThrow(/authID is required/);
    await expect(completeGitData(file({ repoUrl: 'https://git.acme.io/api/v4/projects/3' }, { CICDMode: 'GITLAB_SELF_HOSTED' }), vi.fn())).rejects.toThrow(/repoID is required/);
  });
  it('compose pipelines and repos created by the backend are left untouched', async () => {
    const compose = { CICDMode: 'DockerCompose', gitData: {} };
    expect(await completeGitData(compose, vi.fn())).toBe(compose);
    const toCreate = file({ repoUrl: '' }, { isNeedToCreateRepo: true });
    expect(await completeGitData(toCreate, vi.fn())).toBe(toCreate);
  });
  it('isGitMode', () => {
    expect(isGitMode('github')).toBe(true);
    expect(isGitMode('DockerCompose')).toBe(false);
  });
});
