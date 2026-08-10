// Discord DM bot entry point. Natural free-form chat, not slash commands — every DM
// from the owner is forwarded to Claude (see bot/claude.js) with fitness data pulled
// live via MCP tools. Restricted to a single Discord user ID (OWNER_DISCORD_ID): this
// bot has direct read access to private health/nutrition data, so it must never
// respond to DMs from anyone else.
import 'dotenv/config'
import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js'
import { askClaude } from './claude.js'

const OWNER_DISCORD_ID = process.env.OWNER_DISCORD_ID
if (!OWNER_DISCORD_ID) throw new Error('OWNER_DISCORD_ID not configured')

const DISCORD_MESSAGE_LIMIT = 2000

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
})

client.once('clientReady', () => {
  console.log(`Logged in as ${client.user.tag}`)
})

client.on('messageCreate', async (message) => {
  if (message.author.bot) return
  if (message.channel.type !== ChannelType.DM) return
  if (message.author.id !== OWNER_DISCORD_ID) return
  if (!message.content.trim()) return

  console.log(`DM from ${message.author.id}: ${message.content}`)
  const typingInterval = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000)
  message.channel.sendTyping().catch(() => {})

  try {
    const reply = await askClaude(message.author.id, message.content)
    for (const chunk of splitMessage(reply)) {
      await message.channel.send(chunk)
    }
  } catch (err) {
    console.error('askClaude failed:', err)
    await message.channel.send("Something went wrong reaching Claude — I've logged the error, try again in a bit.")
  } finally {
    clearInterval(typingInterval)
  }
})

function splitMessage(text) {
  if (text.length <= DISCORD_MESSAGE_LIMIT) return [text || '(empty response)']
  const chunks = []
  for (let i = 0; i < text.length; i += DISCORD_MESSAGE_LIMIT) {
    chunks.push(text.slice(i, i + DISCORD_MESSAGE_LIMIT))
  }
  return chunks
}

client.login(process.env.DISCORD_BOT_TOKEN)
