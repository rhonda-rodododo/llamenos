import { beforeAll, describe, expect, test } from 'bun:test'
import i18n from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { initReactI18next } from 'react-i18next'
import {
  SectionActions,
  SectionBanner,
  SectionBody,
  SectionDescription,
  SectionField,
  SectionToggleField,
} from './section-layout'

// Minimal i18n bootstrap — SectionActions calls useTranslation().t('common.save').
const COMMON_RESOURCES = {
  common: {
    save: 'Save',
    saved: 'Saved',
  },
}

beforeAll(async () => {
  if (!i18n.isInitialized) {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: { en: { translation: COMMON_RESOURCES } },
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    })
  } else {
    i18n.addResourceBundle('en', 'translation', COMMON_RESOURCES, true, true)
  }
})

describe('SectionBody', () => {
  test('default surface renders admin spacing (space-y-7)', () => {
    const html = renderToStaticMarkup(<SectionBody data-testid="body">child</SectionBody>)
    expect(html).toContain('space-y-7')
    expect(html).not.toContain('space-y-6')
    expect(html).toContain('data-testid="body"')
  })

  test('user surface renders user spacing (space-y-6)', () => {
    const html = renderToStaticMarkup(
      <SectionBody surface="user" data-testid="body">
        child
      </SectionBody>
    )
    expect(html).toContain('space-y-6')
    expect(html).not.toContain('space-y-7')
  })
})

describe('SectionDescription', () => {
  test('default surface uses leading-relaxed', () => {
    const html = renderToStaticMarkup(<SectionDescription>hi</SectionDescription>)
    expect(html).toContain('leading-relaxed')
  })

  test('user surface omits leading-relaxed', () => {
    const html = renderToStaticMarkup(<SectionDescription surface="user">hi</SectionDescription>)
    expect(html).not.toContain('leading-relaxed')
  })
})

describe('SectionField', () => {
  test('renders label + child + help', () => {
    const html = renderToStaticMarkup(
      <SectionField label="Name" htmlFor="name" help="Required for registration">
        <input id="name" />
      </SectionField>
    )
    expect(html).toContain('Name')
    expect(html).toContain('for="name"')
    expect(html).toContain('Required for registration')
  })

  test('error replaces help text', () => {
    const html = renderToStaticMarkup(
      <SectionField label="Name" htmlFor="name" help="Required" error="Too short">
        <input id="name" />
      </SectionField>
    )
    expect(html).toContain('Too short')
    expect(html).not.toContain('Required')
  })

  test('required shows asterisk', () => {
    const html = renderToStaticMarkup(
      <SectionField label="Name" htmlFor="name" required>
        <input id="name" />
      </SectionField>
    )
    expect(html).toContain('*')
  })
})

describe('SectionToggleField', () => {
  test('renders label and child horizontally', () => {
    const html = renderToStaticMarkup(
      <SectionToggleField label="Enable feature" htmlFor="toggle" help="Turn it on">
        <input type="checkbox" id="toggle" />
      </SectionToggleField>
    )
    expect(html).toContain('Enable feature')
    expect(html).toContain('Turn it on')
    expect(html).toContain('justify-between')
  })
})

describe('SectionActions', () => {
  test('admin surface produces admin- testid prefix', () => {
    const html = renderToStaticMarkup(<SectionActions slug="foo" onSave={() => {}} showSaved />)
    expect(html).toContain('data-testid="admin-foo-save"')
    expect(html).toContain('data-testid="admin-foo-save-success"')
  })

  test('user surface produces user- testid prefix', () => {
    const html = renderToStaticMarkup(
      <SectionActions surface="user" slug="foo" onSave={() => {}} showSaved />
    )
    expect(html).toContain('data-testid="user-foo-save"')
    expect(html).toContain('data-testid="user-foo-save-success"')
  })

  test('saveButtonTestId overrides default testid', () => {
    const html = renderToStaticMarkup(
      <SectionActions surface="user" slug="pin" saveButtonTestId="submit-pin" onSave={() => {}} />
    )
    expect(html).toContain('data-testid="submit-pin"')
    expect(html).not.toContain('data-testid="user-pin-save"')
  })

  test('admin surface places success indicator with ml-auto (right-aligned)', () => {
    const html = renderToStaticMarkup(<SectionActions slug="foo" onSave={() => {}} showSaved />)
    expect(html).toContain('ml-auto')
  })

  test('user surface success indicator does not use ml-auto', () => {
    const html = renderToStaticMarkup(
      <SectionActions surface="user" slug="foo" onSave={() => {}} showSaved />
    )
    // user surface uses inline gap-1, no ml-auto layout
    const successSection = html.split('user-foo-save-success')[1] ?? ''
    expect(successSection).not.toContain('ml-auto')
  })

  test('disabled propagates to button', () => {
    const html = renderToStaticMarkup(<SectionActions slug="foo" onSave={() => {}} disabled />)
    expect(html).toContain('disabled=""')
  })

  test('saving propagates to button (disabled)', () => {
    const html = renderToStaticMarkup(<SectionActions slug="foo" onSave={() => {}} saving />)
    expect(html).toContain('disabled=""')
  })

  test('custom save label overrides default', () => {
    const html = renderToStaticMarkup(
      <SectionActions slug="foo" onSave={() => {}} saveLabel="Apply" />
    )
    expect(html).toContain('Apply')
  })
})

describe('SectionBanner', () => {
  test('default tone is info', () => {
    const html = renderToStaticMarkup(<SectionBanner>hello</SectionBanner>)
    expect(html).toContain('bg-muted/40')
    expect(html).toContain('hello')
  })

  test('warn tone applies amber palette', () => {
    const html = renderToStaticMarkup(<SectionBanner tone="warn">!</SectionBanner>)
    expect(html).toContain('amber-500')
  })

  test('danger tone applies destructive palette', () => {
    const html = renderToStaticMarkup(<SectionBanner tone="danger">!</SectionBanner>)
    expect(html).toContain('destructive')
  })
})
