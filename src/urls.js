'use strict'

// Hosts allowed to render inside the app window. Anything else opens in the
// system browser, so a link inside a chat can never replace the app frame.
const INTERNAL = [
  'chatgpt.com',
  'openai.com',
  'oaistatic.com',
  'oaiusercontent.com',
  'sora.com',
]

// Identity providers ChatGPT hands sign-in off to. These have to render
// somewhere inside the app or login dead-ends on a blank window.
const AUTH = [
  'accounts.google.com',
  'accounts.youtube.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'auth0.com',
  'okta.com',
  'duosecurity.com',
  'gstatic.com',
  'googleusercontent.com',
]

function hostMatches (url, suffixes) {
  let hostname
  try {
    ({ hostname } = new URL(url))
  } catch {
    return false
  }
  return suffixes.some((s) => hostname === s || hostname.endsWith(`.${s}`))
}

const isInternal = (url) => hostMatches(url, INTERNAL)
const isAuth = (url) => hostMatches(url, AUTH)

// Only ever hand http(s)/mailto to the system browser — never file://, and
// never a custom scheme a page could use to launch a local handler.
function isSafeExternal (url) {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

module.exports = { INTERNAL, AUTH, isInternal, isAuth, isSafeExternal }
