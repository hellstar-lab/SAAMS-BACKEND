import { createCanvas, loadImage } from 'canvas'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import * as tf from '@tensorflow/tfjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

console.log('1. Imports loaded')

try {
    console.log('2. Requiring face-api (universal dist)...')
    // Use the universal dist which doesn't hardcode require('tfjs-node')
    const faceapi = require('@vladmandic/face-api/dist/face-api.js')
    console.log('3. face-api required successfully')

    async function test() {
        console.log('4. Monkey patching for Node environment...')
        // We must monkeyPatch the environment to use canvas instead of DOM HTMLCanvasElement
        const canvas = require('canvas')
        faceapi.env.monkeyPatch({ canvas: canvas.Canvas, Image: canvas.Image })

        console.log('5. Setting backend to cpu...')
        await tf.setBackend('cpu')
        await tf.ready()
        console.log('6. Backend ready:', tf.getBackend())

        const MODELS_PATH = resolve(__dirname, './node_modules/@vladmandic/face-api/model')
        console.log('7. Loading models from:', MODELS_PATH)

        await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH)
        console.log('8. Models loaded successfully')
    }

    test().catch(e => console.error('Test failed:', e))

} catch (e) {
    console.error('Failed to require face-api:', e)
}
