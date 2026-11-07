#!/usr/bin/env node
// Servidor MCP do tablet para o Claude Code. Veja docs/02-integracao-claude.md.
import { loadEnvFile } from "../src/config.mjs";
import { startStdio } from "../src/mcp-server.mjs";

loadEnvFile();
await startStdio();
