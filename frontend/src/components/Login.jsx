import PasswordRecovery from "./PasswordRecovery";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import ValidatedInput from "./ValidatedInput";
import { validateInput } from "../../../shared/inputValidation.mjs";

const API_URL = "http://localhost:3000";

const APPLE_FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif';

export default function Login() {
  const [showRecovery, setShowRecovery] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [errorVisible, setErrorVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    if (!error) return undefined;

    const hideTimer = window.setTimeout(() => {
      setErrorVisible(false);
    }, 4800);

    const clearTimer = window.setTimeout(() => {
      setError("");
    }, 5150);

    return () => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [error]);

  const showError = (message) => {
    setError("");

    window.requestAnimationFrame(() => {
      setErrorVisible(true);
      setError(message);
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmedName = name.trim();

    setError("");

    const nameError = validateInput(name, { kind: "username", label: "Username" });
    if (nameError) {
      showError(nameError);
      return;
    }

    const passwordError = validateInput(password, { kind: "password", label: "Password", minLength: isLoginMode ? 1 : 6 });
    if (passwordError) {
      showError(passwordError);
      return;
    }

    setSubmitting(true);

    const endpoint = isLoginMode
      ? "/login"
      : "/register";

    try {
      const response = await axios.post(
        `${API_URL}${endpoint}`,
        {
          name: trimmedName,
          password,
        },
      );

      const user =
        response.data.user || {
          name: trimmedName,
        };

      /*
        Keep compatibility with the current EduLITE dashboard.

        If the backend returns a token, store it.
      */
      const token =
        response.data.token ??
        response.data.accessToken ??
        response.data.access_token ??
        null;

      if (token) {
        localStorage.setItem(
          "eduliteToken",
          token,
        );
      }

      localStorage.setItem(
        "user",
        JSON.stringify(user),
      );

      navigate("/dashboard");
    } catch (requestError) {
      showError(
        requestError.response?.data?.message ||
          "Unable to connect to the server.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    if (submitting) {
      return;
    }

    setIsLoginMode(
      (currentMode) => !currentMode,
    );

    setError("");
    setPassword("");
    setShowPassword(false);
  };

  const dismissError = () => {
    setErrorVisible(false);

    window.setTimeout(() => {
      setError("");
    }, 300);
  };

  return (
    <div
      className="edulite-login min-h-screen bg-[var(--ed-surface)] text-[var(--ed-color-1c1c1e)]"
      style={{
        fontFamily: APPLE_FONT,
      }}
    >
      <style>{`
        .edulite-login * {
          box-sizing: border-box;
        }

        .edulite-login {
          color-scheme: inherit;
          overflow-x: hidden;
        }

        .edulite-login button,
        .edulite-login input {
          font: inherit;
        }

        .edulite-login button {
          transition:
            transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1),
            background-color 180ms ease,
            color 180ms ease,
            border-color 180ms ease,
            opacity 180ms ease;
        }

        .edulite-login button:not(:disabled):active {
          transform: scale(0.98);
        }

        .edulite-login input {
          transition:
            border-color 180ms ease,
            box-shadow 180ms ease,
            background-color 180ms ease;
        }

        .edulite-login :where(button, input):focus-visible {
          outline: none;
          box-shadow: 0 0 0 4px rgba(0, 145, 255, 0.16);
        }

        .login-page-enter {
          animation:
            login-page-in
            520ms
            cubic-bezier(0.2, 0.8, 0.2, 1)
            both;
        }

        .login-form-enter {
          animation:
            login-form-in
            560ms
            cubic-bezier(0.2, 0.8, 0.2, 1)
            both;
        }

        .login-toast {
          transform:
            translateY(-10px)
            scale(0.98);

          opacity: 0;

          pointer-events: none;

          transition:
            transform
              300ms
              cubic-bezier(0.2, 0.8, 0.2, 1),
            opacity
              260ms
              ease;
        }

        .login-toast.is-visible {
          transform:
            translateY(0)
            scale(1);

          opacity: 1;

          pointer-events: auto;
        }

        @keyframes login-page-in {
          from {
            opacity: 0;
          }

          to {
            opacity: 1;
          }
        }

        @keyframes login-form-in {
          from {
            opacity: 0;

            transform:
              translateY(14px);
          }

          to {
            opacity: 1;

            transform:
              translateY(0);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .edulite-login *,
          .edulite-login *::before,
          .edulite-login *::after {
            animation-duration:
              0.01ms !important;

            animation-iteration-count:
              1 !important;

            transition-duration:
              0.01ms !important;
          }
        }
      `}</style>

      {error && (
        <div
          className={`login-toast fixed right-4 top-4 z-50 w-[calc(100%-2rem)] max-w-[380px] rounded-[18px] border border-black/5 bg-[var(--ed-surface)]/90 p-4 shadow-[0_18px_50px_rgba(31,41,55,0.16)] backdrop-blur-[24px] sm:right-6 sm:top-6 ${
            errorVisible
              ? "is-visible"
              : ""
          }`}
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--ed-color-ff3b30)] text-sm font-bold text-white">
              !
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--ed-color-1c1c1e)]">
                EduLITE
              </p>

              <p className="mt-0.5 text-sm leading-5 text-[var(--ed-color-636366)]">
                {error}
              </p>
            </div>

            <button
              type="button"
              onClick={
                dismissError
              }
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg leading-none text-[var(--ed-color-8e8e93)] hover:bg-[var(--ed-color-f2f2f7)] hover:text-[var(--ed-color-1c1c1e)]"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <main className="login-page-enter relative min-h-screen">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-[-180px] top-[-220px] h-[520px] w-[520px] rounded-full bg-[#0091ff]/8 blur-3xl"
        />

        <div className="mx-auto grid min-h-screen w-full max-w-[1500px] grid-cols-1 lg:grid-cols-[1.08fr_0.92fr]">
          {/* LEFT SIDE */}
          <section className="relative flex min-h-[44vh] flex-col justify-between px-6 pb-10 pt-7 sm:px-10 sm:pb-14 sm:pt-10 lg:min-h-screen lg:px-16 lg:py-14 xl:px-24">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--ed-color-e5e5ea)] bg-[var(--ed-surface)]">
                <img
                  src="/logo.png"
                  alt="EduLITE logo"
                  className="h-9 w-9 object-contain"
                />
              </div>

              <div>
                <p className="text-sm font-bold tracking-tight text-[var(--ed-color-36454f)]">
                  EduLITE
                </p>

                <p className="text-[11px] text-[var(--ed-color-8e8e93)]">
                  Teacher Workspace
                </p>
              </div>
            </div>

            <div className="max-w-[720px] py-12 lg:py-0">
              <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[var(--ed-color-0091ff)]">
                Student Learning Workspace
              </p>

              <h1 className="mt-5 text-[clamp(3.4rem,7vw,7.5rem)] font-bold leading-[0.84] tracking-[-0.065em] text-[var(--ed-color-0091ff)]">
                EduLITE:

                <span className="mt-2 block text-[#3AAAE8]">
                  The Current
                  <br />
                  State.
                </span>
              </h1>

              <p className="mt-7 max-w-lg text-base leading-7 text-[var(--ed-color-636366)] sm:text-lg sm:leading-8">
                A focused workspace for
                student records,
                assessment results,
                performance review,
                and learning support.
              </p>
            </div>

            <p className="hidden max-w-md text-xs leading-5 text-[var(--ed-color-a1a1a6)] lg:block">
              Built for clear academic
              records and teacher-guided
              decisions.
            </p>
          </section>

          {/* RIGHT SIDE */}
          <section className="flex items-center border-t border-[var(--ed-color-eceff2)] bg-[var(--ed-color-fafbfc)] px-6 py-10 sm:px-10 lg:min-h-screen lg:border-l lg:border-t-0 lg:px-14 xl:px-20">
            <div className="login-form-enter mx-auto w-full max-w-[460px]">
              <div className="mb-10">
                <p className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--ed-color-0091ff)]">
                  {isLoginMode
                    ? "Welcome Back"
                    : "Create Account"}
                </p>

                <h2 className="mt-3 text-4xl font-bold tracking-[-0.04em] text-[var(--ed-color-36454f)] sm:text-5xl">
                  {isLoginMode
                    ? "Sign in."
                    : "Get started."}
                </h2>

                <p className="mt-3 max-w-md text-sm leading-6 text-[var(--ed-color-7a7a7f)]">
                  {isLoginMode
                    ? "Enter your EduLITE account details to continue."
                    : "Create an account to begin using the EduLITE workspace."}
                </p>
              </div>

              <div className="mb-7 inline-flex rounded-[13px] bg-[var(--ed-color-eceff2)] p-1">
                <ModeButton
                  active={
                    isLoginMode
                  }
                  label="Sign In"
                  onClick={() => {
                    if (
                      !isLoginMode
                    ) {
                      switchMode();
                    }
                  }}
                />

                <ModeButton
                  active={
                    !isLoginMode
                  }
                  label="Register"
                  onClick={() => {
                    if (
                      isLoginMode
                    ) {
                      switchMode();
                    }
                  }}
                />
              </div>

              <form
                onSubmit={
                  handleSubmit
                }
                className="space-y-5"
              >
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ed-color-3a3a3c)]">
                    Username
                  </span>

                  <ValidatedInput
                    id="username"
                    kind="username"
                    label="Username"
                    value={name}
                    onChange={(
                      event,
                    ) =>
                      setName(
                        event.target
                          .value,
                      )
                    }
                    placeholder="Enter your username"
                    autoComplete="username"
                    disabled={
                      submitting
                    }
                    className="w-full rounded-[15px] border border-[var(--ed-color-d9dde2)] bg-[var(--ed-surface)] px-4 py-3.5 text-base text-[var(--ed-color-1c1c1e)] placeholder-[var(--ed-color-a1a1a6)] outline-none focus:border-[var(--ed-color-0091ff)] disabled:cursor-not-allowed disabled:bg-[var(--ed-color-f2f2f7)]"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-semibold text-[var(--ed-color-3a3a3c)]">
                    Password
                  </span>

                  <div className="relative">
                    <ValidatedInput
                      id="password"
                      kind="password"
                      label="Password"
                      minLength={isLoginMode ? 1 : 6}
                      type={
                        showPassword
                          ? "text"
                          : "password"
                      }
                      value={password}
                      onChange={(
                        event,
                      ) =>
                        setPassword(
                          event.target
                            .value,
                        )
                      }
                      placeholder="Enter your password"
                      autoComplete={
                        isLoginMode
                          ? "current-password"
                          : "new-password"
                      }
                      disabled={
                        submitting
                      }
                      className="w-full rounded-[15px] border border-[var(--ed-color-d9dde2)] bg-[var(--ed-surface)] px-4 py-3.5 pr-20 text-base text-[var(--ed-color-1c1c1e)] placeholder-[var(--ed-color-a1a1a6)] outline-none focus:border-[var(--ed-color-0091ff)] disabled:cursor-not-allowed disabled:bg-[var(--ed-color-f2f2f7)]"
                      required
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowPassword(
                          (
                            currentValue,
                          ) =>
                            !currentValue,
                        )
                      }
                      disabled={
                        submitting
                      }
                      className="absolute right-0 top-0 flex h-[54px] items-center px-4 text-xs font-semibold text-[var(--ed-color-007aff)] disabled:cursor-not-allowed disabled:text-[var(--ed-color-a1a1a6)]"
                      aria-label={
                        showPassword
                          ? "Hide password"
                          : "Show password"
                      }
                    >
                      {showPassword
                        ? "Hide"
                        : "Show"}
                    </button>
                  </div>
                </label>

                {!isLoginMode && (
                  <p className="text-xs leading-5 text-[var(--ed-color-8e8e93)]">
                    Your username will be
                    used when signing in.
                    Use a password that is
                    difficult for other
                    people to guess.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting
                  }
                  className="mt-2 w-full rounded-[15px] bg-[#0091ff] px-5 py-3.5 text-sm font-semibold text-white hover:bg-[#007aff] disabled:cursor-not-allowed disabled:bg-[var(--ed-color-c7c7cc)]"
                >
                  {submitting
                    ? isLoginMode
                      ? "Signing in..."
                      : "Creating account..."
                    : isLoginMode
                      ? "Sign In"
                      : "Create Account"}
                </button>
              </form>
              {isLoginMode && <button type="button" className="mt-4 text-sm font-semibold text-[var(--ed-accent-text)]" onClick={() => setShowRecovery((current) => !current)}>Forgot password?</button>}
              {showRecovery && <PasswordRecovery onClose={() => setShowRecovery(false)} />}

              <p className="mt-7 text-sm text-[var(--ed-color-7a7a7f)]">
                {isLoginMode
                  ? "New to EduLITE?"
                  : "Already have an EduLITE account?"}{" "}

                <button
                  type="button"
                  onClick={
                    switchMode
                  }
                  disabled={
                    submitting
                  }
                  className="font-semibold text-[var(--ed-color-007aff)] hover:text-[var(--ed-color-005fcc)] disabled:cursor-not-allowed disabled:text-[var(--ed-color-a1a1a6)]"
                >
                  {isLoginMode
                    ? "Create an account"
                    : "Sign in"}
                </button>
              </p>

              <p className="mt-12 text-[11px] leading-5 text-[var(--ed-color-a1a1a6)]">
                EduLITE · Student
                performance and
                learning-support
                workspace
              </p>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function ModeButton({
  active,
  label,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-[10px] px-4 py-2 text-sm font-semibold ${
        active
          ? "bg-[var(--ed-surface)] text-[var(--ed-color-1c1c1e)] shadow-[0_1px_4px_rgba(31,41,55,0.08)]"
          : "text-[var(--ed-color-8e8e93)] hover:text-[var(--ed-color-3a3a3c)]"
      }`}
    >
      {label}
    </button>
  );
}
