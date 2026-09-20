import { findOrCreateTab, connect } from './cdp.mjs';
import fs from 'fs';
const tab = await findOrCreateTab('http://gdemos.ddns.net/cypdemo/');
const cdp = await connect(tab.webSocketDebuggerUrl);
await cdp.send('Page.enable');
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(base_path(), Buffer.from(shot.result.data, 'base64'));
function base_path() { return 'C:/Users/Rardiel Ceballo/Documents/Codex/2026-09-17/cyp-modern/.cdp/login.png'; }
console.log('screenshot guardado');
cdp.close();
