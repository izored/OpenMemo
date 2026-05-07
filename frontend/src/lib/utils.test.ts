import { describe, it, expect } from 'vitest'
import { cn } from './utils'

describe('cn()', () => {
  it('merges tailwind classes without conflict', () => {
    expect(cn('px-2 py-1', 'px-4')).toBe('py-1 px-4')
  })

  it('handles conditional classes', () => {
    const isActive = true;
    const isHidden = false;
    expect(cn('base', isActive && 'active', isHidden && 'hidden')).toBe('base active')
  })

  it('filters out falsy values', () => {
    expect(cn('a', null, undefined, false, '', 'b')).toBe('a b')
  })
})
