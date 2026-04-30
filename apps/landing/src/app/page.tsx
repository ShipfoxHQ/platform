import {ClosingCta} from '#components/sections/closing-cta';
import {Footer} from '#components/sections/footer';
import {Hero} from '#components/sections/hero';
import {IntegrationsSection} from '#components/sections/integrations';
import {Nav} from '#components/sections/nav';
import {PlatformSection} from '#components/sections/platform';
import {PricingSection} from '#components/sections/pricing';
import {SelfImprovementSection} from '#components/sections/self-improvement';
import {UseCasesSection} from '#components/sections/use-cases';
import {WhatSection} from '#components/sections/what';

export default function HomePage() {
  return (
    <>
      <Nav />
      <Hero />
      <WhatSection />
      <IntegrationsSection />
      <UseCasesSection />
      <SelfImprovementSection />
      <PlatformSection />
      <PricingSection />
      <ClosingCta />
      <Footer />
    </>
  );
}
