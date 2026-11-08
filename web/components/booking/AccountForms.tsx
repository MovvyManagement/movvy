'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabaseBrowser } from '@/lib/supabase/client';
import {
  callFunction,
  formatPhone,
  isPhoneComplete,
  MIN_PASSWORD_LENGTH,
  TERMS_VERSION,
  toE164,
} from '@/lib/movvy';
import { Button, ErrorNote, Field } from './ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Accepts an email or a 10-digit phone number, like the app's login. */
function credentials(login: string, password: string) {
  const value = login.trim();
  return value.includes('@')
    ? { email: value.toLowerCase(), password }
    : { phone: toE164(value), password };
}

export function SignInForm({
  onSignedIn,
  onForgot,
  submitLabel = 'Sign in',
}: {
  onSignedIn: () => void;
  onForgot: () => void;
  submitLabel?: string;
}) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!login.trim() || !password) {
      setError('Enter your email or phone number and your password.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabaseBrowser().auth.signInWithPassword(
      credentials(login, password) as never,
    );
    setBusy(false);
    if (signInError) {
      setError('That login and password did not match. Check them and try again.');
      return;
    }
    onSignedIn();
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Field label="Email or phone number" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
      <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" loading={busy} className="w-full">
        {submitLabel}
      </Button>
      <button type="button" onClick={onForgot} className="block w-full text-center text-sm font-semibold text-brand-800 hover:underline">
        Forgot your password?
      </button>
    </form>
  );
}

export function SignUpForm({ onSignedUp, onHaveAccount }: { onSignedUp: () => void; onHaveAccount: () => void }) {
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [code, setCode] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [existing, setExisting] = useState(false);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const sendCode = async () => {
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = 'Enter your full name.';
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!isPhoneComplete(phone)) errors.phone = 'Enter your 10-digit phone number.';
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (!terms) errors.terms = "Please accept Movvy's Terms to continue.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setBusy(true);
    setError(null);
    setExisting(false);
    const phoneE164 = toE164(phone);
    const { error: signUpError } = await supabaseBrowser().auth.signUp({
      phone: phoneE164,
      password,
      options: {
        data: {
          full_name: name.trim(),
          role: 'customer',
          email: email.trim().toLowerCase(),
          phone: phoneE164,
          terms_accepted_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        },
      },
    });
    setBusy(false);
    if (signUpError) {
      const message = signUpError.message.toLowerCase();
      if (message.includes('already') || message.includes('registered')) {
        setExisting(true);
        setError('That phone number already has a Movvy account.');
      } else if (message.includes('sms') || message.includes('phone provider') || message.includes('disabled')) {
        setError("We couldn't text you a code right now. Please try again later.");
      } else {
        setError(signUpError.message);
      }
      return;
    }
    setCode('');
    setResendIn(60);
    setStep('code');
  };

  const verify = async () => {
    const token = code.replace(/\D/g, '');
    if (token.length !== 6) {
      setError('Enter the 6-digit code we texted you.');
      return;
    }
    setBusy(true);
    setError(null);
    const supabase = supabaseBrowser();
    const { error: verifyError } = await supabase.auth.verifyOtp({ phone: toE164(phone), token, type: 'sms' });
    if (verifyError) {
      setBusy(false);
      setError(
        verifyError.message.toLowerCase().includes('expired')
          ? 'That code expired. Send a new one.'
          : "That code didn't match. Check your messages and try again.",
      );
      return;
    }

    // Phone is the verified identity. Email failures here must not block booking.
    const cleanEmail = email.trim().toLowerCase();
    try {
      await supabase.auth.updateUser({ email: cleanEmail });
      const { data } = await supabase.auth.getUser();
      if (data.user) await supabase.from('profiles').update({ email: cleanEmail }).eq('id', data.user.id);
    } catch (e) {
      console.warn('[signup] attaching email failed', e);
    }
    setBusy(false);
    onSignedUp();
  };

  if (step === 'code') {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          verify();
        }}
      >
        <p className="text-sm text-silver-600">
          We texted a 6-digit code to <strong className="text-ink-900">{formatPhone(phone)}</strong>.
        </p>
        <Field
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" loading={busy} className="w-full">
          Verify and continue
        </Button>
        <div className="flex justify-between text-sm font-semibold">
          <button type="button" onClick={() => setStep('details')} className="text-silver-600 hover:text-ink-900">
            Edit details
          </button>
          <button type="button" disabled={resendIn > 0 || busy} onClick={sendCode} className="text-brand-800 disabled:text-silver-400">
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend code'}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        sendCode();
      }}
    >
      <Field label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={fieldErrors.name} />
      <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" error={fieldErrors.email} />
      <Field
        label="Phone number"
        type="tel"
        inputMode="tel"
        placeholder="(403) 555-0123"
        value={formatPhone(phone)}
        onChange={(e) => setPhone(e.target.value)}
        autoComplete="tel-national"
        hint="We'll text a code to verify it. The last 4 digits unlock your live tracking."
        error={fieldErrors.phone}
      />
      <Field
        label="Create a password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. It also works in the Movvy app.`}
        error={fieldErrors.password}
      />
      <label className="flex items-start gap-3 text-sm text-silver-600">
        <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#0A7A3E]" />
        <span>
          I agree to Movvy&apos;s{' '}
          <Link href="/legal" target="_blank" className="font-semibold text-brand-800 underline">
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" target="_blank" className="font-semibold text-brand-800 underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>
      {fieldErrors.terms ? <p className="text-xs font-medium text-red-700">{fieldErrors.terms}</p> : null}
      <ErrorNote>{error}</ErrorNote>
      {existing ? (
        <Button variant="secondary" className="w-full" onClick={onHaveAccount}>
          Sign in instead
        </Button>
      ) : null}
      <Button type="submit" loading={busy} className="w-full">
        Text me a code
      </Button>
    </form>
  );
}

export function ForgotPasswordForm({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<'contact' | 'code' | 'password' | 'done'>('contact');
  const [login, setLogin] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contact = () => {
    const value = login.trim();
    return value.includes('@') ? { email: value.toLowerCase() } : { phone: toE164(value) };
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-silver-600">Your password is updated. You can sign in with it now.</p>
        <Button className="w-full" onClick={onDone}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 'contact') {
          run(async () => {
            await callFunction('password-reset-request', contact());
            setStep('code');
          });
        } else if (step === 'code') {
          run(async () => {
            await callFunction('password-reset-verify', { ...contact(), code });
            setStep('password');
          });
        } else {
          if (password.length < MIN_PASSWORD_LENGTH) {
            setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
            return;
          }
          run(async () => {
            await callFunction('password-reset-verify', { ...contact(), code, new_password: password });
            setStep('done');
          });
        }
      }}
    >
      {step === 'contact' ? (
        <Field label="Email or phone number" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
      ) : step === 'code' ? (
        <Field
          label="6-digit code"
          hint="If that account exists, we've sent it a code."
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      ) : (
        <Field label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      )}
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" loading={busy} className="w-full">
        {step === 'contact' ? 'Send code' : step === 'code' ? 'Continue' : 'Save password'}
      </Button>
      <button type="button" onClick={onDone} className="block w-full text-center text-sm font-semibold text-silver-600 hover:text-ink-900">
        Back to sign in
      </button>
    </form>
  );
}
