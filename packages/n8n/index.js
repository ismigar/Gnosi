#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpScript = path.join(__dirname, 'node_modules', 'n8n-mcp', 'dist', 'mcp', 'index.js');

// Configurar variables d'entorn per silenciar soroll
process.env.N8N_MCP_TELEMETRY_DISABLED = 'true';
process.env.CHECKPOINT_DISABLE = 'true';
process.env.MCP_MODE = 'stdio'; // Assegurar mode stdio

// Executar sense imprimir res per stderr d'inici (per si de cas)
const child = spawn('node', [mcpScript], {
    stdio: ['inherit', 'pipe', 'inherit'],
    env: { ...process.env }
});

let buffer = '';
child.stdout.on('data', (data) => {
    buffer += data.toString();
    // Processar buffer per línies completes
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Guardar fragment final

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('{')) {
            // Assumeixo que si comença per { és JSON (protocol MCP)
            process.stdout.write(line + '\n');
        } else if (trimmed.length > 0) {
            // Redirigir la resta a stderr per no trencar el protocol
            process.stderr.write(`[LOG] ${line}\n`);
        }
    }
});

child.on('error', (err) => {
    process.stderr.write(`[ERROR] ${err.message}\n`);
    process.exit(1);
});

child.on('exit', (code) => {
    process.exit(code || 0);
});
