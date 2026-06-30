# MCP 安装

[English](mcp.en.md)

MCP 方式会安装本地 stdio server：`cursor2api-mcp`。安装完成后，MCP 客户端可
调用 `cursor_agent`、`cursor_agent_direct`，或使用 MCP prompts：`cursor`、
`cursorx`。

## 安装

获取 Cursor API key：

https://cursor.com/dashboard/api?section=user-keys#user-api-keys

从 npm 安装：

```bash
npm install -g cursor2api-mcp
```

一键安装脚本只用于安装 MCP，不安装 plugin 命令模板。

macOS/Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.sh | sh
```

Windows `cmd`：

```cmd
curl -L -o install-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/install-mcp.cmd && install-mcp.cmd
```

脚本会询问 Cursor API key，扫描常见 Codex、Clash、OpenCode、Cursor、Gemini、
Hermes 配置目录，然后允许输入 `1`、`1,3,5`、`cursor gemini` 或 `all` 来单选
或批量安装。

## 手动配置

JSON MCP 客户端：

```json
{
  "mcpServers": {
    "cursor2api": {
      "command": "cursor2api-mcp",
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

Codex TOML：

```toml
[mcp_servers.cursor2api]
command = "cursor2api-mcp"

[mcp_servers.cursor2api.env]
CURSOR_API_KEY = "crsr_xxx"
```

开发时也可以直接指向当前 checkout：

```bash
git clone https://github.com/KnifelfPro/Cursor2API.git
cd Cursor2API
npm install
```

```json
{
  "mcpServers": {
    "cursor2api": {
      "command": "node",
      "args": ["/path/to/Cursor2Api/src/mcp.js"],
      "env": {
        "CURSOR_API_KEY": "crsr_xxx"
      }
    }
  }
}
```

## 安装后使用

可用 tools：

- `cursor_agent`：正常路由流程。会获取 Cursor 模型列表，把模型、工具、
  workspace 和任务发给默认模型，由默认模型决定 self、delegate 或最多 3 个
  并行 agent。会加入本地 workflow prompt。
- `cursor_agent_direct`：直接调用指定 Cursor 模型，不做模型筛选、路由、并行
  agent，也不加入本地 workflow prompt。

Tool input：

```json
{
  "prompt": "修复当前项目里失败的测试",
  "model": "default"
}
```

`prompt` 必填。`model` 可选。

支持 MCP prompts 的客户端可以直接使用：

```text
/cursor 修复当前项目里失败的测试 gpt-5.5
/cursorx 修复当前项目里失败的测试 gpt-5.5
```

如果不传模型，使用默认模型。

每次 tool 调用时，MCP server 会请求客户端的 MCP roots，并把第一个 `file://`
root 作为 Cursor workspace。客户端不支持 roots 时，回退到 MCP server 进程的
当前工作目录。

## 卸载

macOS/Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.sh | sh
```

Windows `cmd`：

```cmd
curl -L -o uninstall-mcp.cmd https://raw.githubusercontent.com/KnifelfPro/Cursor2API/main/scripts/uninstall-mcp.cmd && uninstall-mcp.cmd
```

卸载脚本会扫描相同配置目录，从你选择的目标里移除 `cursor2api` 条目，写 `.bak`
备份，然后执行：

```bash
npm uninstall -g cursor2api-mcp
```
