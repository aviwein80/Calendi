import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalLink, LegalList, LegalP, LegalPage, LegalSection } from '@/components/LegalPage';
import { CONTACT_EMAIL, OPERATOR_NAME } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: `How ${OPERATOR_NAME}'s scheduling site handles the information you give it.`,
};

// Static on purpose: no data access, no clock. The "last updated" date lives
// in lib/legal.ts and is changed by hand.

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <LegalP>
        This site lets you book a time with {OPERATOR_NAME} (“I”, “me”). This page explains what information it
        collects, what I do with it, and how to ask me to delete it.
      </LegalP>

      <LegalSection title="What I collect when you book">
        <LegalList>
          <li>Your name and email address.</li>
          <li>Your phone number, if the booking form asks for it.</li>
          <li>Your time zone, so times are shown correctly.</li>
          <li>Your answers to any questions on the form, and any notes you add.</li>
          <li>The email addresses of any guests you add.</li>
          <li>The booking itself: which meeting, the date and time, and whether it was changed or cancelled.</li>
        </LegalList>
        <LegalP>
          To stop abuse, the site counts requests from each network address. The address is kept only as a
          scrambled (keyed hash) value, never in readable form. The site does not use advertising or analytics
          trackers, and people who book are not given cookies.
        </LegalP>
      </LegalSection>

      <LegalSection title="How I use it">
        <LegalList>
          <li>To make the booking and put it on my calendar.</li>
          <li>To email you a confirmation, and a notice if the booking is changed or cancelled.</li>
          <li>To let you cancel or reschedule using the private link in your confirmation.</li>
          <li>To prevent double-booking and abuse of the site.</li>
        </LegalList>
        <LegalP>
          If I have connected an automation to the site (for example a Zapier or Slack workflow), the booking
          details are also sent there. I do not sell your information, and I do not use it for advertising.
        </LegalP>
      </LegalSection>

      <LegalSection title="Calendars I connect">
        <LegalP>
          This site is connected to my own calendars: Google Calendar, Microsoft Outlook, Apple iCloud (or
          another CalDAV calendar), or a calendar subscription link. People who book never connect or sign in
          with a calendar of their own.
        </LegalP>
        <LegalList>
          <li>
            <span className="font-medium text-zinc-900">Reading.</span> The site reads my calendars to find the
            times I am busy, so it only offers times I am free. Visitors see open times only, never what is on my
            calendar.
          </li>
          <li>
            <span className="font-medium text-zinc-900">Writing.</span> When you book, the site adds the meeting
            to the calendar I have chosen. That event includes your name, your email address and the booking
            details. Changes and cancellations update it.
          </li>
          <li>
            <span className="font-medium text-zinc-900">Access tokens.</span> The keys that let the site reach my
            calendars (access tokens, or an app-specific password for iCloud) are stored encrypted and are never
            sent to a browser. I can disconnect a calendar at any time, which deletes them, and can also revoke
            access from my Google or Microsoft account.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Google API data">
        <LegalP>
          This site’s use and transfer to any other app of information received from Google APIs adheres to the{' '}
          <LegalLink href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </LegalLink>
          , including the Limited Use requirements.
        </LegalP>
        <LegalList>
          <li>
            Google Calendar data is used only to provide the scheduling features described above: checking when
            I am free, and creating, updating and cancelling the events for bookings.
          </li>
          <li>It is not sold.</li>
          <li>It is not used or transferred for advertising, including retargeting or interest-based ads.</li>
          <li>It is not used to develop, improve or train AI or machine-learning models.</li>
          <li>
            It is not shared with anyone else except as needed to run the service (such as the hosting provider),
            to follow the law, or for security.
          </li>
          <li>
            Nobody reads it by hand unless I give permission, it is needed to investigate abuse or a security
            problem, or the law requires it.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Who else handles your information">
        <LegalP>
          The services that run this site act for me and only to deliver it: the hosting provider and managed
          database where it runs, the email service that sends confirmations, and the calendar provider where the
          meeting is saved. If I have connected an automation, that tool receives booking details too.
        </LegalP>
      </LegalSection>

      <LegalSection title="How long I keep it">
        <LegalP>
          Booking records are kept for as long as I need them to run my schedule and keep a record of meetings,
          or until you ask me to delete them. Cancelling a booking cancels the meeting; it does not by itself
          erase the record.
        </LegalP>
      </LegalSection>

      <LegalSection title="Security">
        <LegalP>
          Pages are served over HTTPS. Calendar credentials are encrypted. Cancel and reschedule links are long
          random secrets, and repeated guessing is cut off. No system is perfectly secure, but I take care with
          what is stored.
        </LegalP>
      </LegalSection>

      <LegalSection title="Asking for your information to be deleted">
        <LegalP>
          Email <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink> from the address you used
          to book, and say what you would like removed. I will delete your booking records and confirm by
          email, normally within 30 days. You can use the same address to ask what I hold about you or to have
          it corrected.
        </LegalP>
      </LegalSection>

      <LegalSection title="Children">
        <LegalP>This site is not meant for children under 13, and I do not knowingly collect their information.</LegalP>
      </LegalSection>

      <LegalSection title="Changes">
        <LegalP>
          If this policy changes, the date at the top changes with it. The{' '}
          <Link href="/terms" className="font-medium text-zinc-900 underline underline-offset-2">
            terms of use
          </Link>{' '}
          are a separate page.
        </LegalP>
      </LegalSection>

      <LegalSection title="Contact">
        <LegalP>
          {OPERATOR_NAME} · <LegalLink href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</LegalLink>
        </LegalP>
      </LegalSection>
    </LegalPage>
  );
}
