#!/usr/bin/env node
// Run from an extracted package on the SillyTavern server/container.
// No network requests, npm installs, config changes, or chat edits.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rootIndex = args.indexOf('--app-root');
const root = path.resolve(rootIndex >= 0 ? args[rootIndex + 1] || '' : process.cwd());
const dryRun = args.includes('--dry-run');
const uninstall = args.includes('--uninstall');
const files = ['manifest.json', 'index.js', 'core.mjs', 'orientation.mjs', 'runtime.mjs', 'continuation.mjs', 'transport.mjs', 'models.mjs', 'models-ui.mjs', 'portraits.mjs', 'portraits-ui.mjs', 'album-core.mjs', 'album-runtime.mjs', 'album-ui.mjs', 'album.css'];
try {
    const info = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (info.name?.toLowerCase() !== 'sillytavern' || info.version !== '1.19.0') {
        throw new Error(`This package targets SillyTavern 1.19.0. Found ${info.name} ${info.version}. Nothing was changed.`);
    }
    const parent = path.join(root, 'public/scripts/extensions/third-party');
    if (!fs.statSync(parent).isDirectory()) throw new Error('Third-party extensions directory is missing.');
    const destination = path.join(parent, 'st-venice-vision-bridge');
    if (source === destination) throw new Error('Run this installer from outside the installed extension folder.');
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) throw new Error('Refusing to replace a symbolic-link extension folder.');
    for (const file of files) {
        const item = path.join(source, file);
        if (!fs.statSync(item).isFile() || fs.lstatSync(item).isSymbolicLink()) throw new Error(`Invalid package member: ${file}`);
    }
    console.log(`${dryRun ? 'CHECK ONLY: ' : ''}${uninstall ? 'Remove' : 'Install'} Venice Image Bridge at ${destination}`);
    console.log('Original st-venice-image extension, API settings and chats will not be modified.');
    if (dryRun) process.exit(0);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = path.join(root, 'data/venice-image-bridge-backups');
    let backup;
    if (uninstall) {
        if (!fs.existsSync(destination)) { console.log('Bridge is not installed.'); process.exit(0); }
        fs.mkdirSync(backupRoot, { recursive: true });
        backup = path.join(backupRoot, stamp);
        fs.cpSync(destination, backup, { recursive: true, errorOnExist: true, force: false });
        fs.rmSync(destination, { recursive: true });
        console.log(`Removed by moving to ${backup}. Reload SillyTavern in every browser tab.`);
        process.exit(0);
    }
    // Stage alongside the destination: Docker often mounts data on another filesystem.
    const staging = fs.mkdtempSync(path.join(parent, '.venice-bridge-stage-'));
    let previous;
    try {
        for (const file of files) fs.copyFileSync(path.join(source, file), path.join(staging, file));
        if (fs.existsSync(destination)) {
            fs.mkdirSync(backupRoot, { recursive: true });
            backup = path.join(backupRoot, stamp);
            fs.cpSync(destination, backup, { recursive: true, errorOnExist: true, force: false });
            previous = staging + '-previous';
            fs.renameSync(destination, previous);
        }
        try { fs.renameSync(staging, destination); }
        catch (error) { if (previous) fs.renameSync(previous, destination); throw error; }
        if (previous) fs.rmSync(previous, { recursive: true });
    } catch (error) {
        if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
        throw error;
    }
    console.log(`Installed 0.5.0.${backup ? ` Previous bridge saved at ${backup}.` : ''}`);
    console.log('Reload SillyTavern. Enable the image tool for the intended character in Extensions > Venice Image Bridge.');
    console.log('Ensure the third-party extensions directory is on persistent Docker storage before container recreation.');
} catch (error) {
    console.error(`Installation stopped: ${error.message}`);
    process.exitCode = 1;
}
