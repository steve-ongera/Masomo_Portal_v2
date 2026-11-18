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
    <div className="login-page">
      <div className="login-card">
        <div className="d-flex justify-content-center mb-4">
          <img
            src={logo}
            alt="The Nyali School Logo"
            style={{ width: 150, height: 150, objectFit: "contain" }}
          />
        </div>

        <div className="login-card__brand justify-content-center">
          <h1>The Nyali School</h1>
        </div>
        <p className="text-center small fw-semibold text-muted-soft mb-3" style={{ letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Masomo Portal
        </p>

        <p className="login-card__subtitle text-center">
          {step === "credentials"
            ? "Sign in to your school portal"
            : "Enter the verification code sent to your registered contact"}
        </p>

        {error && (
          <div className="alert alert-danger py-2">
            <i className="bi bi-exclamation-circle me-1"></i> {error}
          </div>
        )}

        {step === "credentials" ? (
          <form onSubmit={handleCredentialsSubmit} noValidate>
            <div className="mb-3">
              <label className="form-label fw-semibold">Admission / Staff Number</label>
              <div className="input-icon-group">
                <i className="bi bi-person input-icon-leading"></i>
                <input
                  className="form-control"
                  placeholder="e.g. 11871"
                  value={username}
                  maxLength={USERNAME_MAX_LENGTH}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="mb-3">
              <div className="d-flex justify-content-between align-items-center">
                <label className="form-label fw-semibold mb-0">Password</label>
                <Link to="/forgot-password" className="small text-brand">
                  Forgot password?
                </Link>
              </div>
              <div className="input-icon-group has-toggle mt-1">
                <i className="bi bi-lock input-icon-leading"></i>
                <input
                  type={showPassword ? "text" : "password"}
                  className="form-control"
                  placeholder="Enter your password"
                  value={password}
                  maxLength={128}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="input-password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  <i className={`bi bi-${showPassword ? "eye-slash" : "eye"}`}></i>
                </button>
              </div>
            </div>

            <button
              className={`btn btn-primary w-100 btn-lg ${submitting ? "btn--loading" : ""}`}
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Signing in..." : "Sign In"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} noValidate>
            <p className="small text-muted-soft mb-3">
              A 6-digit code was sent to your {maskedContact}. It expires shortly, so enter it now.
            </p>
            <div className="mb-3">
              <label className="form-label fw-semibold">Verification Code</label>
              <input
                className="form-control form-control-lg"
                placeholder="352092"
                value={otpCode}
                inputMode="numeric"
                maxLength={6}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                required
                autoFocus
                style={{ letterSpacing: "0.3em", textAlign: "center", fontFamily: "var(--font-mono)" }}
              />
            </div>
            <button
              className={`btn btn-primary w-100 btn-lg ${submitting ? "btn--loading" : ""}`}
              type="submit"
              disabled={submitting || otpCode.length !== 6}
            >
              {submitting ? "Verifying..." : "Verify & Sign In"}
            </button>
            <button
              type="button"
              className="btn btn-link w-100 mt-2 small"
              onClick={() => setStep("credentials")}
            >
              Back to login
            </button>
          </form>
        )}

        <div className="login-card__footer">
          <span>
            Masomo Portal © {new Date().getFullYear()} — developed by{" "}
            <a
              href="https://steveongera.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ textDecoration: "underline" }}
            >
              Steve Ongera
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}