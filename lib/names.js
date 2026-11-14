'use strict';
// The name an assistant session has on the board comes from the folder it was started in. Inside a git repository it is
// the top folder of that checkout: a subfolder shares its repository's name, and each worktree is its own session (two
// release worktrees of one repository are two pieces of work, and one must never take the other's decision). Anywhere
// else it is the folder itself. The short fingerprint of the full path tells apart two folders with the same name.
const path = require('path'), crypto = require('crypto'), { execFileSync } = require('child_process');

// The top folder of the checkout a folder belongs to (a worktree's own folder, for a worktree), or the folder itself.
function rootOf(cwd) {
  const env = Object.assign({}, process.env);
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE']) delete env[k]; // the folder decides, not an inherited setting
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000, windowsHide: true });
    const line = out.trim().split(/\r?\n/).pop();
    if (line) return path.resolve(cwd, line);
  } catch (e) { /* not in a repository, or no git */ }
  return cwd;
}

// { base, fp }: the folder's name and the fingerprint of its full path.
function folderOf(cwd) {
  const root = rootOf(cwd);
  return { base: path.basename(root).replace(/\.git$/i, '') || root, fp: crypto.createHash('sha1').update(root).digest('hex').slice(0, 4) };
}

// A project named by the session: one line, short, nothing a name cannot hold. "~" and ":" are what a repository's own
// name (client:folder~fp) and a fixed name with a project (name:project) are made of, so a named project never holds
// them: it can never spell another repository's session, or another client's.
const projectName = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[~:]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) : '');

// client:folder~fp, or client:project once the session names a project other than its own folder.
// A name fixed by SWITCHBOARD_AGENT stays, with the project added after it.
function agentName({ fixed, client, folder, project }) {
  if (fixed) return project ? `${fixed}:${project}` : fixed;
  if (project && project.toLowerCase() !== folder.base.toLowerCase()) return `${client || 'assistant'}:${project}`;
  return `${client || 'assistant'}:${folder.base}~${folder.fp}`;
}

module.exports = { rootOf, folderOf, projectName, agentName };
