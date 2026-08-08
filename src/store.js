'use strict'

const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const FILE = path.join(app.getPath('userData'), 'settings.json')

const DEFAULTS = {
  bounds: { width: 1200, height: 860 },
  maximized: false,
  zoom: 0,
  closeToTray: true,
  startHidden: false,
  toggleShortcut: 'Control+Alt+G',
  spellcheckLanguages: ['en-US', 'nb'],
}

let cache = null
let timer = null

function get () {
  if (cache) return cache
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
  } catch {
    cache = { ...DEFAULTS }
  }
  return cache
}

// Writes are debounced because resize/move fire continuously while dragging.
function set (patch) {
  cache = { ...get(), ...patch }
  clearTimeout(timer)
  timer = setTimeout(flush, 400)
}

function flush () {
  clearTimeout(timer)
  if (!cache) return
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true })
    fs.writeFileSync(FILE, `${JSON.stringify(cache, null, 2)}\n`)
  } catch (err) {
    console.warn(`settings: could not save to ${FILE} —`, err.message)
  }
}

module.exports = { get, set, flush, FILE, DEFAULTS }
