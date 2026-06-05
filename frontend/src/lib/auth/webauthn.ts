/**
 * Passkey (WebAuthn) registration via the **browser-native** JSON APIs — replacing
 * the deprecated `@github/webauthn-json`.
 *
 * `PublicKeyCredential.parseCreationOptionsFromJSON` decodes the server's base64url
 * `challenge` / `user.id` / `excludeCredentials[].id` into the ArrayBuffers that
 * `navigator.credentials.create()` requires; `credential.toJSON()` re-encodes the
 * resulting attestation back to base64url JSON for the POST body. Baseline across
 * modern browsers since 2024 (Chrome/Edge 119+, Safari 17.4+, Firefox 119+).
 */
export async function createPasskey(options: PublicKeyCredentialCreationOptionsJSON) {
  const publicKey = PublicKeyCredential.parseCreationOptionsFromJSON(options)
  const credential = (await navigator.credentials.create({
    publicKey,
  })) as PublicKeyCredential | null
  if (!credential) throw new Error('Passkey registration was cancelled.')
  return credential.toJSON()
}
