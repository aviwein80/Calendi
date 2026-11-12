import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalLink, LegalList, LegalP, LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT_EMAIL, OPERATOR_NAME } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Terms of use',
  description: `The ground rules for booking a time with ${OPERATOR_NAME} through this site.`,
};

// Static on purpose: no data access, no clock. The "last updated" date lives
// in lib/legal.ts and is changed by hand.

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <LegalP>
        These are the ground rules for booking a time with {OPERATOR_NAME} through this site. By making a
        booking you agree to them and to the{' '}
        <Link href="/privacy" className="font-medium text-zinc-900 underline underline-offset-2">
          privacy policy
        </Link>
        .
      </LegalP>

      <LegalSection title="Booking">
        <LegalList>
          <li>Give your real name and an email address you can read: that is where the confirmation goes.</li>
          <li>A booking is confirmed once you see the confirmation page and receive the email.</li>
          <li>Times are shown in the time zone you choose. Check it before you confirm.</li>
          <li>
            If something comes up, I may need to move or cancel a meeting. I will tell you by email and offer
            another time where I can.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Changing or cancelling">
        <LegalP>
          Use the link in your confirmation email, and please do it as early as you can. Anyone with that link can
          change or cancel the booking, so keep it to yourself.
        </LegalP>
      </LegalSection>

      <LegalSection title="Please don’t">
        <LegalList>
          <li>Make bookings that are fake, or that you do not intend to keep.</li>
          <li>Use scripts or bots to book, or to hammer the site.</li>
          <li>Guess booking links, or try to reach anything that is not meant to be public.</li>
          <li>Put anything unlawful, abusive or harmful in the form.</li>
        </LegalList>
        <LegalP>I may cancel bookings and block access for anyone who does.</LegalP>
      </LegalSection>

      <LegalSection title="The site itself">
        <LegalP>
          The site is provided as it is. I try to keep it running and accurate, but it may be down, and a
          calendar or email problem could delay or lose a confirmation. To the extent the law allows, I am not
          liable for indirect losses that result, such as a missed meeting. Nothing here limits rights you have
          that the law does not let me limit.
        </LegalP>
      </LegalSection>

      <LegalSection title="Changes">
        <LegalP>
          I may update these terms. The date at the top shows when they last changed, and using the site after
          that means you accept the new version.
        </LegalP>
      </LegalSection>

      <LegalSection title="Contact">
        <LegalP>
          Questions about these terms: {OPERATOR_NAME} ·{' '}
          <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
