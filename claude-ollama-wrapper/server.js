const http = require('http');
const { spawn } = require('child_process');
const { randomUUID } = require('crypto');

const PORT = Number.parseInt(process.env.PORT || '11434', 10);
const HOST = process.env.HOST || '0.0.0.0';

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*';
const CLAUDE_SETTINGS_PATH = process.env.CLAUDE_SETTINGS_PATH || '';
const CLAUDE_MODEL_MAP = {
  'sonnet:latest': 'sonnet',
  'opus:latest': 'opus',
  'haiku:latest': 'haiku',
  sonnet: 'sonnet',
  opus: 'opus',
  haiku: 'haiku',
};

const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || '300000', 10);
const MAX_PROMPT_CHARS = Number.parseInt(process.env.MAX_PROMPT_CHARS || '200000', 10);

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body);
}

function text(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Max-Age': '86400',
  });
  res.end(body);
}

function getBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      // 16MB hard limit
      if (total > 16 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeModel(model) {
  if (!model) return 'sonnet';
  const key = String(model).trim();
  return CLAUDE_MODEL_MAP[key] || 'sonnet';
}

function buildErrorResponse(model, message, details = '') {
  const body = `==== 翻訳エラー ====
API プロバイダー: Ollama(Claude Code wrapper)
使用モデル: ${model}
APIキー: (Claude Code settings)
エラー詳細: ${message}
${details ? '\n詳細:\n' + details : ''}
==================
`;

  return {
    model,
    created_at: new Date().toISOString(),
    response: body,
    done: true,
  };
}

function runClaude({ model, prompt, requestId }) {
  return new Promise((resolve) => {
    const args = ['-p', '--permission-mode', 'dontAsk', '--model', model, '--output-format', 'text'];

    // Allow only WebFetch/WebSearch; deny file/Bash tools.
    // Note: --allowedTools/--disallowedTools accept comma-separated lists.
    args.push('--allowedTools', 'WebFetch,WebSearch');
    args.push('--disallowedTools', 'Bash,Read,Edit,Write');

    if (CLAUDE_SETTINGS_PATH) {
      args.push('--settings', CLAUDE_SETTINGS_PATH);
    }

    args.push('--', prompt);

    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Keep Claude from generating too much non-essential traffic.
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC || '1',
        // In case some environments require a custom base URL.
        // (ANTHROPIC_BASE_URL etc are expected to be in the mounted settings.json env.)
      },
    });

    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
    }, REQUEST_TIMEOUT_MS);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      resolve({ code: 1, stdout: '', stderr: String(err) });
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/tags') {
      json(res, 200, {
        models: [
          { name: 'sonnet:latest' },
          { name: 'opus:latest' },
          { name: 'haiku:latest' },
        ],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const raw = await getBody(req);
      let payload;
      try {
        payload = JSON.parse(raw || '{}');
      } catch (_) {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const requestId = randomUUID();
      const model = normalizeModel(payload.model);
      const stream = payload.stream;
      if (stream !== false && typeof stream !== 'undefined') {
        // We intentionally only support non-streaming for this plugin.
        json(res, 400, { error: 'stream=true is not supported; use stream:false' });
        return;
      }

      const prompt = String(payload.prompt || '');
      if (!prompt.trim()) {
        json(res, 400, { error: 'prompt is required' });
        return;
      }
      if (prompt.length > MAX_PROMPT_CHARS) {
        json(res, 413, { error: `prompt too large (max ${MAX_PROMPT_CHARS} chars)` });
        return;
      }

      const { code, stdout, stderr } = await runClaude({ model, prompt, requestId });

      if (code !== 0) {
        const errResp = buildErrorResponse(model, 'claude command failed', stderr.slice(0, 4000));
        json(res, 200, errResp);
        return;
      }

      json(res, 200, {
        model: payload.model || `${model}:latest`,
        created_at: new Date().toISOString(),
        response: (stdout || '').trim(),
        done: true,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      text(res, 200, 'ok');
      return;
    }

    json(res, 404, { error: 'Not Found' });
  } catch (err) {
    json(res, 500, { error: 'Internal Server Error', message: String(err?.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`Claude-Ollama wrapper listening on http://${HOST}:${PORT}`);
});
