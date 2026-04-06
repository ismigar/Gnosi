#!/usr/bin/env node
import { spawn } from 'child_process';

const CLI_PATH = '/usr/local/lib/node_modules/@notionhq/notion-mcp-server/bin/cli.mjs';

// Executem directament amb node, evitant intermediaris
const server = spawn('node', [CLI_PATH], {
  stdio: 'inherit',
  env: process.env
});

server.on('error', (err) => {
  console.error('Error FATAL al iniciar shim Notion:', err);
  process.exit(1);
});

server.on('exit', (code) => {
  if (code !== 0) console.error(`El servidor Notion ha sortit amb codi ${code}`);
  process.exit(code || 0);
});