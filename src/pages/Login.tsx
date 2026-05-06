import { useEffect, useState } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Boxes, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useCompanyLogo } from "@/hooks/useCompanyLogo";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const { logoUrl } = useCompanyLogo();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate("/app", { replace: true });
  }, [user, loading, navigate]);

  if (!loading && user) return <Navigate to="/app" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    const { error } = await signIn(email.trim(), password);
    setSubmitting(false);
    if (error) {
      toast.error("Falha no login", { description: error });
    } else {
      toast.success("Bem-vindo!");
      navigate("/app", { replace: true });
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <div className="hidden lg:flex relative bg-gradient-primary text-primary-foreground p-12 flex-col justify-between overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 30% 20%, hsl(var(--primary-glow)) 0%, transparent 50%)" }} />
        <div className="relative flex items-center gap-3">
          <div className="size-10 rounded-lg bg-primary-foreground/15 backdrop-blur grid place-items-center overflow-hidden">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="size-full object-contain" /> : <Boxes className="size-6" />}
          </div>
          <span className="font-display text-xl font-bold">Estoque Pro</span>
        </div>
        <div className="relative space-y-6 max-w-md">
          <h1 className="font-display text-4xl xl:text-5xl font-bold leading-tight">
            Controle total do seu estoque, em todas as salas.
          </h1>
          <p className="text-primary-foreground/85 text-lg">
            Solicitações, empréstimos entre salas, dívidas e relatórios em um único painel
            corporativo.
          </p>
          <ul className="space-y-3 text-primary-foreground/90">
            <li className="flex gap-3"><span className="mt-2 size-1.5 rounded-full bg-primary-foreground" /> Permissões por nível: Master, Admin e Analista</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 rounded-full bg-primary-foreground" /> Baixa automática e rastreabilidade de movimentos</li>
            <li className="flex gap-3"><span className="mt-2 size-1.5 rounded-full bg-primary-foreground" /> Empréstimos entre salas com controle de dívidas</li>
          </ul>
        </div>
        <p className="relative text-sm text-primary-foreground/70">© {new Date().getFullYear()} Estoque Pro</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12 bg-background">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="size-12 rounded-lg bg-gradient-primary grid place-items-center text-primary-foreground overflow-hidden">
              {logoUrl ? <img src={logoUrl} alt="Logo" className="size-full object-contain" /> : <Boxes className="size-6" />}
            </div>
            <span className="font-display text-xl font-bold">Estoque Pro</span>
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold">Entrar no sistema</h2>
            <p className="text-sm text-muted-foreground">Acesse com suas credenciais corporativas.</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@empresa.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" size="lg" disabled={submitting}>
              {submitting ? <><Loader2 className="size-4 animate-spin" /> Entrando…</> : "Entrar"}
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Acesso restrito. Solicite credenciais ao administrador master.
          </p>
        </div>
      </div>
    </div>
  );
}
