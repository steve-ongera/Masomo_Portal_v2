import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import logo from "../assets/nyali_school_logo.png";

const HOME_BY_ROLE = {
  ADMIN: "/admin",
  PRINCIPAL: "/principal",
  SECRETARY: "/secretary",
  TEACHER: "/teacher",
  STUDENT: "/student",
  PARENT: "/parent",
  FINANCE: "/finance",
  LIBRARIAN: "/librarian",
  HR: "/hr",
  STAFF: "/my-payslips",
  CAFETERIA: "/cafeteria",
  EXAM_OFFICER: "/exam-officer",
  PROCUREMENT: "/procurement",
  HOSTEL_WARDEN: "/warden"
};

const USERNAME_MAX_LENGTH = 30;

export default function Login() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState("credentials");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [challengeToken, setChallengeToken] = useState(null);
  const [maskedContact, setMaskedContact] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleCredentialsSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await login(username, password);
      if (result.otpRequired) {
        setChallengeToken(result.challengeToken);
        setMaskedContact(result.maskedContact);
        setStep("otp");
      } else {
        navigate(HOME_BY_ROLE[result.user.role] || "/");
      }
    } catch (err) {
      if (err?.response?.status === 423) {
        setError(err.response.data?.detail || "Account locked. Contact your administrator.");
      } else {
        setError("Invalid admission/staff number or password.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const user = await verifyOtp(challengeToken, otpCode);
      navigate(HOME_BY_ROLE[user.role] || "/");
    } catch (err) {
      if (err?.response?.status === 423) {
        setError("Too many failed attempts. Account locked — contact your administrator.");
        setStep("credentials");
      } else {
        setError("Invalid or expired code. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="np-login">
      <div className="np-login__shell">
        {/* ---------- Brand panel ---------- */}
        <aside className="np-login__brand" aria-hidden="false">
          <span className="np-login__orb np-login__orb--top" aria-hidden="true"></span>
          <span className="np-login__orb np-login__orb--bottom" aria-hidden="true"></span>

          <div className="np-login__brand-inner">
            <div className="np-login__logo">
              <img src={logo} alt="The Nyali School Logo" />
            </div>
            <h1 className="np-login__school">The Nyali School</h1>
            <p className="np-login__portal">Masomo Portal</p>
          </div>
        </aside>

        {/* ---------- Form panel ---------- */}
        <main className="np-login__panel">
          <div className="np-login__panel-inner">
            <header className="np-login__header">
              <h2>{step === "credentials" ? "Welcome Back" : "Verify Your Identity"}</h2>
              <p>
                {step === "credentials"
                  ? "Sign in to your school portal"
                  : "Enter the verification code sent to your registered contact"}
              </p>
            </header>

            {error && (
              <div className="np-login__alert" role="alert">
                <i className="bi bi-exclamation-circle"></i>
                <span>{error}</span>
              </div>
            )}

            {step === "credentials" ? (
              <form onSubmit={handleCredentialsSubmit} noValidate>
                <div className="np-field">
                  <label htmlFor="np-username" className="np-field__label">
                    Admission / Staff Number
                  </label>
                  <div className="np-field__control">
                    <i className="bi bi-person-fill np-field__icon"></i>
                    <input
                      id="np-username"
                      className="np-field__input"
                      placeholder="e.g. 11871"
                      value={username}
                      maxLength={USERNAME_MAX_LENGTH}
                      onChange={(e) => setUsername(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </div>
                </div>

                <div className="np-field">
                  <label htmlFor="np-password" className="np-field__label">
                    Password
                  </label>
                  <div className="np-field__control">
                    <i className="bi bi-lock-fill np-field__icon"></i>
                    <input
                      id="np-password"
                      type={showPassword ? "text" : "password"}
                      className="np-field__input np-field__input--toggle"
                      placeholder="Enter your password"
                      value={password}
                      maxLength={128}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="np-field__toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      <i className={`bi bi-${showPassword ? "eye-slash" : "eye"}`}></i>
                    </button>
                  </div>
                </div>

                <button className="np-btn" type="submit" disabled={submitting}>
                  {submitting ? (
                    <>
                      <span className="np-btn__spinner" aria-hidden="true"></span>
                      Signing in...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-box-arrow-in-right"></i>
                      Sign In
                    </>
                  )}
                </button>

                <div className="np-login__links">
                  <Link to="/forgot-password" className="np-login__link">
                    <i className="bi bi-question-circle"></i> Forgot password?
                  </Link>
                </div>
              </form>
            ) : (
              <form onSubmit={handleOtpSubmit} noValidate>
                <p className="np-login__hint">
                  A 6-digit code was sent to your {maskedContact}. It expires shortly, so enter it now.
                </p>
                <div className="np-field">
                  <label htmlFor="np-otp" className="np-field__label">
                    Verification Code
                  </label>
                  <input
                    id="np-otp"
                    className="np-field__input np-field__input--otp"
                    placeholder="352092"
                    value={otpCode}
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                    required
                    autoFocus
                  />
                </div>
                <button
                  className="np-btn"
                  type="submit"
                  disabled={submitting || otpCode.length !== 6}
                >
                  {submitting ? (
                    <>
                      <span className="np-btn__spinner" aria-hidden="true"></span>
                      Verifying...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-shield-check"></i>
                      Verify &amp; Sign In
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="np-btn-text"
                  onClick={() => setStep("credentials")}
                >
                  <i className="bi bi-arrow-left"></i> Back to login
                </button>
              </form>
            )}

            <footer className="np-login__footer">
              <span>
                The Nyali School © {new Date().getFullYear()}  &nbsp;|&nbsp; Developed by{" "}
                <a
                  href="https://steveongera.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Steve Ongera
                </a>
              </span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}