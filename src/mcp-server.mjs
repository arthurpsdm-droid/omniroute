// Servidor MCP (stdio) que expõe as ferramentas do tablet ao Claude Code
// rodando no Termux. Registre com:
//   claude mcp add tablet -- node ~/claude-tab/bin/claude-tab-mcp.mjs
//
// O Claude Code já pede sua permissão antes de cada ferramenta, então aqui a
// confirmação na tela vem desligada por padrão (CLAUDE_TAB_CONFIRMAR_MCP muda isso).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS, executeTool } from "./tools.mjs";
import { confirmar } from "./termux.mjs";
import { settings as loadSettings } from "./config.mjs";

export function createServer({ settings = loadSettings(), confirm } = {}) {
  const confirmMode = process.env.CLAUDE_TAB_CONFIRMAR_MCP || "nenhum";
  const ctx = {
    settings,
    confirmMode,
    confirm: confirm ?? ((msg) => confirmar(msg, confirmMode)),
  };

  const server = new McpServer({ name: "claude-tab-s10", version: "1.0.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (args) => {
        const r = await executeTool(tool, args, ctx);
        const content = [{ type: "text", text: r.text }];
        if (r.image) content.push({ type: "image", data: r.image.data, mimeType: r.image.media_type });
        return r.ok ? { content } : { content, isError: true };
      },
    );
  }
  return server;
}

export async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  return server;
}
