import {
  create as webauthnCreate,
  parseCreationOptionsFromJSON,
} from '@github/webauthn-json/browser-ponyfill'
import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Fingerprint, Loader2, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'

import { ReauthenticateStep, requiresReauth } from '@/components/auth/reauthenticate-step'
import { SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { auth } from '@/lib/auth/api'
import { bannerError, fieldErrorMessage } from '@/lib/auth/errors'
import { useAddWebAuthn, useAuthenticators, useDeleteWebAuthn } from '@/lib/auth/mfa'
import { signalDeletedPasskey } from '@/lib/auth/passkey-signal'

export const Route = createFileRoute('/account/mfa/webauthn')({
  component: WebAuthnPage,
  head: () => ({ meta: [{ title: 'Passkeys — music' }] }),
})

// Shape of one entry in the GET /account/authenticators list, narrowed to
// the fields we care about for the passkey row. allauth's headless API
// flattens the webauthn-specific fields onto the top level (`name`,
// `is_passwordless`) — the nested `data` JSON column on the underlying
// Authenticator model is NOT exposed here.
type AuthenticatorEntry = {
  id?: number
  type?: string
  name?: string
  is_passwordless?: boolean
  created_at?: number | null
  last_used_at?: number | null
}

// Detect feature support — WebAuthn requires a secure context (localhost or
// HTTPS) and PublicKeyCredential to be present.
const supportsWebAuthn =
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof window.PublicKeyCredential !== 'undefined'

function WebAuthnPage() {
  const navigate = useNavigate()
  const authenticators = useAuthenticators()
  const deleteWa = useDeleteWebAuthn()

  // Two sensitive actions on this page need a fresh-session password reauth
  // before allauth lets them through: enrolling a new passkey, and removing
  // an existing one. We use a single reauth step shared by both; the
  // `pendingDelete` state records the row we were about to delete so we can
  // retry it once reauth succeeds. Without that, the user would re-enter
  // their password and then nothing would happen.
  const [phase, setPhase] = useState<'idle' | 'reauth' | 'enrolling'>('idle')
  const [pendingDelete, setPendingDelete] = useState<{
    id: number
    name: string
    credentialId?: string
  } | null>(null)

  const entries = (authenticators.data?.data as AuthenticatorEntry[] | undefined) ?? []
  const passkeys = entries.filter((e) => e.type === 'webauthn')

  // Issue the actual delete + post-success Signal API call. Shared between
  // the "session was already fresh" path (called directly from handleRemove)
  // and the "needed reauth first" path (called from the reauth onConfirmed).
  const runDelete = async (id: number, credentialId?: string) => {
    const res = await deleteWa.mutateAsync([id])
    if (res.status === 200) {
      if (credentialId) {
        // Tell the device's authenticator to drop its local copy. Spec is
        // privacy-preserving — silent on success/failure; we don't await.
        void signalDeletedPasskey(credentialId)
      }
      toast.success('Passkey removed.')
      return true
    }
    const msg = bannerError(res, 'Could not remove passkey. Try again.')
    if (msg) toast.error(msg)
    return false
  }

  const handleRemove = async (id: number, name: string) => {
    if (deleteWa.isPending) return
    // No confirm modal — the reauth-password step (when the session isn't
    // fresh) IS the deliberate-action gate. For an already-fresh session the
    // DELETE goes through immediately, same as removing the TOTP recovery
    // code on this page's sibling — the "are you sure" weight comes from
    // the password challenge, not a dismissible dialog.

    // Look up the WebAuthn credential id BEFORE the delete — once the
    // server row is gone, the lookup endpoint won't return it.
    const credentialIds = await auth
      .passkeyCredentialIds()
      .catch(() => ({}) as Record<string, string>)
    const credentialId = credentialIds[String(id)]

    // First attempt. If the session isn't fresh enough, allauth returns
    // 401 + `reauthenticate` flow — surface the reauth step, then retry
    // the delete via runDelete() in the onConfirmed callback.
    const res = await deleteWa.mutateAsync([id])
    if (requiresReauth(res)) {
      setPendingDelete({ id, name, credentialId })
      setPhase('reauth')
      return
    }
    if (res.status === 200) {
      if (credentialId) void signalDeletedPasskey(credentialId)
      toast.success('Passkey removed.')
    } else {
      const msg = bannerError(res, 'Could not remove passkey. Try again.')
      if (msg) toast.error(msg)
    }
  }

  // Single reauth handler — branches based on whether we were trying to
  // delete or enroll. Keeps the ReauthenticateStep usage to one place.
  const handleReauthConfirmed = async () => {
    if (pendingDelete) {
      const { id, credentialId } = pendingDelete
      setPendingDelete(null)
      setPhase('idle')
      await runDelete(id, credentialId)
      return
    }
    setPhase('enrolling')
  }

  const handleReauthCancel = () => {
    setPendingDelete(null)
    setPhase('idle')
  }

  // ─── Render ──────────────────────────────────────────────────────────

  return (
    <SettingsPageShell
      breadcrumbs={[
        { label: 'Settings', to: '/settings' },
        { label: 'Multi-factor authentication', to: '/account/mfa' },
        { label: 'Passkeys' },
      ]}
      title="Passkeys"
      description="Sign in with Touch ID, Face ID, Windows Hello, or a hardware security key. Each device you enroll creates a passkey scoped to this site — phishing-resistant by design."
    >
      {!supportsWebAuthn ? (
        <p role="alert" className="text-destructive text-sm">
          Your browser doesn’t support WebAuthn (or you’re on an insecure origin). Try a modern
          browser over HTTPS.
        </p>
      ) : null}

      {/* Existing passkeys */}
      {passkeys.length > 0 ? (
        <ul className="divide-border bg-card divide-y rounded-md border" role="list">
          {passkeys.map((p) => (
            <PasskeyRow
              key={p.id}
              name={p.name ?? 'Unnamed passkey'}
              createdAt={p.created_at}
              lastUsedAt={p.last_used_at}
              onRemove={() => p.id && handleRemove(p.id, p.name ?? 'this passkey')}
              removing={deleteWa.isPending}
            />
          ))}
        </ul>
      ) : null}

      {/* Enroll a new one */}
      {phase === 'idle' ? (
        <Button
          variant="default"
          disabled={!supportsWebAuthn}
          onClick={() => setPhase('reauth')}
          className="w-full"
        >
          <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
          {passkeys.length === 0 ? 'Enroll a passkey' : 'Add another passkey'}
        </Button>
      ) : null}

      {phase === 'reauth' ? (
        <ReauthenticateStep
          description={
            pendingDelete
              ? `Removing "${pendingDelete.name}" is a sensitive change — re-enter your password to continue.`
              : 'Adding a passkey is a sensitive change — re-enter your password to continue.'
          }
          onConfirmed={handleReauthConfirmed}
          onCancel={handleReauthCancel}
        />
      ) : null}

      {phase === 'enrolling' ? (
        <EnrollStep
          onDone={() => {
            setPhase('idle')
            navigate({ to: '/account/mfa' })
          }}
          onCancel={() => setPhase('idle')}
        />
      ) : null}
    </SettingsPageShell>
  )
}

function PasskeyRow({
  name,
  createdAt,
  lastUsedAt,
  onRemove,
  removing,
}: {
  name: string
  createdAt?: number | null
  lastUsedAt?: number | null
  onRemove: () => void
  removing: boolean
}) {
  const fmt = (epochSec?: number | null) =>
    epochSec ? new Date(epochSec * 1000).toLocaleString() : '—'
  return (
    <li className="flex items-start justify-between gap-4 p-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-success h-4 w-4" aria-hidden="true" />
          <p className="text-sm font-medium">{name}</p>
        </div>
        <p className="text-muted-foreground text-xs">
          Enrolled {fmt(createdAt)} · Last used {fmt(lastUsedAt)}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={removing}
        aria-busy={removing || undefined}
        aria-label={`Remove passkey ${name}`}
      >
        <Trash2 className="mr-1 h-4 w-4" aria-hidden="true" />
        Remove
      </Button>
    </li>
  )
}

// Step 2: name + register. Fetches creation options, calls
// navigator.credentials.create() via @github/webauthn-json (handles
// base64url ↔ ArrayBuffer for us), then POSTs the attestation.
const enrollSchema = z.object({
  name: z.string().min(1, 'Required').max(100, 'At most 100 characters'),
})

function EnrollStep({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const add = useAddWebAuthn()
  const [creating, setCreating] = useState(false)

  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      if (creating || add.isPending) return
      setCreating(true)
      try {
        // Re-fetch creation options for each attempt — the server stores
        // a one-shot challenge in the session, so we can't reuse a stale one.
        const optsRes = await auth.getWebAuthnCreationOptions()
        if (optsRes.status !== 200 || requiresReauth(optsRes)) {
          toast.error('Session expired — refresh and try again.')
          return
        }
        const creationOptions = (optsRes.data as { creation_options?: { publicKey?: unknown } })
          ?.creation_options
        if (!creationOptions || typeof creationOptions !== 'object') {
          toast.error('Server didn’t return enrollment options. Try again.')
          return
        }

        // Two-step conversion: parseCreationOptionsFromJSON turns the
        // base64url-encoded `challenge` / `user.id` / `excludeCredentials[].id`
        // into ArrayBuffers (what navigator.credentials.create requires);
        // .toJSON() on the resulting credential turns the ArrayBuffer
        // attestation back into base64url strings for the POST body.
        const parsed = parseCreationOptionsFromJSON(
          creationOptions as Parameters<typeof parseCreationOptionsFromJSON>[0],
        )
        const credentialObj = await webauthnCreate(parsed)
        const credential = credentialObj.toJSON()

        const res = await add.mutateAsync({ name: value.name.trim(), credential })
        if (res.status === 200 || res.status === 201) {
          toast.success('Passkey enrolled.')
          onDone()
        } else {
          const msg = bannerError(res, 'Could not enroll passkey. Try again.')
          if (msg) toast.error(msg)
        }
      } catch (e) {
        // Includes the user cancelling the platform prompt, which throws
        // DOMException(NotAllowedError). Swallow with a soft message —
        // they'll try again.
        const name = (e as DOMException | Error).name
        if (name === 'NotAllowedError') {
          toast.error('Enrollment cancelled.')
        } else {
          toast.error('Your device couldn’t complete the passkey. Try again.')
        }
      } finally {
        setCreating(false)
      }
    },
    validators: { onSubmit: enrollSchema },
  })

  const busy = creating || add.isPending

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="bg-card space-y-4 rounded-md border p-4"
      aria-labelledby="enroll-heading"
    >
      <div>
        <h2 id="enroll-heading" className="font-medium">
          Name this passkey
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Pick something you’ll recognize later — like “MacBook Touch ID” or “YubiKey 5”.
        </p>
      </div>
      <form.Field name="name">
        {(field) => {
          const errorMsg = fieldErrorMessage(field.state.meta.errors[0])
          return (
            <div className="space-y-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                Name
              </label>
              <Input
                id={field.name}
                type="text"
                autoFocus
                required
                aria-required="true"
                aria-invalid={errorMsg ? true : undefined}
                aria-errormessage={errorMsg ? `${field.name}-error` : undefined}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="MacBook Touch ID"
              />
              <FormError id={`${field.name}-error`} message={errorMsg} />
            </div>
          )
        }}
      </form.Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Enrolling…
            </>
          ) : (
            <>
              <Fingerprint className="mr-2 h-4 w-4" aria-hidden="true" />
              Enroll passkey
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
