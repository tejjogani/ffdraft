import { request } from 'node:http'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { type CommandOutput, commands } from '@pave/schema'
import { type CadExamplesCall, writeCadExamples } from './assistant/cad-examples'

const usage = 'Usage: pnpm cad:examples --piece=<project id> --out=<new JSONL path>'

try {
  const { values } = parseArgs({
    options: {
      piece: { type: 'string' },
      out: { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    console.log(usage)
  } else {
    if (!values.piece?.trim() || !values.out?.trim()) throw new Error(usage)
    const port = Number(process.env.PORT ?? '8787')
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('Set PORT to the port of the local Pavé server.')

    const call: CadExamplesCall = async (name, input) => {
      const body = JSON.stringify(input)
      const response = await new Promise<string>((resolveReply, reject) => {
        const req = request(
          {
            hostname: '127.0.0.1',
            port,
            agent: false,
            method: 'POST',
            path: `/api/rpc/${name}`,
            headers: {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            },
            signal: AbortSignal.timeout(30_000),
          },
          async (res) => {
            if (res.statusCode !== 200) {
              res.resume()
              reject(new Error(`The local Pavé server refused ${name} (HTTP ${res.statusCode}).`))
              return
            }
            try {
              const chunks: Buffer[] = []
              for await (const chunk of res) chunks.push(chunk)
              resolveReply(Buffer.concat(chunks).toString('utf8'))
            } catch (err) {
              reject(err)
            }
          },
        )
        req.on('error', reject)
        req.end(body)
      })
      try {
        return commands[name].output.parse(JSON.parse(response)) as CommandOutput<typeof name>
      } catch {
        throw new Error(`Invalid ${name} response from the local Pavé server.`)
      }
    }

    const count = await writeCadExamples(call, values.piece, resolve(values.out))
    console.log(`Exported ${count} CAD evaluation ${count === 1 ? 'example' : 'examples'}.`)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : 'CAD evaluation export failed.')
  process.exitCode = 1
}
