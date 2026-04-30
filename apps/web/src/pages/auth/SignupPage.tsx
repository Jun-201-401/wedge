import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { signup } from '../../api/auth';
import { LOGIN_PATH } from '../../shared/lib/appPaths';
import { replaceAppPath } from '../../shared/lib/navigation';
import { getSafeAuthRedirectPath } from './lib/authRedirect';
import './AuthPage.css';

interface SignupPageProps {
  isAuthenticated?: boolean;
  onAuthenticated?: () => void;
}

export function SignupPage({ isAuthenticated = false, onAuthenticated }: SignupPageProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectPath = useMemo(() => getSafeAuthRedirectPath(window.location.search, window.location.origin), []);
  const canSubmit = displayName.trim().length >= 2 && email.trim().length > 0 && password.length >= 8 && !isSubmitting;

  useEffect(() => {
    if (isAuthenticated) {
      replaceAppPath(redirectPath);
    }
  }, [isAuthenticated, redirectPath]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');

    try {
      await signup({ displayName: displayName.trim(), email: email.trim(), password });
      onAuthenticated?.();
      replaceAppPath(redirectPath);
    } catch {
      setErrorMessage('회원가입에 실패했습니다. 이미 가입된 이메일이거나 입력값이 올바르지 않습니다.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-page__grain" />
      <main className="auth-page__main">
        <section className="auth-card" aria-labelledby="signup-title">
          <h1 className="auth-card__title" id="signup-title">Wedge</h1>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              <span>이름</span>
              <input
                type="text"
                name="displayName"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="홍길동"
                autoComplete="name"
                minLength={2}
                maxLength={120}
                required
              />
            </label>

            <label className="auth-field">
              <span>이메일</span>
              <input
                type="email"
                name="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="auth-field">
              <span>비밀번호</span>
              <input
                type="password"
                name="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="8자 이상"
                autoComplete="new-password"
                minLength={8}
                maxLength={100}
                required
              />
            </label>

            {errorMessage ? <p className="auth-card__error" role="alert">{errorMessage}</p> : null}

            <button className="auth-card__submit" type="submit" disabled={!canSubmit}>
              {isSubmitting ? '회원가입 중...' : '회원가입'}
            </button>
          </form>

          <p className="auth-card__switch">
            이미 계정이 있나요? <a href={LOGIN_PATH}>로그인</a>
          </p>
        </section>
      </main>
    </div>
  );
}
