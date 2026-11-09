import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('installer checks version, keeps existing generator/chat untouched, backs up bridge and removes reversibly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'venice-bridge-test-'));
    const script = fileURLToPath(new URL('../install.mjs', import.meta.url));
    const run = (...args) => spawnSync(process.execPath, [script, '--app-root', root, ...args], { encoding: 'utf8' });
    const target = path.join(root, 'public/scripts/extensions/third-party/st-venice-vision-bridge');
    try {
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '1.19.0' }));
        fs.mkdirSync(path.join(root, 'public/scripts/extensions/third-party/st-venice-image'), { recursive: true });
        fs.mkdirSync(path.join(root, 'data/default-user'), { recursive: true });
        fs.writeFileSync(path.join(root, 'public/scripts/extensions/third-party/st-venice-image/index.js'), 'ORIGINAL');
        fs.writeFileSync(path.join(root, 'data/default-user/chats.jsonl'), 'CHAT');
        const check = run('--dry-run'); assert.equal(check.status, 0, check.stderr);
        assert.equal(fs.existsSync(target), false);
        const install = run(); assert.equal(install.status, 0, install.stderr);
        assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'))).version, '0.7.2');
        assert.ok(fs.existsSync(path.join(target, 'album-ui.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'models-ui.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'models.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'orientation.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'diagnostics.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'portraits.mjs')));
        assert.ok(fs.existsSync(path.join(target, 'portraits-ui.mjs')));
        fs.writeFileSync(path.join(target, 'old-test.txt'), 'PREVIOUS BRIDGE');
        const upgrade = run(); assert.equal(upgrade.status, 0, upgrade.stderr);
        const backups = fs.readdirSync(path.join(root, 'data/venice-image-bridge-backups'));
        assert.equal(fs.readFileSync(path.join(root, 'data/venice-image-bridge-backups', backups[0], 'old-test.txt'), 'utf8'), 'PREVIOUS BRIDGE');
        const remove = run('--uninstall'); assert.equal(remove.status, 0, remove.stderr);
        assert.equal(fs.existsSync(target), false);
        assert.equal(fs.readFileSync(path.join(root, 'public/scripts/extensions/third-party/st-venice-image/index.js'), 'utf8'), 'ORIGINAL');
        assert.equal(fs.readFileSync(path.join(root, 'data/default-user/chats.jsonl'), 'utf8'), 'CHAT');
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sillytavern', version: '1.18.0' }));
        assert.equal(run().status, 1); assert.equal(fs.existsSync(target), false);
    } finally { fs.rmSync(root, { recursive: true }); }
});
