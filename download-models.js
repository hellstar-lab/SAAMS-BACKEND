#!/usr/bin/env node
/**
 * download-models.js
 * Downloads face-api model weights from the @vladmandic/face-api npm package
 * into the /models directory. Run this as a build step on Render.
 * 
 * Usage: node download-models.js
 */

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(__dirname, 'node_modules/@vladmandic/face-api/model')
const DST = resolve(__dirname, 'models')

if (!existsSync(DST)) mkdirSync(DST, { recursive: true })

const files = readdirSync(SRC)
let copied = 0
for (const file of files) {
    if (file.includes('ssd_mobilenetv1') || file.includes('face_landmark_68_model') || file.includes('face_recognition')) {
        copyFileSync(resolve(SRC, file), resolve(DST, file))
        console.log(`  copied: ${file}`)
        copied++
    }
}
console.log(`\n✅ ${copied} model files copied to /models`)
