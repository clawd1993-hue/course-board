// Course Deliverables Board — tiny kanban with Supabase persistence
// No npm deps. Node 20+ (built-in fetch).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3459;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const BOARD_ID = 'course-deliverables';

let board = { columns: { todo: [], inprogress: [], done: [] }, updatedAt: null };
let loaded = false;
let saveTimer = null;

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function loadBoard() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/kanban_boards?id=eq.${BOARD_ID}&select=data`,
      { headers: sbHeaders }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length && rows[0].data) {
      board = rows[0].data;
    }
    loaded = true;
    console.log('Board loaded:', JSON.stringify(board).slice(0, 200));
  } catch (e) {
    console.error('Load failed:', e.message);
    loaded = true; // proceed with empty board rather than hang
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveBoard, 400);
}

async function saveBoard() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/kanban_boards`, {
      method: 'POST',
      headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify([{ id: BOARD_ID, data: board, updated_at: new Date().toISOString() }]),
    });
    if (!r.ok) console.error('Save failed:', r.status, await r.text());
  } catch (e) {
    console.error('Save failed:', e.message);
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 1e6) req.destroy();
    });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const INDEX = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(INDEX);
  }

  if (url.pathname === '/api/board') {
    if (req.method === 'GET') return json(res, 200, board);
    if (req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req));
        if (!body || typeof body !== 'object' || !body.columns) return json(res, 400, { error: 'bad payload' });
        const cols = ['todo', 'inprogress', 'done'];
        // Anti-wipe guard: reject if new board is empty while current has 3+ cards
        const newCount = cols.reduce((n, c) => n + (Array.isArray(body.columns[c]) ? body.columns[c].length : 0), 0);
        const curCount = cols.reduce((n, c) => n + board.columns[c].length, 0);
        if (newCount === 0 && curCount >= 3 && !body.forceWipe) {
          return json(res, 409, { error: 'wipe blocked', board });
        }
        board = {
          columns: {
            todo: (body.columns.todo || []).slice(0, 300),
            inprogress: (body.columns.inprogress || []).slice(0, 300),
            done: (body.columns.done || []).slice(0, 300),
          },
          updatedAt: new Date().toISOString(),
        };
        scheduleSave();
        return json(res, 200, board);
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
    }
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, loaded });

  res.writeHead(404);
  res.end('not found');
});

loadBoard().then(() => {
  server.listen(PORT, () => console.log(`Course board on :${PORT}`));
});
