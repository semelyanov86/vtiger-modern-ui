/**
 * Confirmations of the module's own pages in the dialog of the theme instead of window.confirm() (docs/design.md
 * §13.12): one request at a time, answered by the ConfirmDialog the page renders. A promise resolves true for the
 * confirming button, false for Cancel, Esc or a click outside.
 */
import { shallowRef } from 'vue'

export interface ConfirmRequest {
  readonly title: string
  readonly text: string
  readonly confirm: string
  readonly cancel: string
  readonly danger: boolean
  readonly resolve: (ok: boolean) => void
}

export const confirmRequest = shallowRef<ConfirmRequest | null>(null)

export function ask(options: Omit<ConfirmRequest, 'resolve' | 'danger'> & { danger?: boolean }): Promise<boolean> {
  confirmRequest.value?.resolve(false)
  return new Promise((resolve) => {
    confirmRequest.value = {
      ...options,
      danger: options.danger === true,
      resolve: (ok) => {
        confirmRequest.value = null
        resolve(ok)
      },
    }
  })
}
