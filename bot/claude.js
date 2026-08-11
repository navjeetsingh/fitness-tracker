// Invokes the Claude Code CLI in headless print mode (`claude -p`) as a subprocess,
// authenticated via CLAUDE_CODE_OAUTH_TOKEN (the user's Pro/Max subscription — see
// `claude setup-token` — rather than a separately-billed Anthropic API key). Each
// Discord DM thread gets its own Claude session ID so the CLI's own conversation
// history carries context across messages, without us re-sending prior turns.
// The coaching persona itself lives in ./CLAUDE.md (auto-discovered by the CLI from
// its cwd, which pm2 sets to this directory — see ATHLETE_PROFILE.md alongside it),
// not passed here — no --append-system-prompt needed.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { redis } from '../lib/redis.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MCP_SERVER_PATH = path.join(__dirname, 'mcp-server.js')
const SESSION_KEY_TTL = 6 * 60 * 60 // 6 hours of inactivity before a DM thread starts a fresh session
const CLI_TIMEOUT_MS = 120_000 // Garmin/Yazio logins on a cache miss can be slow

const MCP_CONFIG = JSON.stringify({
  mcpServers: {
    'fitness-tracker': { command: 'node', args: [MCP_SERVER_PATH] },
  },
})

const sessionKey = (discordUserId) => `bot:session:${discordUserId}`

/**
 * Sends one message to Claude on behalf of a given Discord user, resuming that
 * user's prior CLI session if one is still within its TTL window.
 *
 * @param {string} discordUserId
 * @param {string} message
 * @returns {Promise<string>} Claude's reply text
 */
export async function askClaude(discordUserId, message) {
  const existingSessionId = await redis.get(sessionKey(discordUserId))
  const sessionId = existingSessionId || randomUUID()

  const args = [
    '-p', message,
    '--tools', '',
    '--mcp-config', MCP_CONFIG,
    '--allowedTools', 'mcp__fitness-tracker__*',
    existingSessionId ? '--resume' : '--session-id', sessionId,
  ]

  const reply = await runClaude(args)
  await redis.set(sessionKey(discordUserId), sessionId, { ex: SESSION_KEY_TTL })
  return reply
}

function runClaude(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('claude CLI timed out'))
    }, CLI_TIMEOUT_MS)

    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('error', (err) => { clearTimeout(timer); reject(err) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${stderr.trim() || stdout.trim()}`))
      resolve(stdout.trim())
    })
  })
}
