/**
 * Russian plural rule for vue-i18n (docs/dependencies.md §4). Messages have three forms
 * "one | few | many" (1 пункт | 2 пункта | 5 пунктов); with a fourth leading form, 0 selects it.
 * The default rule of vue-i18n would give "1 записи, 21 записей".
 */
const russian = new Intl.PluralRules('ru-RU')

export function russianPlural(choice: number, choicesLength: number): number {
  const offset = choicesLength === 4 ? 1 : 0
  if (offset === 1 && choice === 0) {
    return 0
  }
  switch (russian.select(Math.abs(choice))) {
    case 'one':
      return offset
    case 'few':
      return offset + 1
    default:
      return offset + 2
  }
}
