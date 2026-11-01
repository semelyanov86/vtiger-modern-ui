/**
 * Minimal declarations of the globals of a Vtiger 7 layout page that ModernUI reads.
 * They are optional on purpose: every access goes through adapters/v7/host.ts with existence checks.
 */
export {}

declare global {
  interface Window {
    /** Token of csrf-magic, printed into every full page of the CRM (name: csrfMagicName, usually __vtrftk). */
    csrfMagicToken?: unknown
    csrfMagicName?: unknown
    /** jQuery 2 of the host page; never replaced or used for our own requests. */
    jQuery?: unknown
    /** `app` of layouts/v7/resources/application.js. */
    app?: unknown
  }
}
