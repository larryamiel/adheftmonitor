import { LoginForm } from '@/components/client';

export default function LoginPage() {
  return (
    <main className="login">
      <div className="card card-pad stack">
        <div>
          <h1>Adheft Monitor</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>Sign in to continue.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
