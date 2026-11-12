const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

test('UTM values render as text and runtime records are not public assets', async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drlyra-security-'));
  let proc;
  try {
    fs.copyFileSync(path.join(root, 'server.js'), path.join(dir, 'server.js'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'sales.json'), '{}');
    const port = process.env.SECURITY_TEST_PORT || '3159';
    proc = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: { PATH: process.env.PATH, PORT: port, ANTHROPIC_API_KEY: 'isolated-test-key', ADMIN_PASSWORD: 'isolated-test-only' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out')), 10000);
      proc.stdout.on('data', chunk => {
        if (String(chunk).includes('is ready')) { clearTimeout(timer); resolve(); }
      });
      proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited ${code}`)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const payload = '<img src=x onerror="alert(1)">&\'test';
    const response = await fetch(base + '/submit-lead', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'regression@example.invalid', utm: { utm_source: payload, utm_medium: payload, utm_campaign: payload, utm_content: payload } }),
    });
    assert.equal(response.status, 200);
    const lead = Object.values(JSON.parse(fs.readFileSync(path.join(dir, 'data', 'leads.json'))))[0];
    assert.equal(lead.utm_source, payload);
    const admin = await fetch(base + '/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:isolated-test-only').toString('base64') } });
    assert.equal(admin.status, 200);
    const html = await admin.text();
    assert.ok(!html.includes(payload));
    assert.equal(html.split('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;test').length - 1, 4);
    for (const file of ['leads.json', 'sales.json', 'reports.json', 'feedback.json']) {
      assert.equal((await fetch(base + '/data/' + file)).status, 404, file);
    }
  } finally {
    if (proc && proc.exitCode === null) {
      await new Promise(resolve => { proc.once('exit', resolve); proc.kill(); });
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
