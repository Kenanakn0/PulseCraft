import { describe, expect, it } from 'vitest'
import { MAX_NODE_NAME, validateNodeName } from './form'

describe('validateNodeName', () => {
  it.each(['', '   ', '\t'])('boş/boşluk adı reddeder: %j', (name) => {
    expect(validateNodeName(name)).toBe('Sunucu adı zorunlu.')
  })

  it('karakteri (bayt değil) sayar: 100 çok baytlı harf geçerli, 101 geçersiz', () => {
    expect(validateNodeName('ş'.repeat(MAX_NODE_NAME))).toBeNull()
    expect(validateNodeName('ş'.repeat(MAX_NODE_NAME + 1))).toBe('Sunucu adı en fazla 100 karakter olabilir.')
    // An emoji is two UTF-16 units in JS but one character (the server counts one rune too).
    expect(validateNodeName('😀'.repeat(MAX_NODE_NAME))).toBeNull()
  })

  it('kenar boşlukları sayılmaz', () => {
    expect(validateNodeName(`  ${'a'.repeat(MAX_NODE_NAME)}  `)).toBeNull()
    expect(validateNodeName('  web-01 ')).toBeNull()
  })
})
