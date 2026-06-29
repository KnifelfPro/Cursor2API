# Local MCP Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local npm MCP orchestration around the existing Cursor agent runner.

**Architecture:** Keep `src/mcp.js` as the stdio MCP entrypoint. Add orchestration helpers there, reuse `runCursorText()` for every agent call, and expose a package `bin` for local npm installation.

**Tech Stack:** Node.js ESM, node:test, existing `@cursor/sdk`.

---

### Task 1: Orchestration Tests

**Files:**
- Modify: `src/mcp.test.js`

- [x] **Step 1: Write failing tests**

Add tests for model-list context, invalid JSON fallback, parallel fanout, and package bin metadata.

- [x] **Step 2: Run tests to verify failure**

Run: `npm test`
Expected: FAIL because orchestration helpers and package bin are not implemented yet.

### Task 2: MCP Orchestrator

**Files:**
- Modify: `src/mcp.js`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [x] **Step 1: Implement minimal orchestration**

Add model listing, decision prompting, JSON decision parsing, self/delegate/parallel execution, and bin metadata.

- [x] **Step 2: Run tests**

Run: `npm test`
Expected: PASS.

- [x] **Step 3: Smoke test stdio**

Run: `printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | CURSOR_API_KEY=crsr_test node src/mcp.js`
Expected: one JSON-RPC response containing `cursor_agent`.
