import { ModuleGuard } from "@/lib/moduleGuard";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ModuleGuard module="inventory">{children}</ModuleGuard>;
}
