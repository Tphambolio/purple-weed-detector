#!/usr/bin/env node
// Downloads opencv.js into web/public/ if it isn't there yet.
// Runs automatically before `npm run dev` and `npm run build` via the
// predev / prebuild hooks in package.json. Skipped if the file already
// exists, so subsequent invocations are no-ops.

import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const target = path.resolve(__dirname, '..', 'public', 'opencv.js')
const source = 'https://docs.opencv.org/4.10.0/opencv.js'

if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) {
  process.exit(0)
}

console.log(`==> Downloading opencv.js (~10 MB) from ${source}`)
fs.mkdirSync(path.dirname(target), { recursive: true })

function fetch(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects (e.g. http → https, /4.10.0/ → /master/)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'))
        res.resume()
        return resolve(fetch(res.headers.location, redirectsLeft - 1))
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const tmp = target + '.part'
      const file = fs.createWriteStream(tmp)
      res.pipe(file)
      file.on('finish', () => {
        file.close((err) => {
          if (err) return reject(err)
          fs.renameSync(tmp, target)
          resolve()
        })
      })
      file.on('error', reject)
    }).on('error', reject)
  })
}

try {
  await fetch(source)
  const sizeKb = (fs.statSync(target).size / 1024).toFixed(0)
  console.log(`==> Wrote ${target} (${sizeKb} KB)`)
} catch (err) {
  console.error(`==> opencv.js download failed: ${err.message}`)
  console.error('    Manually download from', source, 'and place at', target)
  process.exit(1)
}
