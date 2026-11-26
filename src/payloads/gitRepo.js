/**
 * How a Git repository is named in a pipeline payload.
 *
 * The backend finds the pipeline of a push by (repoID, repo name, branch) and
 * creates the webhook through the provider API URL. Two mistakes are silent:
 * a web URL (https://github.com/owner/repo) gets no webhook at all, and a
 * missing repoID makes the pipeline deaf to every push. Neither returns an
 * error, so they are refused or fixed here, before the request leaves.
 */

const GIT_MODES = ['GITHUB', 'GITLAB', 'GITLAB_SELF_HOSTED', 'BITBUCKET'];

export const isGitMode = (mode) => GIT_MODES.includes(String(mode || '').toUpperCase());

/** Provider API URL of a repo, from the provider's own answer when we have it. */
export function gitApiRepoUrl(gitType, repo, repoData = null) {
  if (gitType === 'GITLAB') {
    const self = repoData?._links?.self;
    if (typeof self === 'string' && self.includes('/api/v4/projects/')) return self;
    return `https://gitlab.com/api/v4/projects/${repoData?.id ?? encodeURIComponent(repo)}`;
  }
  const url = repoData?.url;
  return typeof url === 'string' && url.startsWith('https://api.github.com/repos/')
    ? url
    : `https://api.github.com/repos/${repo}`;
}

export function gitCloneUrl(gitType, repo, repoData = null) {
  if (gitType === 'GITLAB') return repoData?.http_url_to_repo || `https://gitlab.com/${repo}.git`;
  return repoData?.clone_url || `https://github.com/${repo}.git`;
}

/**
 * "owner/repo" out of a GitHub or gitlab.com URL, web or API form.
 * Returns null when the URL does not name a repo by its path (a GitLab API URL
 * carries a numeric id, a self-hosted or Bitbucket URL is left to the backend).
 */
export function repoPathFromUrl(gitType, repoUrl) {
  if (typeof repoUrl !== 'string') return null;
  const clean = repoUrl.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const bases = gitType === 'GITLAB'
    ? ['https://gitlab.com/']
    : ['https://api.github.com/repos/', 'https://github.com/'];
  for (const base of bases) {
    if (!clean.toLowerCase().startsWith(base)) continue;
    const path = clean.slice(base.length);
    if (path.toLowerCase().startsWith('api/')) return null;
    return path.split('/').length >= 2 ? path : null;
  }
  return null;
}

const isPlaceholder = (v) => v === undefined || v === null || String(v).trim() === '' || /^REPLACE/i.test(String(v));

/**
 * Checks and completes the gitData of a hand-written pipeline config
 * (`cicd create <file>`): API URL, repo name without its owner, and a repoID
 * looked up with the user's own Git connection when the file has none.
 * `findRepo(gitType, authID, owner, name)` returns the provider's repo object.
 */
export async function completeGitData(config, findRepo) {
  const mode = String(config?.CICDMode || '').toUpperCase();
  if (!isGitMode(mode) || config.isNeedToCreateRepo === true || config.isNeedToCreateRepo === 'true') return config;

  const gitData = { ...(config.gitData || {}) };
  const lookupType = mode === 'GITHUB' ? 'GITHUB' : mode === 'GITLAB' ? 'GITLAB' : null;
  const path = lookupType ? repoPathFromUrl(lookupType, gitData.repoUrl) : null;

  if (typeof gitData.repo === 'string' && gitData.repo.includes('/')) gitData.repo = gitData.repo.split('/').pop();

  if (lookupType && path) {
    const owner = path.split('/').slice(0, -1).join('/');
    const name = path.split('/').pop();
    if (isPlaceholder(gitData.repoID)) {
      if (isPlaceholder(config.authID)) throw new Error('authID is required to look up the repository (connect the Git account, or set authID in the file)');
      const repoData = await findRepo(lookupType, String(config.authID), owner, name);
      if (!repoData || repoData.id === undefined || repoData.id === null) {
        throw new Error(`Repository ${path} not found with this Git connection: the pipeline would never receive pushes`);
      }
      gitData.repoID = String(repoData.id);
      gitData.repo = repoData.name || name;
      gitData.repoUrl = gitApiRepoUrl(lookupType, path, repoData);
      if (isPlaceholder(gitData.cloneUrl)) gitData.cloneUrl = gitCloneUrl(lookupType, path, repoData);
    } else {
      gitData.repoID = String(gitData.repoID);
      if (lookupType === 'GITHUB') gitData.repoUrl = gitApiRepoUrl('GITHUB', path);
      if (isPlaceholder(gitData.repo)) gitData.repo = name;
    }
  } else if (isPlaceholder(gitData.repoID)) {
    throw new Error('gitData.repoID is required for a Git pipeline: without it the pipeline never receives pushes');
  }

  return { ...config, gitData };
}
