/** Local git/worktree helpers for MCP server-internal orchestration. */
import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFilePromise = promisify(execFileCallback);
export const WORKTREE_ROOT = ".cursor2api-worktrees";

export function createRunId() {
  return `run-${randomUUID()}`;
}

function safePathId(value) {
  return String(value || "worktree").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "worktree";
}

export function worktreePath(workspace, runId, worktreeId) {
  const root = resolve(workspace, WORKTREE_ROOT, safePathId(runId));
  const target = resolve(root, safePathId(worktreeId));
  const rel = relative(root, target);
  if (rel.startsWith("..") || rel === "" || resolve(root, rel) !== target) {
    throw new Error(`Refusing unsafe worktree path: ${target}`);
  }
  return target;
}

export function branchName(runId, worktreeId) {
  return `cursor2api/${safePathId(runId)}/${safePathId(worktreeId)}`;
}

export function parseVerificationCommand(commandText) {
  const parts = String(commandText || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error("Verification command is empty");
  return { command: parts[0], args: parts.slice(1) };
}

function needsWindowsShell(command) {
  return process.platform === "win32" && command !== "git" && command !== "node";
}

export function createGit({ execFile = execFilePromise } = {}) {
  async function exec(command, args, cwd) {
    try {
      return await execFile(command, args, {
        cwd,
        windowsHide: true,
        shell: needsWindowsShell(command),
        maxBuffer: 1024 * 1024 * 10,
      });
    } catch (error) {
      const message = [error.message, error.stdout, error.stderr].filter(Boolean).join("\n");
      throw new Error(message);
    }
  }

  return {
    async ensureRepository(workspace) {
      await exec("git", ["rev-parse", "--show-toplevel"], workspace);
    },

    async ensureClean(workspace) {
      const result = await exec("git", ["status", "--porcelain"], workspace);
      if (String(result.stdout || "").trim()) throw new Error("Workspace must be clean before MCP worktree orchestration");
    },

    async ensureWorktreeRootIgnored(workspace) {
      await exec("git", ["check-ignore", "-q", `${WORKTREE_ROOT}/`], workspace);
    },

    async addWorktree({ workspace, path, branch }) {
      await exec("git", ["worktree", "add", "-b", branch, path, "HEAD"], workspace);
    },

    async statusPorcelain(path) {
      const result = await exec("git", ["status", "--porcelain"], path);
      return String(result.stdout || "");
    },

    async commitAll(path, message) {
      await exec("git", ["add", "-A"], path);
      try {
        await exec("git", ["diff", "--cached", "--quiet"], path);
        return false;
      } catch {
        await exec("git", ["commit", "-m", message], path);
        return true;
      }
    },

    async mergeBranch({ workspace, branch }) {
      await exec("git", ["merge", "--no-edit", branch], workspace);
    },

    async removeWorktree({ workspace, path }) {
      await exec("git", ["worktree", "remove", "--force", path], workspace);
    },

    async deleteBranch(workspace, branch) {
      await exec("git", ["branch", "-D", branch], workspace);
    },

    async runVerification(commandText, workspace) {
      const { command, args } = parseVerificationCommand(commandText);
      const result = await exec(command, args, workspace);
      return { command: commandText, output: String(result.stdout || result.stderr || "").trim() };
    },

    async cleanup({ workspace, worktrees }) {
      for (const worktree of worktrees) {
        await this.removeWorktree({ workspace, path: worktree.path });
        await this.deleteBranch(workspace, worktree.branch);
      }
    },
  };
}
