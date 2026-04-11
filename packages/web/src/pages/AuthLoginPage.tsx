import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button.js";
import { Card } from "../components/ui/card.js";
import { Input } from "../components/ui/input.js";
import { login } from "../lib/api.js";
import logoUrl from "../assets/images/logo.png";

export function AuthLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { token } = await login(username, password);
      localStorage.setItem("auth_token", token);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <Card className="w-full max-w-[380px]">
        <div className="mb-6 text-center">
          <img src={logoUrl} alt="Clawbot" className="mx-auto size-16 rounded-[18px] object-cover" />
          <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
            Clawbot
          </p>
          <h1 className="mt-1.5 text-[20px] text-[var(--ink)]">登录</h1>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && (
            <div className="border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-3 py-2 text-[12px] text-red-700">
              {error}
            </div>
          )}

          <Input
            type="text"
            placeholder="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />

          <Input
            type="password"
            placeholder="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          <Button type="submit" className="mt-1 w-full rounded-lg" disabled={loading}>
            {loading ? "登录中..." : "登录"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
