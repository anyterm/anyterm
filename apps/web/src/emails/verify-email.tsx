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

type VerifyEmailProps = {
  url: string;
};

export default function VerifyEmail({ url }: VerifyEmailProps) {
  return (
    <Html lang="en">
      <Tailwind>
        <Head />
        <Preview>Verify your anyterm account</Preview>
        <Body style={{ backgroundColor: "#09090b", fontFamily: "sans-serif" }}>
          <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "40px 20px" }}>
            <Text style={{ color: "#fafafa", fontSize: "20px", fontWeight: "bold", letterSpacing: "-0.02em" }}>
              anyterm
            </Text>
            <Heading style={{ color: "#fafafa", fontSize: "22px", fontWeight: "bold", marginTop: "24px" }}>
              Verify your email
            </Heading>
            <Text style={{ color: "#a1a1aa", fontSize: "14px", lineHeight: "22px" }}>
              Click the button below to verify your email address and activate your account.
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
              Verify email
            </Button>
            <Hr style={{ borderColor: "#27272a", marginTop: "32px", marginBottom: "16px" }} />
            <Text style={{ color: "#52525b", fontSize: "12px", lineHeight: "18px" }}>
              If you didn't create an anyterm account, ignore this email.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

VerifyEmail.PreviewProps = {
  url: "https://anyterm.dev/verify-email?token=abc123",
} satisfies VerifyEmailProps;
