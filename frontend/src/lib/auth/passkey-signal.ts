/**
 * WebAuthn Signal API integration.
 *
 * Background: when we DELETE a passkey on the server, our database forgets
 * the public key — but the **credential itself** still lives on the user's
 * device (Touch ID Keychain, Windows Hello credential vault, hardware key
 * memory, password-manager passkey store). The user is left with a stale
 * entry they have to find and delete manually.
 *
 * `PublicKeyCredential.signalUnknownCredential({ rpId, credentialId })`
 * tells the platform authenticator "this credential no longer exists at
 * the relying party — please remove it locally." Shipped in Chrome 132,
 * Safari 18, Firefox 132+; older browsers ignore it gracefully (we
 * feature-detect before calling).
 *
 * Privacy note: the spec deliberately returns no feedback about whether
 * the deletion succeeded — we treat this as best-effort and never block
 * the UX on it.
 *
 * Spec: https://www.w3.org/TR/webauthn-3/#sctn-signal-methods
 */

type SignalCapable = typeof PublicKeyCredential & {
  signalUnknownCredential?: (opts: { rpId: string; credentialId: string }) => Promise<void>
}

export function isSignalApiSupported(): boolean {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  return typeof (PublicKeyCredential as SignalCapable).signalUnknownCredential === 'function'
}

/**
 * Tell the device's authenticator to clean up a credential we just deleted
 * server-side. Best-effort: silently skipped on unsupported browsers, and
 * any thrown error is swallowed so the toast/UI flow continues.
 */
export async function signalDeletedPasskey(credentialId: string): Promise<void> {
  if (!isSignalApiSupported()) return
  if (!credentialId) return
  try {
    const fn = (PublicKeyCredential as SignalCapable).signalUnknownCredential
    if (!fn) return
    await fn({
      // rpId is the registrable domain — for `localhost` and `app.example.com`
      // alike, the hostname IS the rpId we registered with at enrollment time.
      rpId: window.location.hostname,
      credentialId,
    })
  } catch {
    // Spec is intentionally silent on success/failure; treat any throw as
    // "best effort, move on." Don't block the user's delete confirmation.
  }
}
