'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { motion, useReducedMotion } from 'framer-motion'
import { AlertCircle, ArrowLeft, ArrowRight, Compass, Eye, EyeOff, Globe, Lock, ShieldCheck, User, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { getDefaultAdminPathForUser } from '@/lib/roleAccess'
import { isCompleteVerificationCode, normalizeVerificationCode } from '@/lib/mfaCodeInput'
import { RouteMap } from './RouteMap'

interface LoginFormData {
  username: string
  password: string
}

interface LoginResponse {
  message: string
  mfaRequired?: boolean
  user?: {
    id: number
    name: string
    email: string
    cemail: string
    role: number
    branch: number
    region: number
    type: string
    roleName?: string
    photo: string
    wfh: number
    permissions?: string[]
    mustChangePassword?: boolean
  }
}

const PILLARS: { icon: LucideIcon; label: string }[] = [
  { icon: Users, label: 'Role-based access' },
  { icon: ShieldCheck, label: 'Protected client records' },
  { icon: Globe, label: 'Multi-country programs' },
]

// Field outline: #9C8370 is 3.5:1 on white (WCAG 1.4.11 asks for 3:1); focus swaps it for a
// 2px navy ring and an error for a red one, so state never depends on colour alone being subtle.
const FIELD_BASE =
  'h-12 w-full rounded-xl border bg-white pl-11 text-[15px] text-[#2C353F] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-[#75675C] read-only:bg-[#F6EDE6] read-only:text-[#75675C]'
const FIELD_IDLE = 'border-[#9C8370] hover:border-[#6F5B4B] focus:border-[#1F3B63] focus:ring-[3px] focus:ring-[#1F3B63]/20'
const FIELD_INVALID = 'border-[#D9331E] focus:border-[#D9331E] focus:ring-[3px] focus:ring-[#D9331E]/25'

interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  id: string
  label: string
  icon: LucideIcon
  invalid?: boolean
  trailing?: React.ReactNode
  inputClassName?: string
}

function TextField({ id, label, icon: Icon, invalid = false, trailing, inputClassName = '', ...input }: TextFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-[13px] font-semibold text-[#2C353F]">
        {label}
      </label>
      <div className="group relative">
        <Icon
          aria-hidden="true"
          className={`pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 transition-colors ${
            invalid ? 'text-[#D9331E]' : 'text-[#6B5E55] group-focus-within:text-[#1F3B63]'
          }`}
        />
        <input
          id={id}
          aria-invalid={invalid || undefined}
          className={`${FIELD_BASE} ${invalid ? FIELD_INVALID : FIELD_IDLE} ${trailing ? 'pr-12' : 'pr-4'} ${inputClassName}`}
          {...input}
        />
        {trailing}
      </div>
    </div>
  )
}

function SubmitButton({ loading, idle, busy, disabled = false }: { loading: boolean; idle: string; busy: string; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="group relative flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-[#1F3B63] text-[15px] font-semibold text-white shadow-[0_1px_2px_rgba(20,39,63,0.25),0_10px_22px_-10px_rgba(31,59,99,0.65)] transition duration-150 before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-white/25 hover:bg-[#14273F] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#1F3B63]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FDF3EC] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70 disabled:active:scale-100"
    >
      {loading ? (
        <>
          <Compass className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {busy}
        </>
      ) : (
        <>
          {idle}
          <ArrowRight className="h-[18px] w-[18px] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
        </>
      )}
    </button>
  )
}

export default function LoginForm() {
  const router = useRouter()
  const { login } = useAuth()
  const reduceMotion = Boolean(useReducedMotion())
  const [formData, setFormData] = useState<LoginFormData>({
    username: '',
    password: ''
  })
  const [showPassword, setShowPassword] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Two-step login: once /api/auth/login reports mfaRequired, the form
  // switches to asking for the authenticator code instead of navigating —
  // the real session cookie isn't set until /api/auth/verify-mfa succeeds.
  const [mfaStep, setMfaStep] = useState(false)
  const [mfaCode, setMfaCode] = useState('')

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
    if (error) setError('')
  }

  const enterSession = (user: NonNullable<LoginResponse['user']>) => {
    const sessionUser = {
      id: user.id,
      name: user.name,
      email: user.email || user.cemail,
      role: user.role === 1 ? 'admin' : String(user.role),
      type: user.type,
      roleName: user.roleName,
      branch: user.branch ? String(user.branch) : undefined,
      avatar: user.photo || undefined,
      permissions: user.permissions || (user.role === 1 ? ['all'] : []),
      mustChangePassword: Boolean(user.mustChangePassword),
    }

    // Keep AuthContext and localStorage in sync before entering protected routes.
    login(sessionUser, 'cookie-session')

    // Redirect to the dashboard that matches the user's role
    router.replace(getDefaultAdminPathForUser(sessionUser))
    router.refresh()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      const data: LoginResponse = await response.json()

      if (response.ok && data.mfaRequired) {
        setMfaStep(true)
      } else if (response.ok && data.user) {
        enterSession(data.user)
      } else {
        setError(data.message || 'Login failed')
      }
    } catch (error) {
      console.error('Login error:', error)
      setError('An error occurred during login')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isCompleteVerificationCode(mfaCode)) return
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/verify-mfa', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: mfaCode }),
      })

      const data: LoginResponse = await response.json()

      if (response.ok && data.user) {
        enterSession(data.user)
      } else {
        setError(data.message || 'Invalid code')
      }
    } catch (error) {
      console.error('MFA verification error:', error)
      setError('An error occurred while verifying your code')
    } finally {
      setLoading(false)
    }
  }

  const backToSignIn = () => {
    setMfaStep(false)
    setMfaCode('')
    setError('')
  }

  // Content blocks rise in one after another; none of it moves for reduced-motion users.
  const rise = (index: number) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.45, delay: index * 0.07, ease: 'easeOut' as const },
  })

  const errorAlert = error ? (
    <motion.div
      role="alert"
      initial={reduceMotion ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-start gap-3 rounded-xl border border-[#F2B8B0] bg-[#FDECEA] px-4 py-3 text-sm text-[#B0241E]"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span id="login-error">{error}</span>
    </motion.div>
  ) : null

  return (
    <main className="min-h-dvh bg-[#FDF3EC] text-[#2C353F] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="relative flex min-h-dvh flex-col overflow-hidden">
        {/* Faint compass rose in the corner: the brand mark, kept well behind the form */}
        <svg
          viewBox="0 0 200 200"
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -right-48 hidden h-[26rem] w-[26rem] text-[#1F3B63] opacity-[0.05] sm:block"
        >
          <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="100" cy="100" r="78" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="1 6" />
          {Array.from({ length: 24 }).map((_, i) => (
            <line key={i} x1="100" y1="5" x2="100" y2={i % 6 === 0 ? 20 : 14} stroke="currentColor" strokeWidth={i % 6 === 0 ? 1.6 : 1} transform={`rotate(${i * 15} 100 100)`} />
          ))}
          <polygon points="100,24 111,100 100,90 89,100" fill="currentColor" />
          <polygon points="100,176 111,100 100,110 89,100" fill="currentColor" opacity="0.5" />
        </svg>

        {/* Phone: a short route-map banner stands in for the hero panel */}
        <div className="relative h-32 shrink-0 overflow-hidden rounded-b-[2rem] bg-gradient-to-br from-[#14273F] to-[#1F3B63] lg:hidden">
          <RouteMap compact />
        </div>

        <div className="relative flex flex-1 flex-col px-6 pb-8 pt-8 sm:px-12 lg:px-14 lg:pt-12 xl:px-20">
          <header>
            <Image src="/logo.png" alt="Global Navigator" width={176} height={96} priority className="h-[4.25rem] w-auto" />
          </header>

          <div className="flex flex-1 items-center py-10">
            <div className="mx-auto w-full max-w-[26rem]">
              <motion.div key={mfaStep ? 'mfa-heading' : 'signin-heading'} {...rise(0)} className="mb-8">
                <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-[#1F3B63]/[0.08] px-3 py-1 text-xs font-semibold text-[#1F3B63]">
                  {mfaStep ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" /> : <Lock className="h-3.5 w-3.5" aria-hidden="true" />}
                  {mfaStep ? 'Two-step verification' : 'Staff portal'}
                </span>
                <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-[#14273F]">
                  {mfaStep ? 'Enter your code' : 'Welcome back'}
                </h1>
                <p className="mt-2 text-balance leading-relaxed text-[#585A5E]">
                  {mfaStep
                    ? 'Open your authenticator app and enter the 6-digit code. Lost your phone? Use one of your backup codes instead.'
                    : 'Sign in to continue to the Global Navigator CRM.'}
                </p>
              </motion.div>

              {mfaStep ? (
                <form onSubmit={handleVerifyMfa} className="space-y-5" noValidate>
                  <motion.div key="mfa-field" {...rise(1)}>
                    <TextField
                      id="mfaCode"
                      name="mfaCode"
                      label="Verification code"
                      icon={ShieldCheck}
                      invalid={Boolean(error)}
                      inputClassName="font-mono text-lg tracking-[0.18em] placeholder:tracking-[0.18em]"
                      type="text"
                      inputMode="text"
                      autoFocus
                      autoComplete="one-time-code"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={11}
                      required
                      readOnly={loading}
                      value={mfaCode}
                      onChange={(e) => {
                        setMfaCode(normalizeVerificationCode(e.target.value))
                        if (error) setError('')
                      }}
                      placeholder="123456"
                      aria-describedby={error ? 'login-error' : 'mfa-hint'}
                    />
                    <p id="mfa-hint" className="mt-2 text-xs text-[#585A5E]">
                      Backup codes look like ABCDE-12345 and can be used once.
                    </p>
                  </motion.div>

                  <div aria-live="assertive">{errorAlert}</div>

                  <motion.div key="mfa-submit" {...rise(2)}>
                    <SubmitButton loading={loading} idle="Verify" busy="Verifying..." disabled={!isCompleteVerificationCode(mfaCode)} />
                  </motion.div>

                  <motion.div key="mfa-back" {...rise(3)} className="text-center">
                    <button
                      type="button"
                      onClick={backToSignIn}
                      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-[#1F3B63] transition-colors hover:text-[#D9331E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F3B63]/40"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      Back to sign in
                    </button>
                  </motion.div>
                </form>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <motion.div key="username" {...rise(1)}>
                    <TextField
                      id="username"
                      name="username"
                      label="Login ID"
                      icon={User}
                      invalid={Boolean(error)}
                      type="text"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      readOnly={loading}
                      value={formData.username}
                      onChange={handleInputChange}
                      placeholder="Enter your login ID"
                      aria-describedby={error ? 'login-error' : undefined}
                    />
                  </motion.div>

                  <motion.div key="password" {...rise(2)}>
                    <TextField
                      id="password"
                      name="password"
                      label="Password"
                      icon={Lock}
                      invalid={Boolean(error)}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      required
                      readOnly={loading}
                      value={formData.password}
                      onChange={handleInputChange}
                      onKeyDown={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                      onKeyUp={(e) => setCapsLock(e.getModifierState('CapsLock'))}
                      onBlur={() => setCapsLock(false)}
                      placeholder="Enter your password"
                      aria-describedby={error ? 'login-error' : undefined}
                      trailing={
                        <button
                          type="button"
                          onClick={() => setShowPassword((visible) => !visible)}
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          aria-pressed={showPassword}
                          className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[#6B5E55] transition-colors hover:text-[#1F3B63] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1F3B63]/40"
                        >
                          {showPassword ? <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Eye className="h-[18px] w-[18px]" aria-hidden="true" />}
                        </button>
                      }
                    />
                    {capsLock && (
                      <p role="status" className="mt-2 flex items-center gap-1.5 text-xs font-medium text-[#8A5200]">
                        <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        Caps Lock is on
                      </p>
                    )}
                  </motion.div>

                  <div aria-live="assertive">{errorAlert}</div>

                  <motion.div key="submit" {...rise(3)}>
                    <SubmitButton loading={loading} idle="Sign in" busy="Signing in..." />
                  </motion.div>

                  <motion.p key="help" {...rise(4)} className="text-balance text-center text-sm text-[#585A5E]">
                    Forgot your password? Ask your administrator or HR to reset it.
                  </motion.p>
                </form>
              )}
            </div>
          </div>

          <footer className="text-center text-xs text-[#6B5E55] lg:text-left">
            © {new Date().getFullYear()} Global Navigator · Authorised staff only
          </footer>
        </div>
      </section>

      {/* Desktop: the route map on top, the pitch beneath it */}
      <aside className="relative hidden flex-col overflow-hidden bg-gradient-to-br from-[#14273F] via-[#182F52] to-[#1F3B63] lg:flex">
        <div className="relative flex-[2]">
          <RouteMap />
        </div>

        <div className="relative z-10 flex flex-1 flex-col justify-end px-14 pb-12 xl:px-16">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-[#F6B44B]">Global Navigator CRM</p>
          <h2 className="max-w-md text-balance text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            From first enquiry to final approval.
          </h2>
          <p className="mt-3 max-w-md text-balance leading-relaxed text-[#E6D9CF]">
            One workspace for leads, clients, operations, payments and reporting across every Global Navigator branch.
          </p>
          <ul className="mt-6 flex flex-wrap gap-2">
            {PILLARS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[13px] font-medium text-white/90 backdrop-blur-sm"
              >
                <Icon className="h-4 w-4 text-[#F6B44B]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </main>
  )
}
