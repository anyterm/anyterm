import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Hr,
  Tailwind,
} from "@react-email/components";

type ResetPasswordProps = {
  url: string;
  email: string;
};

export default function ResetPassword({ url, email }: ResetPasswordProps) {
  return (
    <Html lang="en">
      <Tailwind>
        <Head />
        <Preview>Reset your anyterm password</Preview>
        <Body style={{ backgroundColor: "#09090b", fontFamily: "sans-serif" }}>
          <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "40px 20px" }}>
            <Text style={{ color: "#fafafa", fontSize: "20px", fontWeight: "bold", letterSpacing: "-0.02em" }}>
              anyterm
            </Text>
            <Heading style={{ color: "#fafafa", fontSize: "22px", fontWeight: "bold", marginTop: "24px" }}>
              Reset your password
            </Heading>
            <Text style={{ color: "#a1a1aa", fontSize: "14px", lineHeight: "22px" }}>
              A password reset was requested for <strong style={{ color: "#fafafa" }}>{email}</strong>.
              Click the button below to choose a new password.
            </Text>
            <Button
              href={url}
              style={{
                backgroundColor: "#fafafa",
                color: "#09090b",
                padding: "12px 24px",
                borderRadius: "8px",
                fontSize: "14px",
                fontWeight: "600",
                textDecoration: "none",
                display: "inline-block",
                marginTop: "8px",
              }}
            >
              Reset password
            </Button>
            <Hr style={{ borderColor: "#27272a", marginTop: "32px", marginBottom: "16px" }} />
            <Text style={{ color: "#52525b", fontSize: "12px", lineHeight: "18px" }}>
              If you didn't request this, ignore this email. Your password won't change.
              This link expires in 1 hour.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

ResetPassword.PreviewProps = {
  url: "https://anyterm.dev/reset-password?token=abc123",
  email: "user@example.com",
} satisfies ResetPasswordProps;
