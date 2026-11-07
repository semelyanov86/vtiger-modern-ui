import { describe, expect, it } from 'vitest'
import { recordTarget, recordUrl, STATE_KEY, stateRecord, withRecord } from '../src/record/target'

const BASE = 'https://crm.example/vtigercrm/index.php?module=Accounts&view=List'

describe('recordTarget: which navigations of a list become the record over the list', () => {
  it('a record of the module of the list, with or without the app of the menu', () => {
    expect(recordTarget('index.php?module=Accounts&view=Detail&record=42', 'Accounts', BASE)).toEqual({ module: 'Accounts', record: '42' })
    expect(recordTarget('https://crm.example/vtigercrm/index.php?module=Accounts&view=Detail&record=42&app=SALES', 'Accounts', BASE))
      .toEqual({ module: 'Accounts', record: '42' })
  })

  it('stays a normal navigation: another module, another view, a mode or tab, a hash, another origin or path, bad ids', () => {
    for (const url of [
      'index.php?module=Contacts&view=Detail&record=42',
      'index.php?module=Accounts&view=Edit&record=42',
      'index.php?module=Accounts&view=Detail&record=42&mode=showDetailViewByMode&requestMode=full',
      'index.php?module=Accounts&view=Detail&record=42&relatedModule=Contacts',
      'index.php?module=Accounts&view=Detail&record=42#tab',
      'https://other.example/vtigercrm/index.php?module=Accounts&view=Detail&record=42',
      'https://crm.example/other/index.php?module=Accounts&view=Detail&record=42',
      'index.php?module=Accounts&view=Detail&record=0',
      'index.php?module=Accounts&view=Detail&record=4x2',
      'index.php?module=Accounts&view=Detail',
      'javascript:alert(1)',
    ]) {
      expect(recordTarget(url, 'Accounts', BASE), url).toBeNull()
    }
  })
})

describe('history state of the overlay', () => {
  it('reads only its own entry for the module of the list', () => {
    expect(stateRecord({ [STATE_KEY]: { module: 'Accounts', record: '42' } }, 'Accounts')).toBe('42')
    expect(stateRecord({ [STATE_KEY]: { module: 'Contacts', record: '42' } }, 'Accounts')).toBeNull()
    expect(stateRecord({ [STATE_KEY]: { module: 'Accounts', record: '../1' } }, 'Accounts')).toBeNull()
    expect(stateRecord(null, 'Accounts')).toBeNull()
    expect(stateRecord('text', 'Accounts')).toBeNull()
  })

  it('keeps the state of the page and adds or removes only its key', () => {
    const page = { pjax: true }
    const added = withRecord(page, { module: 'Accounts', record: '7' })
    expect(added).toEqual({ pjax: true, [STATE_KEY]: { module: 'Accounts', record: '7' } })
    expect(page).toEqual({ pjax: true })
    expect(withRecord(added, null)).toEqual({ pjax: true })
    expect(withRecord(null, null)).toEqual({})
  })

  it('direct link of the record', () => {
    expect(recordUrl({ module: 'Accounts', record: '42' })).toBe('index.php?module=Accounts&view=Detail&record=42')
  })
})
