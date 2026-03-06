import Script from "next/script";
import { Nav } from "./_landing/nav";
import { Hero } from "./_landing/hero";
import { TrustStrip } from "./_landing/trust-strip";
import { ProblemSolution } from "./_landing/problem-solution";
import { PhoneScene } from "./_landing/phone-scene";
import { FeaturesBento } from "./_landing/features-bento";
import { EncryptionExplainer } from "./_landing/encryption-explainer";
import { PortForwarding } from "./_landing/port-forwarding";
import { DaemonSection } from "./_landing/daemon-section";
import { QuickStart } from "./_landing/quick-start";
import { Pricing } from "./_landing/pricing";
import { FinalCta } from "./_landing/final-cta";
import { Footer } from "./_landing/footer";

export default function Home() {
  return (
    <div className="relative min-h-screen font-body">
      {process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID && (
        <Script
          src="https://cloud.umami.is/script.js"
          data-website-id={process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID}
          strategy="afterInteractive"
        />
      )}
      <div className="bg-grid pointer-events-none fixed inset-0 z-0" />
      <Nav />
      <Hero />
      <TrustStrip />
      <ProblemSolution />
      <PhoneScene />
      <FeaturesBento />
      <EncryptionExplainer />
      <PortForwarding />
      <DaemonSection />
      <QuickStart />
      <Pricing />
      <FinalCta />
      <Footer />
    </div>
  );
}
