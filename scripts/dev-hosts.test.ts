import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SCRIPT = path.resolve(import.meta.dir, 'dev-hosts.sh')

function run(hostsFile: string, ...args: string[]) {
  const res = spawnSync('bash', [SCRIPT, ...args], {
    env: { ...process.env, HOSTS_FILE: hostsFile },
    encoding: 'utf-8',
  })
  return { status: res.status, stdout: res.stdout, stderr: res.stderr }
}

describe('dev-hosts.sh (Tier 4 PR-A)', () => {
  let workDir: string
  let hostsFile: string

  beforeEach(() => {
    workDir = mkdtempSync(path.join(tmpdir(), 'dev-hosts-test-'))
    hostsFile = path.join(workDir, 'hosts')
    writeFileSync(hostsFile, '127.0.0.1 localhost\n::1 localhost\n')
  })

  afterEach(() => {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  })

  test('install adds the three split-origin dev hosts with markers', () => {
    const { status } = run(hostsFile, 'install')
    expect(status).toBe(0)
    const contents = readFileSync(hostsFile, 'utf-8')
    expect(contents).toContain('127.0.0.1 app.llamenos.localhost')
    expect(contents).toContain('127.0.0.1 api.llamenos.localhost')
    expect(contents).toContain('127.0.0.1 crypto.llamenos.localhost')
    expect(contents).toContain('# >>> llamenos-dev-hosts >>>')
    expect(contents).toContain('# <<< llamenos-dev-hosts <<<')
  })

  test('install is idempotent — running twice does not duplicate entries', () => {
    run(hostsFile, 'install')
    run(hostsFile, 'install')
    const contents = readFileSync(hostsFile, 'utf-8')
    const appCount = contents.match(/app\.llamenos\.localhost/g)?.length ?? 0
    const apiCount = contents.match(/api\.llamenos\.localhost/g)?.length ?? 0
    const cryptoCount = contents.match(/crypto\.llamenos\.localhost/g)?.length ?? 0
    expect(appCount).toBe(1)
    expect(apiCount).toBe(1)
    expect(cryptoCount).toBe(1)
  })

  test('--check exits 1 on fresh file, 0 after install', () => {
    expect(run(hostsFile, '--check').status).toBe(1)
    run(hostsFile, 'install')
    expect(run(hostsFile, '--check').status).toBe(0)
  })

  test('--remove strips the managed block but leaves pre-existing entries alone', () => {
    run(hostsFile, 'install')
    run(hostsFile, '--remove')
    const contents = readFileSync(hostsFile, 'utf-8')
    expect(contents).toContain('127.0.0.1 localhost')
    expect(contents).toContain('::1 localhost')
    expect(contents).not.toContain('app.llamenos.localhost')
    expect(contents).not.toContain('# >>> llamenos-dev-hosts >>>')
  })
})
