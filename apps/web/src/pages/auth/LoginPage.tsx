import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { login } from '../../api/auth';
import { SIGNUP_PATH } from '../../shared/lib/appPaths';
import { replaceAppPath } from '../../shared/lib/navigation';
import { getSafeAuthRedirectPath } from './lib/authRedirect';
import './AuthPage.css';

interface LoginPageProps {
  isAuthenticated?: boolean;
  onAuthenticated?: () => void;
}

export function LoginPage({ isAuthenticated = false, onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectPath = useMemo(() => getSafeAuthRedirectPath(window.location.search, window.location.origin), []);
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

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
      await login({ email: email.trim(), password });
      onAuthenticated?.();
      replaceAppPath(redirectPath);
    } catch {
      setErrorMessage('로그인에 실패했습니다. 이메일과 비밀번호를 다시 확인해주세요.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-page__grain" />
      <main className="auth-page__main">
        <section className="auth-card" aria-labelledby="login-title">
          <h1 className="auth-card__title" id="login-title">Wedge</h1>

          <form className="auth-form" onSubmit={handleSubmit}>
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
                placeholder="비밀번호"
                autoComplete="current-password"
                required
              />
            </label>

            {errorMessage ? <p className="auth-card__error" role="alert">{errorMessage}</p> : null}

            <button className="auth-card__submit" type="submit" disabled={!canSubmit}>
              {isSubmitting ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p className="auth-card__switch">
            계정이 없나요? <a href={SIGNUP_PATH}>회원가입</a>
          </p>
        </section>
      </main>
    </div>
  );
}
