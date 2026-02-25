import { createCanvas, loadImage } from 'canvas'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import * as tf from '@tensorflow/tfjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Import the ESM-nobundle dist so it uses whichever tf backend is already registered
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js')

const MODELS_PATH = resolve(__dirname, '../models')
let isLoaded = false

export async function initFaceApi() {
    if (isLoaded) return

    // 1. Set and await the TF backend BEFORE loading any model weights
    await tf.setBackend('cpu')
    await tf.ready()

    console.log('Loading face-api models...')
    await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH)
    await faceapi.nets.faceLandmark68Net.loadFromDisk(MODELS_PATH)
    await faceapi.nets.faceRecognitionNet.loadFromDisk(MODELS_PATH)
    isLoaded = true
    console.log('✅ face-api models loaded successfully')
}

// ── 3. Extract 128-float face descriptor from base64 image ────────────────────
/**
 * @param {string} base64 - Raw base64 string (with or without data URI prefix)
 * @returns {Float32Array|null} - 128-float descriptor, or null if no face found
 */
export async function getDescriptorFromBase64(base64) {
    if (!isLoaded) await initFaceApi()

    // Strip the data URI prefix if present
    const clean = base64.replace(/^data:image\/\w+;base64,/, '')
    const buffer = Buffer.from(clean, 'base64')

    // Load image using canvas
    const img = await loadImage(buffer)
    const canvas = createCanvas(img.width, img.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    // Detect the best face + landmarks + descriptor
    const detection = await faceapi
        .detectSingleFace(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
        .withFaceLandmarks()
        .withFaceDescriptor()

    if (!detection) return null

    return detection.descriptor // Float32Array of length 128
}

// ── 4. Euclidean distance between two face descriptors ────────────────────────
export function euclideanDistance(desc1, desc2) {
    let sum = 0
    for (let i = 0; i < desc1.length; i++) {
        sum += (desc1[i] - desc2[i]) ** 2
    }
    return Math.sqrt(sum)
}
