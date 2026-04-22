import { describe, expect, test } from 'bun:test'
import type { CustomFieldContext, CustomFieldDefinition } from '@shared/types'
import { fieldMatchesContext, MAX_CUSTOM_FIELDS, MAX_SELECT_OPTIONS } from '@shared/types'

function makeField(context: CustomFieldContext): CustomFieldDefinition {
  return {
    id: 'test-id',
    name: 'test_field',
    label: 'Test',
    type: 'text',
    required: false,
    options: [],
    visibleTo: 'contacts:envelope-summary',
    context,
    order: 0,
    createdAt: new Date().toISOString(),
  }
}

describe('custom-fields', () => {
  test('MAX_CUSTOM_FIELDS is 20', () => {
    expect(MAX_CUSTOM_FIELDS).toBe(20)
  })

  test('MAX_SELECT_OPTIONS is 50', () => {
    expect(MAX_SELECT_OPTIONS).toBe(50)
  })

  describe('fieldMatchesContext', () => {
    test('exact context match returns true', () => {
      expect(fieldMatchesContext(makeField('call-notes'), 'call-notes')).toBe(true)
    })

    test('mismatched specific contexts return false', () => {
      expect(fieldMatchesContext(makeField('call-notes'), 'reports')).toBe(false)
      expect(fieldMatchesContext(makeField('reports'), 'call-notes')).toBe(false)
      expect(fieldMatchesContext(makeField('conversation-notes'), 'call-notes')).toBe(false)
    })

    test('context "all" matches every specific context', () => {
      const allContexts: CustomFieldContext[] = [
        'call-notes',
        'conversation-notes',
        'reports',
        'all',
      ]
      for (const ctx of allContexts) {
        expect(fieldMatchesContext(makeField('all'), ctx)).toBe(true)
      }
    })
  })
})
