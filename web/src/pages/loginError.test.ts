import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/http'
import { loginErrorMessage, safeRedirectPath } from './loginError'

describe('loginErrorMessage', () => {
  it.each([
    [new ApiError(401, 'x'), 'E-posta veya parola hatalı.'],
    [new ApiError(400, 'x'), 'E-posta ve parola girin.'],
    [new ApiError(0, 'x'), 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip tekrar deneyin.'],
    [new ApiError(429, 'x', 30), 'Çok fazla giriş denemesi yapıldı. 30 saniye sonra tekrar deneyin.'],
    [new ApiError(429, 'x'), 'Çok fazla giriş denemesi yapıldı. Biraz sonra tekrar deneyin.'],
    [new ApiError(500, 'x'), 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'],
    [new Error('bilinmeyen'), 'Beklenmeyen bir hata oluştu. Lütfen tekrar deneyin.'],
  ])('%s', (err, expected) => {
    expect(loginErrorMessage(err)).toBe(expected)
  })

  it('sunucunun ham hata metnini kullanıcıya göstermez', () => {
    expect(loginErrorMessage(new ApiError(401, 'sunucunun-iç-metni'))).not.toContain('sunucunun-iç-metni')
  })
})

describe('safeRedirectPath', () => {
  it('uygulama içi mutlak yolu kabul eder', () => {
    expect(safeRedirectPath({ from: '/nodes/5?range=1h' })).toBe('/nodes/5?range=1h')
  })

  it.each([
    ['başka siteye yönlendiren //', { from: '//evil.example/x' }],
    ['tam URL', { from: 'https://evil.example' }],
    ['göreli yol', { from: 'nodes/5' }],
    ['metin olmayan', { from: 42 }],
    ['from yok', {}],
    ['null', null],
    ['tanımsız', undefined],
  ])('%s → "/"', (_name, state) => {
    expect(safeRedirectPath(state)).toBe('/')
  })
})
