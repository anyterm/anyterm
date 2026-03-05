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

type OrgInvitationProps = {
  inviterName: string;
  orgName: string;
  role: string;
  url: string;
};

export default function OrgInvitation({ inviterName, orgName, role, url }: OrgInvitationProps) {
  return (
    <Html lang="en">
      <Tailwind>
        <Head />
        <Preview>{inviterName} invited you to {orgName} on anyterm</Preview>
        <Body style={{ backgroundColor: "#09090b", fontFamily: "sans-serif" }}>
          <Container style={{ maxWidth: "480px", margin: "0 auto", padding: "40px 20px" }}>
            <Text style={{ color: "#fafafa", fontSize: "20px", fontWeight: "bold", letterSpacing: "-0.02em" }}>
              anyterm
            </Text>
            <Heading style={{ color: "#fafafa", fontSize: "22px", fontWeight: "bold", marginTop: "24px" }}>
              You're invited
            </Heading>
            <Text style={{ color: "#a1a1aa", fontSize: "14px", lineHeight: "22px" }}>
              <strong style={{ color: "#fafafa" }}>{inviterName}</strong> invited you to join{" "}
              <strong style={{ color: "#fafafa" }}>{orgName}</strong> as {role}.
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
              Accept invitation
            </Button>
            <Hr style={{ borderColor: "#27272a", marginTop: "32px", marginBottom: "16px" }} />
            <Text style={{ color: "#52525b", fontSize: "12px", lineHeight: "18px" }}>
              If you weren't expecting this invitation, you can safely ignore this email.
              This invitation expires in 7 days.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

OrgInvitation.PreviewProps = {
  inviterName: "Jane Doe",
  orgName: "Acme Corp",
  role: "member",
  url: "https://anyterm.dev/accept-invitation?token=abc123",
} satisfies OrgInvitationProps;
