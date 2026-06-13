import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function RecoverDraftDialog({
  open, onOpenChange, updatedAt, itemCount, onRecover, onDiscard,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  updatedAt: number | null;
  itemCount?: number;
  onRecover: () => void;
  onDiscard: () => void;
}) {
  const when = updatedAt ? new Date(updatedAt).toLocaleString() : "";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Recuperar trabalho não salvo?</AlertDialogTitle>
          <AlertDialogDescription>
            Encontramos um rascunho deste formulário {when ? `salvo em ${when}` : ""} {typeof itemCount === "number" ? ` com ${itemCount} item(ns)` : ""}.
            Deseja continuar de onde parou?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDiscard}>Descartar</AlertDialogCancel>
          <AlertDialogAction onClick={onRecover}>Recuperar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
