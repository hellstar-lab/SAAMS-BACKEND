import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const moduleDir = path.join(__dirname, 'node_modules', '@tensorflow', 'tfjs-node');

if (!fs.existsSync(moduleDir)) {
    fs.mkdirSync(moduleDir, { recursive: true });
}

fs.writeFileSync(path.join(moduleDir, 'index.js'), "module.exports = require('@tensorflow/tfjs');\n");
fs.writeFileSync(path.join(moduleDir, 'package.json'), JSON.stringify({
    name: "@tensorflow/tfjs-node",
    version: "4.22.0",
    main: "index.js"
}));

console.log('✅ Polyfilled @tensorflow/tfjs-node to point to pure @tensorflow/tfjs CPU variant.');
