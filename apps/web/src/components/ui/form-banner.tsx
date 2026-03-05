type FormBannerProps = {
  variant: "error" | "success";
  children: React.ReactNode;
  className?: string;
};

const styles = {
  error: "bg-red-500/10 text-red-400",
  success: "bg-green-500/10 text-green-400",
} as const;

export function FormBanner({ variant, children, className }: FormBannerProps) {
  return (
    <div className={`rounded-lg px-4 py-2 text-sm ${styles[variant]} ${className ?? ""}`}>
      {children}
    </div>
  );
}
