/** End-to-end server-internal MCP orchestration runner. */
import { finalSynthesisPrompt, subagentPrompt } from "./planner.js";
import { scheduleAgents } from "./scheduler.js";
import { branchName, createGit, createRunId, worktreePath } from "./worktrees.js";

function emit(emitProgress, message) {
  if (typeof emitProgress === "function") emitProgress(message);
}

function worktreeRecords({ workspace, runId, orchestration }) {
  return orchestration.mergeOrder.map((id) => ({
    id,
    branch: branchName(runId, id),
    path: worktreePath(workspace, runId, id),
  }));
}

export async function runOrchestration({
  task,
  defaultModel,
  apiKey,
  workspace,
  orchestration,
  runWithFallback,
  emitProgress,
  git = createGit(),
  runId = createRunId(),
}) {
  await git.ensureRepository(workspace);
  await git.ensureClean(workspace);
  await git.ensureWorktreeRootIgnored(workspace);

  const worktrees = worktreeRecords({ workspace, runId, orchestration });
  const worktreeById = new Map(worktrees.map((worktree) => [worktree.id, worktree]));
  for (const worktree of worktrees) {
    emit(emitProgress, `Creating worktree ${worktree.id}`);
    await git.addWorktree({ workspace, path: worktree.path, branch: worktree.branch });
  }

  const completed = new Set();
  const agentResults = [];
  const levels = scheduleAgents(orchestration.agents);

  for (const level of levels) {
    await Promise.all(
      level.map(async (agent) => {
        const worktree = worktreeById.get(agent.worktree);
        if (!worktree) throw new Error(`Missing worktree ${agent.worktree} for agent ${agent.id}`);
        emit(emitProgress, `Running ${agent.id} in ${worktree.id}`);
        const completedDependencies = agent.dependsOn.filter((id) => completed.has(id));
        const result = await runWithFallback(
          subagentPrompt({ task, agent, workspace: worktree.path, completedDependencies }),
          agent.model,
          apiKey,
          worktree.path,
        );
        const status = await git.statusPorcelain(worktree.path);
        const committed = status.trim() ? await git.commitAll(worktree.path, `cursor2api: ${agent.id}`) : false;
        completed.add(agent.id);
        agentResults.push({ id: agent.id, model: agent.model, worktree: agent.worktree, committed, result });
      }),
    );
  }

  await git.ensureClean(workspace);
  const mergeResults = [];
  for (const worktree of worktrees) {
    emit(emitProgress, `Merging ${worktree.id}`);
    await git.mergeBranch({ workspace, branch: worktree.branch });
    mergeResults.push({ worktree: worktree.id, branch: worktree.branch });
  }

  const verificationResults = [];
  for (const command of orchestration.verify) {
    emit(emitProgress, `Verifying: ${command}`);
    verificationResults.push(await git.runVerification(command, workspace));
  }

  const finalText = await runWithFallback(
    finalSynthesisPrompt({ task, orchestration, agentResults, mergeResults, verificationResults }),
    defaultModel,
    apiKey,
    workspace,
  );

  await git.cleanup({ workspace, worktrees });
  return finalText;
}
